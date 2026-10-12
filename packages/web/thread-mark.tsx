// web/thread-mark — the mark before a thread's name, in its column's header,
// its details and its folded strip alike.

import { AGENT_MARK, type HeadBanner } from "@pinetrie/interface"
import { useState } from "react"

/**
 * The mark before a thread's name: one fixed square, so the name never
 * moves. It holds the star, and the thread's banner over it when there is
 * one; the star stays in the text either way. The square pulses while the
 * lane runs, banner and all: under a banner the star is hidden.
 */
export function ThreadMark({
  banner,
  running,
  working,
  folds = false,
}: {
  banner: HeadBanner | null
  running: boolean
  /** Its title while the lane runs (`workingWords`). */
  working: string | undefined
  /** The mark a fold moves between a column's header and its strip: one per column. */
  folds?: boolean
}) {
  return (
    <span
      className={running ? "thread-mark pulse" : "thread-mark"}
      data-fold-mark={folds || undefined}
      title={working}
    >
      {banner === null ? (
        <span className="thread-star">{AGENT_MARK}</span>
      ) : (
        <BannerImage fade={banner.fade} key={banner.url} url={banner.url} />
      )}
    </span>
  )
}

/**
 * A banner over the star. A new one fades in once loaded, the star fading
 * out under it; one there as the column mounts shows at once, with no star.
 * Keyed by its URL, so each new banner fades in.
 */
function BannerImage({ url, fade }: { url: string; fade: boolean }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <>
      <span className="thread-star" data-gone={loaded || !fade || undefined}>
        {AGENT_MARK}
      </span>
      <img
        alt=""
        className="banner"
        data-fade={fade || undefined}
        data-loaded={loaded || undefined}
        onLoad={() => setLoaded(true)}
        src={url}
      />
    </>
  )
}
