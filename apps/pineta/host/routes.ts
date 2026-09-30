// host/routes — which requests the host answers itself, pure: an image blob
// (ADR-0042) or a read of an offer (ADR-0047). Everything else is Vite's.

import { isSha256, type Sha256 } from "@pineta/core"
import { type OfferAsk, parseOfferPath } from "@pineta/marginalia"

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
