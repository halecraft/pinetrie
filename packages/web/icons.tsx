// web/icons — the page's drawn icons, in the text's colour, so a control's
// rest, hover and pressed colours are its CSS alone: the footer corner's inbox
// and inventory, copy (two sheets) wherever a copy is offered, and the
// inventory's box with an arrow into it (take) or out of it (put), the same
// wherever take and put are offered.

const ICON = {
  fill: "none",
  height: 16,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 1.5,
  viewBox: "0 0 16 16",
  width: 16,
} as const

/** A tray: your inbox. */
export const InboxIcon = () => (
  <svg {...ICON} aria-hidden="true" className="icon">
    <path d="M2 9.5 3.6 3.2A1 1 0 0 1 4.6 2.5h6.8a1 1 0 0 1 1 .7L14 9.5V13a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 2 13Z" />
    <path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" />
  </svg>
)

/**
 * A box with a lid: your inventory. With `way`, an arrow into it (take) or
 * out of it (put) where its handle was.
 */
export const InventoryIcon = ({ way }: { way?: "take" | "put" }) => (
  <svg {...ICON} aria-hidden="true" className="icon">
    <rect height="3" rx=".5" width="12" x="2" y="2.5" />
    <path d="M3 5.5V13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V5.5" />
    {way === undefined ? (
      <path d="M6.5 8.5h3" />
    ) : way === "take" ? (
      <path d="M8 7.5v4M6.5 10 8 11.5 9.5 10" />
    ) : (
      <path d="M8 11.5v-4M6.5 9 8 7.5 9.5 9" />
    )}
  </svg>
)

/** Two overlapping sheets: copy, 1em square. */
export const CopyIcon = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="1em"
    stroke="currentColor"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 16 16"
    width="1em"
  >
    <rect height="9" rx="1.5" width="9" x="5.5" y="5.5" />
    <path d="M10.5 3V2.5A1.5 1.5 0 0 0 9 1H2.5A1.5 1.5 0 0 0 1 2.5V9a1.5 1.5 0 0 0 1.5 1.5H3" />
  </svg>
)
