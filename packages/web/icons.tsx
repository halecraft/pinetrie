// web/icons — the footer corner's icons (ADR-0098): drawn in the text's
// colour, so a control's rest, hover and pressed colours are its CSS alone.

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

/** A box with a lid: your inventory. */
export const InventoryIcon = () => (
  <svg {...ICON} aria-hidden="true" className="icon">
    <rect height="3" rx=".5" width="12" x="2" y="2.5" />
    <path d="M3 5.5V13a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V5.5" />
    <path d="M6.5 8.5h3" />
  </svg>
)
