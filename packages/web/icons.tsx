// web/icons — the page's drawn icons, in the text's colour, so a control's
// rest, hover and pressed colours are its CSS alone: the footer corner's inbox
// and inventory, copy (two sheets) wherever a copy is offered, the
// inventory's box with an arrow into it (take) or out of it (put), the same
// wherever take and put are offered, a bin wherever a card is trashed, and
// the footer's machine, marked by its state.
// Drawn, not a character: U+1F5D1 is missing from common fonts.

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

/**
 * A machine: a box with two drives. Amber adds a triangle at its corner,
 * red a disc with a bar, so a state is told by its shape as well as its
 * colour.
 */
/** Each machine state, as the stylesheet names it (`data-health`): what it does to work, never a colour. */
export const HEALTH = {
  neutral: "keeping-up",
  amber: "slowed",
  red: "stopped",
} as const

export const MachineIcon = ({
  state,
}: {
  state: "neutral" | "amber" | "red"
}) => (
  <svg {...ICON} aria-hidden="true" className="icon">
    <rect height="9" rx="1" width="10" x="1.5" y="2" />
    <path d="M4 5h5M4 8h5" />
    {state === "amber" ? (
      <path d="M12 8.5 15 14H9Z" fill="currentColor" />
    ) : state === "red" ? (
      <>
        <circle cx="12" cy="11.5" fill="currentColor" r="3.25" />
        <path d="M10.5 11.5h3" stroke="var(--surface)" />
      </>
    ) : null}
  </svg>
)

/** A bin with its lid: trash, wherever a card is trashed; × only closes. */
export const TrashIcon = () => (
  <svg {...ICON} aria-hidden="true" className="icon">
    <path d="M2.5 4.5h11M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5" />
    <path d="M3.8 4.5 4.5 13a1 1 0 0 0 1 .9h5a1 1 0 0 0 1-.9l.7-8.5" />
    <path d="M6.5 7v4.5M9.5 7v4.5" />
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
