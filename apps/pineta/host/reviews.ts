// host/reviews — an offer read's answer as HTTP, pure (ADR-0047).

import type { OfferAnswer } from "@pineta/marginalia"

export interface HttpAnswer {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

/**
 * A review or a diff names a commit, which names its content, and the URL
 * names the wire's version, so its answer is cached as `serveBlob`'s is. A
 * refusal may change a moment later (the offer moved, and its record has not
 * yet arrived), so it is never stored.
 */
const IMMUTABLE = {
  "cache-control": "private, max-age=31536000, immutable",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'",
}

export function offerResponse(answer: OfferAnswer): HttpAnswer {
  switch (answer.kind) {
    case "review":
      return {
        status: 200,
        headers: {
          ...IMMUTABLE,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(answer.review),
      }
    case "diff":
      return {
        status: 200,
        headers: { ...IMMUTABLE, "content-type": "text/plain; charset=utf-8" },
        body: answer.text,
      }
    case "refused":
      return {
        status: answer.status,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        },
        body: answer.reason,
      }
  }
}
