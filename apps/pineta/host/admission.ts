// host/admission — who may reach the page, Vite and the Exchange.
//
// Pineta is multiplayer, so the host can bind to a network address. Reaching
// the port must not be enough: whoever does gets the whole session, the
// client's source and the command channel, and with tools, a shell. Off
// loopback, an invite key is required: whoever has the link is a collaborator,
// and nobody else gets anything. It decides who gets in, not who is who: peer
// ids are chosen by clients (ADR-0022).

import { randomBytes, timingSafeEqual } from "node:crypto"

/** The cookie the invite link sets, so a page's own requests carry the key. */
export const KEY_COOKIE = "pineta_key"

/** Where a host listens unless told otherwise: this machine only. */
export const DEFAULT_BIND = "127.0.0.1"

/** Loopback-only addresses need no key: 127.0.0.0/8 and ::1. */
export const isLoopback = (bind: string): boolean =>
  bind === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bind)

/** A fresh invite key: 32 random bytes, URL-safe. */
export const newKey = (): string => randomBytes(32).toString("base64url")

export type Admission =
  | { readonly kind: "admit" }
  /**
   * A valid `?key=`: set the cookie and redirect to `location`, the same URL
   * without the key, so the key leaves the address bar and the history.
   */
  | { readonly kind: "admitAndForget"; readonly location: string }
  | { readonly kind: "refuse" }

const ADMIT: Admission = { kind: "admit" }
const REFUSE: Admission = { kind: "refuse" }

/** Equal without leaking, through timing, how much of the key was right. */
function same(given: string, key: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(key)
  return a.length === b.length && timingSafeEqual(a, b)
}

function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=")
    if (at > 0 && part.slice(0, at).trim() === name)
      return decodeURIComponent(part.slice(at + 1).trim())
  }
  return undefined
}

/**
 * Whether a request may reach the page, Vite or the Exchange. Pure. With no
 * key (loopback), everything is admitted. Otherwise the key must come as
 * `?key=` (an invite link, or a Node client) or as the cookie a link sets.
 */
export function admits(
  request: { readonly url: string; readonly cookie?: string },
  key: string | null,
): Admission {
  if (key === null) return ADMIT
  const url = new URL(request.url, "http://host")
  const given = url.searchParams.get("key")
  if (given !== null) {
    if (!same(given, key)) return REFUSE
    url.searchParams.delete("key")
    return { kind: "admitAndForget", location: `${url.pathname}${url.search}` }
  }
  const cookie = cookieValue(request.cookie, KEY_COOKIE)
  return cookie !== undefined && same(cookie, key) ? ADMIT : REFUSE
}

/** How to write a bound address in a URL this machine can open. */
export function urlHost(bind: string): string {
  if (bind === "0.0.0.0") return "127.0.0.1"
  if (bind === "::") return "[::1]"
  return bind.includes(":") ? `[${bind}]` : bind
}
