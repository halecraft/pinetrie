// web/popover-place — where a popover's box goes (`popover.tsx`). Pure.

/** Where an open box goes, and how tall it may be. */
export type Placement = (
  | { readonly top: number }
  | { readonly bottom: number }
) &
  ({ readonly right: number } | { readonly left: number }) & {
    readonly maxHeight: number
  }

/** The gap kept between a box and the window's edge it opens towards, in px. */
export const EDGE = 8

/**
 * Below its trigger; above it when the trigger is in the window's lower
 * half (a composer's, the footer's), or the box would open past the
 * window's foot. Its right edge at the trigger's; its left edge at the
 * trigger's when the trigger is in the window's left half (the sidebar's,
 * your avatar's), or the box would open past the window's left. As tall as
 * the room on the side it opens to, so a long list scrolls inside it.
 */
export function placeBox(
  trigger: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  view: { readonly width: number; readonly height: number },
): Placement {
  const side =
    trigger.left < view.width / 2
      ? { left: trigger.left }
      : { right: view.width - trigger.right }
  return trigger.bottom > view.height / 2
    ? {
        bottom: view.height - trigger.top,
        ...side,
        maxHeight: trigger.top - EDGE,
      }
    : {
        top: trigger.bottom,
        ...side,
        maxHeight: view.height - trigger.bottom - EDGE,
      }
}
