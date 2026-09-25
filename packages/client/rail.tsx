// client/rail — the whole tree's shape, beside the columns.
//
// A dot per message and a line per parent link, drawn from `projectRail`. The
// rail is E (everything that exists); the lit column is T (what the agent
// reads). Colours come from one palette indexed by track, which the column
// headers and fork dots share, so a branch looks the same everywhere.

import { type AgentActivity, PENDING_TRACK, type RailRow } from "@pineta/core"

const PALETTE = [
  "#9ecbff",
  "#7bd88f",
  "#e0c080",
  "#f28b82",
  "#c792ea",
  "#80cbc4",
  "#ffab70",
  "#b2ccd6",
]

/**
 * A track's colour slot: its palette index, or "pending" for a fresh branch.
 * Elements carry it as `data-color`, so CSS can link a column header with its
 * fork dots on hover without any component state.
 */
export const colorSlot = (track: number): string =>
  track === PENDING_TRACK ? "pending" : String(track % PALETTE.length)

/** A track's colour. A fresh branch, which has no track yet, is grey. */
export const trackColor = (track: number): string =>
  track === PENDING_TRACK ? "#777" : (PALETTE[track % PALETTE.length] ?? "#777")

const ROW = 16
const GAP = 12
const PAD = 8
/** A dot's radius. */
const DOT = 4
const x = (track: number) => PAD + track * GAP
const y = (row: number) => PAD + row * ROW

export function Rail({
  rows,
  open,
  activity,
  onPick,
}: {
  rows: readonly RailRow[]
  /** Ids on any open column's path: drawn at full strength. */
  open: ReadonlySet<string>
  activity: AgentActivity
  onPick: (id: string) => void
}) {
  const rowOf = new Map(rows.map((r, i) => [r.id, i]))
  const tracks = rows.reduce((n, r) => Math.max(n, r.track + 1), 1)
  return (
    <nav aria-label="the whole tree" id="rail">
      <svg height={y(rows.length)} width={x(tracks)}>
        <title>every message, as a dot on its branch's track</title>
        {rows.map((r, i) => {
          const from = r.parentId === null ? undefined : rowOf.get(r.parentId)
          if (from === undefined || r.parentTrack === null) return null
          // Down the parent's track to its row, then across and down the
          // child's: a branch leaves its parent and runs on its own rail.
          const d =
            r.track === r.parentTrack
              ? `M${x(r.track)},${y(from)} L${x(r.track)},${y(i)}`
              : `M${x(r.parentTrack)},${y(from)} L${x(r.track)},${y(from) + ROW / 2} L${x(r.track)},${y(i)}`
          return (
            <path
              d={d}
              fill="none"
              key={`e-${r.id}`}
              opacity={open.has(r.id) ? 1 : 0.35}
              stroke={trackColor(r.track)}
              strokeWidth={2}
            />
          )
        })}
      </svg>
      {/* Dots are buttons over the drawing, so they are reachable by keyboard
          and read as controls. */}
      {rows.map((r, i) => (
        <button
          aria-label="open this message's thread"
          className={
            activity.kind === "replying" && activity.tip === r.id
              ? "rail-dot pulse"
              : "rail-dot"
          }
          data-entry={r.id}
          data-open={open.has(r.id) ? "yes" : "no"}
          data-track={r.track}
          key={r.id}
          onClick={() => onPick(r.id)}
          style={{
            left: x(r.track) - DOT,
            top: y(i) - DOT,
            background: trackColor(r.track),
            opacity: open.has(r.id) ? 1 : 0.35,
          }}
          type="button"
        />
      ))}
    </nav>
  )
}
