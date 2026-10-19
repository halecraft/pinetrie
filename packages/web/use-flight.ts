// web/use-flight — a moved card flies from where it was to where it lands,
// so a move shows where it went. The shell measures the card's box before
// the move; once the card is drawn somewhere else, that element animates
// from the old box to its own (Web Animations). Into your inventory it flies
// as a ghost on the page instead (`Flight`), since the panel may still be
// growing from its toggle. Under reduced motion it lands without flying.

import type { Flight } from "@pinetrie/interface"
import type { CardId } from "@pinetrie/threads"
import { fixedCopy, layoutBox, reducedMotion, whenDrawn } from "./motion.ts"
import { useStable } from "./use-stable.ts"

/** How long a flight lasts. */
export const FLIGHT_MS = 450

const drawnAt = (card: CardId): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(
    `[data-card="${CSS.escape(card)}"]`,
  ),
]

type Box = Pick<DOMRect, "left" | "top" | "width" | "height">

/** `el` animated from `from` to where it is drawn. */
function flyInPlace(el: HTMLElement, from: Box): void {
  const to = el.getBoundingClientRect()
  el.animate(
    [
      {
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`,
        opacity: 0.5,
      },
      { transform: "none", opacity: 1 },
    ],
    { duration: FLIGHT_MS, easing: "ease-out" },
  )
}

/**
 * A ghost of `el` flown on the page from `from` to `el`'s box as laid out,
 * `el` hidden until it lands. Flown inside a panel still growing, `el` would
 * start hundreds of pixels from where it was.
 */
function flyGhost(el: HTMLElement, from: Box): void {
  const to = layoutBox(el)
  const ghost = fixedCopy(el, "flight-ghost")
  const panel = el.closest<HTMLElement>(".inventory")
  if (panel !== null)
    ghost.style.setProperty("--you", panel.style.getPropertyValue("--you"))
  Object.assign(ghost.style, {
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
  })
  document.body.append(ghost)
  el.style.visibility = "hidden"
  const land = () => {
    ghost.remove()
    el.style.visibility = ""
  }
  const scale = `scale(${from.width / to.width}, ${from.height / to.height})`
  ghost
    .animate(
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) ${scale}`,
          opacity: 0.6,
        },
        { transform: "none", opacity: 1 },
      ],
      { duration: FLIGHT_MS, easing: "ease-out" },
    )
    // Cancelled too, it lands.
    .finished.then(land, land)
}

/** Measure `card` now, and fly it to wherever it is next drawn, as `how` says. */
export function useFlight(): (card: CardId, how: Flight) => void {
  return useStable((card: CardId, how: Flight) => {
    if (reducedMotion()) return
    const from = drawnAt(card)[0]?.getBoundingClientRect()
    if (from === undefined) return
    // A card lands anywhere on the page: a slot, a dock, the strip.
    whenDrawn(
      document.body,
      () =>
        drawnAt(card).find(e => {
          const box = e.getBoundingClientRect()
          return (
            box.width > 0 &&
            (Math.abs(box.left - from.left) > 2 ||
              Math.abs(box.top - from.top) > 2)
          )
        }) ?? null,
      el => (how === "ghost" ? flyGhost(el, from) : flyInPlace(el, from)),
    )
  })
}
