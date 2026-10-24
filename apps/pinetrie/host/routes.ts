// host/routes — what the host does with a request or an upgrade, pure:
// admission first (admission.ts), then which requests it answers itself: an
// image blob, a review's read, or the machine's (the Machine page's facts,
// its diagnostics, the measurements' export). Everything else is the page's:
// Vite's, or a file of the built page (`planPageRequest`). `http.ts` carries
// each plan out.

import { isSha256, type Sha256 } from "@pinetrie/core"
import { parseReviewPath, type ReviewAsk } from "@pinetrie/rules"
import { admits, type RequestFacts } from "./admission.ts"
import { MEASUREMENTS_KEPT_DAYS } from "./machine/measurements.ts"

export type Route =
  | { readonly kind: "blob-get"; readonly sha: Sha256 | null }
  | { readonly kind: "blob-post" }
  | { readonly kind: "review"; readonly ask: ReviewAsk }
  /** The machine's measurements of the last `days` days, as JSON lines. */
  | { readonly kind: "measurements"; readonly days: number }
  /** The Machine page's facts, as JSON. */
  | { readonly kind: "machine" }
  /** The Machine page's diagnostics, as text. */
  | { readonly kind: "machine-diagnostics" }
  | { readonly kind: "bad" }
  | { readonly kind: "other" }

/** How many days of measurements a request asks for: 1 to what is kept, `MEASUREMENTS_KEPT_DAYS` when it names none. */
function measurementsRoute(url: URL): Route {
  const asked = url.searchParams.get("days")
  if (asked === null)
    return { kind: "measurements", days: MEASUREMENTS_KEPT_DAYS }
  const days = Number(asked)
  return Number.isInteger(days) && days >= 1 && days <= MEASUREMENTS_KEPT_DAYS
    ? { kind: "measurements", days }
    : { kind: "bad" }
}

/**
 * What a request is for. `GET /blob/<anything>` is a blob's, with a null hash
 * when it names none: a 404. Anything under `/review/` that `parseReviewPath`
 * does not accept, or that is not a `GET`, is `bad`: a 400; so is a `/machine`
 * path asked with another method. None reaches the page: Vite's fallback
 * would answer `index.html`.
 */
export function route(method: string | undefined, url: URL): Route {
  const { pathname } = url
  if (pathname.startsWith("/blob/") && method === "GET") {
    const sha = pathname.slice("/blob/".length)
    return { kind: "blob-get", sha: isSha256(sha) ? sha : null }
  }
  if (pathname === "/blob" && method === "POST") return { kind: "blob-post" }
  if (pathname === "/machine/measurements")
    return method === "GET" ? measurementsRoute(url) : { kind: "bad" }
  if (pathname === "/machine")
    return method === "GET" ? { kind: "machine" } : { kind: "bad" }
  if (pathname === "/machine/diagnostics")
    return method === "GET" ? { kind: "machine-diagnostics" } : { kind: "bad" }
  const ask = parseReviewPath(url)
  if (ask === null) return { kind: "other" }
  if (ask === "bad" || method !== "GET") return { kind: "bad" }
  return { kind: "review", ask }
}

/**
 * A request: refused, redirected without the key it carried (the cookie a
 * link sets keeps it), or routed. Admission comes first: nothing reaches
 * the page, the blobs or a review's reads without it.
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
  if (admission.kind === "admit-and-forget")
    return { kind: "redirect", location: admission.location }
  return route(method, new URL(facts.url, "http://host"))
}

/**
 * An upgrade: refused, the Exchange's websocket (`/ws`), or handed to Vite's
 * HMR listener where Vite serves the page (`hmr`); a built page has none. A
 * WebSocket is exempt from the same-origin policy, so the `Origin` check in
 * `admits` is what keeps another page off the socket.
 */
export function planUpgrade(
  facts: RequestFacts,
  key: string | null,
  hmr: boolean,
): "refuse" | "exchange" | "vite" {
  if (admits(facts, key).kind === "refuse") return "refuse"
  if (new URL(facts.url, "http://host").pathname === "/ws") return "exchange"
  return hmr ? "vite" : "refuse"
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".json": "application/json",
}

/** What answers a request for the built page: a file of `dist/`, with its headers, or a 404. */
type PageAnswer =
  | {
      readonly kind: "file"
      /** Relative to `dist/`. */
      readonly file: string
      readonly headers: Readonly<Record<string, string>>
    }
  | { readonly kind: "missing" }

/**
 * A request for the built page. `/` is `index.html`, never cached, so a
 * rebuild is seen at the next load; `assets/` holds files named by their
 * hash, cached for good. Nothing falls back to `index.html`: the page
 * routes by its URL's hash.
 */
export function planPageRequest(
  pathname: string,
  files: ReadonlySet<string>,
): PageAnswer {
  let file: string
  try {
    file =
      pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1))
  } catch {
    return { kind: "missing" }
  }
  // Only a name in the set is served, so `..` reaches nothing outside `dist/`.
  if (!files.has(file)) return { kind: "missing" }
  const type =
    CONTENT_TYPES[file.slice(file.lastIndexOf("."))] ??
    "application/octet-stream"
  const cache =
    file === "index.html"
      ? "no-cache"
      : file.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache"
  return {
    kind: "file",
    file,
    headers: { "content-type": type, "cache-control": cache },
  }
}
