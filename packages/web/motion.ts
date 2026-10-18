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

/**
 * `el`'s box as laid out, in the viewport: its offsets up to the first fixed
 * ancestor, which no transform moves, so a slot of a panel still growing
 * reads where it will be once grown. Scrolling between them is not
 * counted: the inventory's bag does not scroll.
 */
export function layoutBox(el: HTMLElement): {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
} {
  let left = 0
  let top = 0
  let at: HTMLElement | null = el
  while (at !== null) {
    left += at.offsetLeft
    top += at.offsetTop
    const parent: Element | null = at.offsetParent
    if (!(parent instanceof HTMLElement)) break
    left += parent.clientLeft
    top += parent.clientTop
    at = parent
  }
  return { left, top, width: el.offsetWidth, height: el.offsetHeight }
}

/**
 * A fixed copy of `el` drawn over the page, not yet attached: what a drag
 * draws off the strip, and a flight into the inventory flies.
 */
export function fixedCopy(el: Element, className: string): HTMLElement {
  const copy = document.createElement("div")
  copy.className = className
  copy.append(el.cloneNode(true))
  return copy
}
