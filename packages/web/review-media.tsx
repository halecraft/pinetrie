// web/review-media — a file of a review shown as a file: an image's two
// sides drawn side by side, or another file's sizes and a link to open each
// side. Its URLs are the review's own (`fileUrl`), served as images only
// when their bytes are one, so an `<img>` never draws a page.

import type { MediaRow, MediaShown } from "@pinetrie/interface"

const SIDE_WORDS = {
  before: { label: "before", missing: "added" },
  after: { label: "after", missing: "removed" },
} as const

function Side({
  which,
  kind,
  side,
}: {
  which: "before" | "after"
  kind: MediaRow["kind"]
  side: MediaShown | null
}) {
  const words = SIDE_WORDS[which]
  return (
    <figure className="review-media-side" data-side={which}>
      <figcaption>
        {words.label}
        {side !== null && ` · ${side.size}`}
      </figcaption>
      {side === null ? (
        <div className="review-media-missing">{words.missing}</div>
      ) : kind === "image" ? (
        <img
          alt={`${words.label}, ${side.size}`}
          loading="lazy"
          src={side.url}
        />
      ) : (
        <a href={side.url} rel="noopener" target="_blank">
          open
        </a>
      )}
    </figure>
  )
}

export function ReviewMedia({ media }: { media: MediaRow }) {
  return (
    <div className="review-media" data-kind={media.kind}>
      <Side kind={media.kind} side={media.before} which="before" />
      <Side kind={media.kind} side={media.after} which="after" />
    </div>
  )
}
