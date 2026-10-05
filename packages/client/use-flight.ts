// client/use-flight — a moved card flies from where it was to where it lands
// (ADR-0048: a move shows where it went). The shell measures the card's box
// before the move; once the card is drawn somewhere else, that element
// animates from the old box to its own (Web Animations).

import type { CardId } from "@pinetrie/core"
import { useStable } from "./use-stable.ts"

/** How long a flight lasts, and how long a take into a closed inventory keeps it open. */
export const FLIGHT_MS = 450

/** How many frames to wait for the card to be drawn in its new place. */
const LOOK_FRAMES = 60

const drawnAt = (card: CardId): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(
    `[data-card="${CSS.escape(card)}"]`,
  ),
]

/** Measure `card` now, and fly it to wherever it is next drawn. */
export function useFlight(): (card: CardId) => void {
  return useStable((card: CardId) => {
    const from = drawnAt(card)[0]?.getBoundingClientRect()
    if (from === undefined) return
    let frames = 0
    const look = () => {
      frames++
      const el = drawnAt(card).find(e => {
        const box = e.getBoundingClientRect()
        return (
          box.width > 0 &&
          (Math.abs(box.left - from.left) > 2 ||
            Math.abs(box.top - from.top) > 2)
        )
      })
      if (el === undefined) {
        if (frames < LOOK_FRAMES) requestAnimationFrame(look)
        return
      }
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
    requestAnimationFrame(look)
  })
}
