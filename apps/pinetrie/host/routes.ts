// host/routes — what the host does with a request or an upgrade, pure:
// admission first (admission.ts), then which requests it answers itself, an
// image blob (ADR-0042) or a read of an offer (ADR-0047). Everything else is
// Vite's. `http.ts` carries each plan out.

import { isSha256, type Sha256 } from "@pinetrie/core"
import { type OfferAsk, parseOfferPath } from "@pinetrie/rules"
import { admits, type RequestFacts } from "./admission.ts"

export type Route =
  | { readonly kind: "blob-get"; readonly sha: Sha256 | null }
  | { readonly kind: "blob-post" }
  | { readonly kind: "offer"; readonly ask: OfferAsk }
  | { readonly kind: "bad" }
  | { readonly kind: "other" }

/**
 * What a request is for. `GET /blob/<anything>` is a blob's, with a null hash
 * when it names none: a 404. Anything under `/offer/` that `parseOfferPath`
 * does not accept, or that is not a `GET`, is `bad`: a 400. Neither reaches
 * Vite, whose fallback would answer `index.html`.
 */
export function route(method: string | undefined, url: URL): Route {
  const { pathname } = url
  if (pathname.startsWith("/blob/") && method === "GET") {
    const sha = pathname.slice("/blob/".length)
    return { kind: "blob-get", sha: isSha256(sha) ? sha : null }
  }
  if (pathname === "/blob" && method === "POST") return { kind: "blob-post" }
  const ask = parseOfferPath(url)
  if (ask === null) return { kind: "other" }
  if (ask === "bad" || method !== "GET") return { kind: "bad" }
  return { kind: "offer", ask }
}

/**
 * A request: refused, redirected without the key it carried (the cookie a
 * link sets keeps it), or routed. Admission comes first: nothing reaches
 * Vite, the blobs or an offer's reads without it.
 */
export function planRequest(
  facts: RequestFacts,
  key: string | null,
  method: string | undefined,
):
  | { readonly kind: "refuse" }
  | { readonly kind: "redirect"; readonly location: string }
  | Route {
  const admission = admits(facts, key)
  if (admission.kind === "refuse") return { kind: "refuse" }
  if (admission.kind === "admitAndForget")
    return { kind: "redirect", location: admission.location }
  return route(method, new URL(facts.url, "http://host"))
}

/**
 * An upgrade: refused, the Exchange's websocket (`/ws`), or handed to Vite's
 * HMR listener. A WebSocket is exempt from the same-origin policy, so the
 * `Origin` check in `admits` is what keeps another page off the socket.
 */
export function planUpgrade(
  facts: RequestFacts,
  key: string | null,
): "refuse" | "exchange" | "vite" {
  if (admits(facts, key).kind === "refuse") return "refuse"
  return new URL(facts.url, "http://host").pathname === "/ws"
    ? "exchange"
    : "vite"
}
