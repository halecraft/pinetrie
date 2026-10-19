// host/admission — who may reach the page, Vite, the blobs and the Exchange.
//
// pinetrie is multiplayer, so the host can bind to a network address. Reaching
// the port must not be enough: whoever does gets the whole session, the
// client's source and the command channel, and with tools, a shell. Off
// loopback, an invite key is required: whoever has the link is a collaborator,
// and nobody else gets anything. On loopback there is no key, so a request must
// come from this machine's own names, and from a page of this host. It decides
// who gets in, not who is who: peer ids are chosen by clients.

import { randomBytes, timingSafeEqual } from "node:crypto"

/** The cookie the invite link sets, so a page's own requests carry the key. */
export const KEY_COOKIE = "pinetrie_key"

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
  | { readonly kind: "admit-and-forget"; readonly location: string }
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
 * Whether a request may reach the page, Vite, the blobs or the Exchange.
 *
 * First, where it comes from. A browser names the page that made a request in
 * `Origin`, and a page on another origin must not reach this one: a WebSocket
 * is exempt from the same-origin policy, and the socket carries every command.
 * With no key the host is on loopback, and a name rebound to 127.0.0.1 would
 * reach it as its own origin, so there the `Host` must be a loopback name
 * too. A request without `Origin` (a Node client, a navigation) passes the
 * first check.
 *
 * Then the key. With none, everything left is admitted. Otherwise it must come
 * as `?key=` (an invite link, or a Node client) or as the cookie a link sets.
 */
export function admits(request: RequestFacts, key: string | null): Admission {
  if (request.origin !== undefined && !sameHost(request.origin, request.host))
    return REFUSE
  if (key === null) return isLoopbackHost(request.host) ? ADMIT : REFUSE
  const url = new URL(request.url, "http://host")
  const given = url.searchParams.get("key")
  if (given !== null) {
    if (!same(given, key)) return REFUSE
    url.searchParams.delete("key")
    return {
      kind: "admit-and-forget",
      location: `${url.pathname}${url.search}`,
    }
  }
  const cookie = cookieValue(request.cookie, KEY_COOKIE)
  return cookie !== undefined && same(cookie, key) ? ADMIT : REFUSE
}

/** What `admits` reads of a Node request or upgrade. */
export interface RequestFacts {
  readonly url: string
  readonly cookie?: string | undefined
  readonly origin?: string | undefined
  readonly host?: string | undefined
}

export const requestFacts = (req: {
  readonly url?: string | undefined
  readonly headers: {
    readonly cookie?: string | undefined
    readonly origin?: string | undefined
    readonly host?: string | undefined
  }
}): RequestFacts => ({
  url: req.url ?? "/",
  cookie: req.headers.cookie,
  origin: req.headers.origin,
  host: req.headers.host,
})

/** A `Host` header as a URL, or undefined if it names no host. */
function hostUrl(host: string | undefined): URL | undefined {
  if (host === undefined || host === "") return undefined
  try {
    return new URL(`http://${host}`)
  } catch {
    return undefined
  }
}

/** Whether an `Origin` names the host the request was sent to. "null" never does. */
function sameHost(origin: string, host: string | undefined): boolean {
  const to = hostUrl(host)
  if (to === undefined) return false
  try {
    return new URL(origin).host === to.host
  } catch {
    return false
  }
}

/** Whether a `Host` header names this machine: `localhost`, 127.0.0.0/8 or [::1]. */
export function isLoopbackHost(host: string | undefined): boolean {
  const name = hostUrl(host)?.hostname
  if (name === undefined) return false
  return name === "localhost" || name === "[::1]" || isLoopback(name)
}

/** How to write a bound address in a URL this machine can open. */
export function urlHost(bind: string): string {
  if (bind === "0.0.0.0") return "127.0.0.1"
  if (bind === "::") return "[::1]"
  return bind.includes(":") ? `[${bind}]` : bind
}

/** A network interface's address, as `os.networkInterfaces()` lists it. */
interface InterfaceAddress {
  readonly family: string
  readonly address: string
  readonly internal: boolean
}

/**
 * The links a collaborator opens, the key included off loopback. Bound to
 * 0.0.0.0, one per external IPv4 address; otherwise the bound address.
 */
export function planInvites(input: {
  readonly bind: string
  readonly key: string | null
  readonly port: number
  readonly interfaces: readonly (InterfaceAddress | undefined)[]
}): string[] {
  const { bind, key, port } = input
  const addresses =
    bind === "0.0.0.0"
      ? input.interfaces.flatMap(a =>
          a !== undefined && a.family === "IPv4" && !a.internal
            ? [a.address]
            : [],
        )
      : [urlHost(bind)]
  return addresses.map(
    a =>
      `http://${a}:${port}/${key === null ? "" : `?key=${encodeURIComponent(key)}`}`,
  )
}
