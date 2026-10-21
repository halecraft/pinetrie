// web/thread-mark — the mark before a thread's name, in its column's header
// and its folded strip alike.

import { AGENT_MARK, type HeadIcon, type ThreadIcon } from "@pinetrie/interface"
import { useState } from "react"
import { ThreadIconImage } from "./thread-icon-image.tsx"

/**
 * The mark before a thread's name: one fixed square, so the name never
 * moves. It holds the star, and the thread's icon over it when there is
 * one; the star stays in the text either way. The square pulses while the
 * lane runs, icon and all: under an icon the star is hidden.
 */
export function ThreadMark({
  icon,
  running,
  working,
  folds = false,
}: {
  icon: HeadIcon | null
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
      {icon === null ? (
        <span className="thread-star">{AGENT_MARK}</span>
      ) : (
        <IconImage fade={icon.fade} icon={icon} key={icon.url} />
      )}
    </span>
  )
}

/**
 * An icon over the star. A new one fades in once loaded, the star fading
 * out under it; one there as the column mounts shows at once, with no star.
 * Keyed by its URL, so each new icon fades in.
 */
function IconImage({ icon, fade }: { icon: ThreadIcon; fade: boolean }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <>
      <span className="thread-star" data-gone={loaded || !fade || undefined}>
        {AGENT_MARK}
      </span>
      <ThreadIconImage
        className="thread-icon"
        data-fade={fade || undefined}
        data-loaded={loaded || undefined}
        icon={icon}
        onLoad={() => setLoaded(true)}
      />
    </>
  )
}
