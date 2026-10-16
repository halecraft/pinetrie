// web/use-fold-motion — a column moves into its fold and out of it: its name
// turns onto its strip's, its mark moves to the strip's, the rest of it
// fades, and its right edge, which the columns after it follow, closes in.
// What moves where is `planFoldMotion`'s; this measures and plays it.
//
// A fold animates the live column, then lands, and lets go of the motion
// only once the strip is drawn: let go before, and the old layout shows for
// a frame. An unfold lands first, then animates the column it draws, before
// that column is painted. Every animation carries `FOLD_ANIMATION`, so
// `settleFolds` finds what is moving.

import {
  type ColumnMotion,
  type FoldMotion,
  type FoldScene,
  planFoldMotion,
  type Rect,
} from "@pinetrie/interface"
import type { RefObject } from "react"
import {
  FOLD_ANIMATION,
  reducedMotion,
  settleFolds,
  whenDrawn,
} from "./motion.ts"
import { useStable } from "./use-stable.ts"

/** How long a strip's own parts take to fade in once it is drawn, in ms. */
const STRIP_FADE_MS = 100

const rect = (el: Element): Rect => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** The column `motion` names in `strip`, folded or wide, as asked; null when it is not drawn so. */
function columnIn(
  strip: HTMLElement,
  column: ColumnMotion["column"],
  folded: boolean,
): HTMLElement | null {
  const el =
    column.kind === "canvas"
      ? strip.querySelector<HTMLElement>(":scope > .canvas-column")
      : strip.querySelector<HTMLElement>(
          `:scope > [data-card="${CSS.escape(column.card)}"]`,
        )
  return el !== null && el.classList.contains("folded-column") === folded
    ? el
    : null
}

const px = (style: CSSStyleDeclaration, name: string): number =>
  Number.parseFloat(style.getPropertyValue(name)) || 0

/** What a fold of `column` sees, measured from it wide. */
function gather(
  strip: HTMLElement,
  column: HTMLElement,
  unfolding: boolean,
): FoldScene {
  const name = column.querySelector("[data-fold-name]")
  const mark = column.querySelector("[data-fold-mark]")
  const style = getComputedStyle(column)
  return {
    unfolding,
    wide: {
      column: rect(column),
      name: name === null ? null : rect(name),
      mark: mark === null ? null : rect(mark),
    },
    stripMark: column.dataset.kind === "thread",
    geometry: {
      width: px(style, "--strip-width"),
      markTop: px(style, "--strip-mark-top"),
      nameTop: px(style, "--strip-name-top"),
      nameMax: px(style, "--strip-name-max"),
    },
    line:
      name === null
        ? 0
        : Number.parseFloat(getComputedStyle(name).lineHeight) || 0,
    view: rect(strip),
    scroll: {
      left: strip.scrollLeft,
      width: strip.scrollWidth,
      client: strip.clientWidth,
    },
    reducedMotion: reducedMotion(),
    dragging:
      strip.dataset.reordering !== undefined ||
      document.body.dataset.cardDrag !== undefined,
  }
}

/**
 * Everything in `column` but `kept` and what holds them: each element
 * beside the path from a kept element up to the column, and the generated
 * content (a name's ▸) of the elements on that path. With nothing kept, the
 * column's children.
 */
function around(
  column: HTMLElement,
  kept: readonly Element[],
): { readonly elements: Element[]; readonly pseudos: Element[] } {
  const path = new Set<Element>()
  for (const k of kept)
    for (
      let e: Element | null = k;
      e !== null && e !== column;
      e = e.parentElement
    )
      path.add(e)
  const elements: Element[] = []
  const pseudos: Element[] = []
  const holders = [column, ...[...path].filter(e => !kept.includes(e))]
  for (const holder of holders) {
    for (const child of holder.children)
      if (!path.has(child)) elements.push(child)
    if (
      holder !== column &&
      getComputedStyle(holder, "::after").content !== "none"
    )
      pseudos.push(holder)
  }
  return { elements, pseudos }
}

/** What in `el` turns or moves under `motion`, rather than fading: its name, its mark. */
function keptIn(el: Element, motion: FoldMotion): Element[] {
  const name = el.querySelector("[data-fold-name]")
  const mark = el.querySelector("[data-fold-mark]")
  return [
    ...(motion.turn === null || name === null ? [] : [name]),
    ...(motion.mark === null || mark === null ? [] : [mark]),
  ]
}

const timing = (motion: FoldMotion): KeyframeAnimationOptions => ({
  id: FOLD_ANIMATION,
  duration: motion.duration,
  easing: "linear",
  fill: "forwards",
})

/**
 * Play `motion` on the wide `column` in `strip`; its animations, the first
 * the column's own edge. Folding or unfolding is in `motion`'s frames.
 */
function play(
  strip: HTMLElement,
  column: HTMLElement,
  motion: FoldMotion,
): Animation[] {
  const { frames, clamp } = motion
  const opts = timing(motion)
  const shift = (f: (typeof frames)[number]) => clamp * f.fold
  const anims = [
    column.animate(
      frames.map(f => ({
        offset: f.offset,
        clipPath: `inset(0 ${f.inset}px 0 0)`,
        transform: `translateX(${shift(f)}px)`,
      })),
      opts,
    ),
  ]
  let after = false
  for (const sibling of strip.children) {
    if (sibling === column) {
      after = true
      continue
    }
    if (!after && clamp === 0) continue
    anims.push(
      sibling.animate(
        frames.map(f => ({
          offset: f.offset,
          transform: `translateX(${shift(f) - (after ? f.inset : 0)}px)`,
        })),
        opts,
      ),
    )
  }
  const name = column.querySelector("[data-fold-name]")
  const { turn } = motion
  if (turn !== null && name !== null)
    anims.push(
      name.animate(
        frames.map(f => ({
          offset: f.offset,
          transformOrigin: "0 0",
          transform: `translate(${turn.dx * f.fold}px, ${turn.dy * f.fold}px) rotate(${90 * f.fold}deg)`,
        })),
        opts,
      ),
    )
  const mark = column.querySelector("[data-fold-mark]")
  const by = motion.mark
  if (by !== null && mark !== null)
    anims.push(
      mark.animate(
        frames.map(f => ({
          offset: f.offset,
          transform: `translate(${by.dx * f.fold}px, ${by.dy * f.fold}px)`,
        })),
        opts,
      ),
    )
  const fading = around(column, keptIn(column, motion))
  const fade = [...motion.fade]
  for (const el of fading.elements) anims.push(el.animate(fade, opts))
  for (const el of fading.pseudos)
    anims.push(el.animate(fade, { ...opts, pseudoElement: "::after" }))
  return anims
}

/** A strip just drawn: what did not turn or move into it fades in. */
function fadeIn(strip: HTMLElement, motion: FoldMotion): void {
  for (const el of around(strip, keptIn(strip, motion)).elements)
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      id: FOLD_ANIMATION,
      duration: STRIP_FADE_MS,
    })
}

/** The `foldColumn` port: move a column into its fold or out of it, landing it with `commit`. */
export function useFoldMotion(
  stripRef: RefObject<HTMLElement | null>,
): (motion: ColumnMotion, commit: () => void) => void {
  return useStable((motion: ColumnMotion, commit: () => void) => {
    settleFolds()
    const strip = stripRef.current
    if (strip === null) return commit()
    if (motion.unfolded) {
      if (columnIn(strip, motion.column, true) === null) return commit()
      whenDrawn(
        strip,
        () => columnIn(strip, motion.column, false),
        column => {
          const planned = planFoldMotion(gather(strip, column, true))
          if (planned === null) return
          const anims = play(strip, column, planned)
          // Nothing holds once open: the column is where its layout puts it.
          void anims[0]?.finished.then(
            () => {
              for (const a of anims) a.cancel()
            },
            () => {},
          )
        },
      )
      return commit()
    }
    const column = columnIn(strip, motion.column, false)
    const planned =
      column === null ? null : planFoldMotion(gather(strip, column, false))
    if (column === null || planned === null) return commit()
    column.inert = true
    const anims = play(strip, column, planned)
    const letGo = () => {
      for (const a of anims) a.cancel()
      column.inert = false
    }
    // Cancelled rather than finished, it lands all the same: the port
    // commits once, whatever becomes of its motion.
    const land = () => {
      whenDrawn(
        strip,
        () => columnIn(strip, motion.column, true),
        drawn => {
          letGo()
          fadeIn(drawn, planned)
        },
        { giveUp: letGo },
      )
      commit()
    }
    const edge = anims[0]
    if (edge === undefined) return land()
    void edge.finished.then(land, land)
  })
}
