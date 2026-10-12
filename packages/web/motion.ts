// web/motion — what the page's animations share: whether the reader asked
// for less motion, waiting for an element to be drawn, and the folds in
// flight (`use-fold-motion.ts`), which a drag's press settles.

/** How many frames to wait for something to be drawn before giving up. */
const LOOK_FRAMES = 60

/** The reader asked for less motion: flights, springs and folds have none. */
export const reducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Call `then` with what `find` finds, once it finds something: checked on
 * every mutation under `root`, which runs after React's commit and before
 * the paint, and on every frame, for a change no mutation under `root`
 * makes. Gives up after `frames` frames, calling `giveUp`. Returns a cancel.
 * `find` is not tried at once: what it looks for comes after the call.
 */
export function whenDrawn<T>(
  root: Node,
  find: () => T | null,
  then: (found: T) => void,
  opts: { readonly frames?: number; readonly giveUp?: () => void } = {},
): () => void {
  let done = false
  let left = opts.frames ?? LOOK_FRAMES
  let frame = 0
  const stop = () => {
    done = true
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
  const look = (): boolean => {
    if (done) return true
    const found = find()
    if (found === null) return false
    stop()
    then(found)
    return true
  }
  const observer = new MutationObserver(() => look())
  const tick = () => {
    if (look()) return
    left--
    if (left > 0) frame = requestAnimationFrame(tick)
    else {
      stop()
      opts.giveUp?.()
    }
  }
  observer.observe(root, { childList: true, subtree: true })
  frame = requestAnimationFrame(tick)
  return stop
}

/** The id every animation of a fold carries, so whatever is moving can be found. */
export const FOLD_ANIMATION = "fold"

/**
 * Bring every fold in flight to its end at once: each one's own end runs,
 * so a fold still animating lands. The page's running animations are the
 * only record of what is moving.
 */
export function settleFolds(): void {
  for (const a of document.getAnimations())
    if (a.id === FOLD_ANIMATION) a.finish()
}
