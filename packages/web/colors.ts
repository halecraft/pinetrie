// web/colors — the page's colour for each palette slot: the stylesheet's
// `--slot-N` (`index.html`). Which slot a track takes is `palette.ts`'s, the
// same in any client.

import type { ColorSlot } from "@pinetrie/interface"

export const slotColor = (slot: ColorSlot): string => `var(--slot-${slot})`
