// client/rail — one root's tree, beside its columns (ADR-0029).
//
// A dot per message and a line per parent link, drawn from `projectRail`. The
// rail is E (everything in this root); the lit column is T (what the agent
// reads). Colours come from one palette indexed by track, which the column
// headers and fork dots share, so a branch looks the same everywhere.

import { type AgentRun, PENDING_TRACK, type RailRow } from "@pineta/core"

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
  here,
  notes,
  notesPanel,
}: {
  rows: readonly RailRow[]
  /** Ids on any open column's path: drawn at full strength. */
  open: ReadonlySet<string>
  /** Every running lane: each tip pulses, whether or not a column shows it. */
  activity: readonly AgentRun[]
  onPick: (id: string) => void
  /** Others following each thread end, with their names and colours: a ring there. */
  here: ReadonlyMap<string, readonly { name: string; color: string }[]>
  /** Messages that are notes' (ADR-0025): drawn as squares. */
  notes: ReadonlySet<string>
  /**
   * The notes index's toggle, at the rail's top, counting this root's notes.
   * The index itself is drawn by the app, over the columns: the rail scrolls,
   * so it would clip it. Absent where there is no index: the Archive tab's
   * preview.
   */
  notesPanel?: {
    readonly count: number
    readonly open: boolean
    readonly toggle: () => void
  }
}) {
  const rowOf = new Map(rows.map((r, i) => [r.id, i]))
  const tracks = rows.reduce((n, r) => Math.max(n, r.track + 1), 1)
  return (
    <nav aria-label="this thread's tree" className="rail">
      {notesPanel !== undefined && (
        <button
          aria-expanded={notesPanel.open}
          className="notes-toggle"
          onClick={notesPanel.toggle}
          title="every note in this thread"
          type="button"
        >
          notes ({notesPanel.count})
        </button>
      )}
      <div className="rail-tree">
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
        {rows.map((r, i) => {
          const people = here.get(r.id) ?? []
          const [first] = people
          return (
            <button
              aria-label="open this message's thread"
              className={[
                "rail-dot",
                activity.some(run => run.tip === r.id) ? "pulse" : "",
                notes.has(r.id) ? "noted" : "",
              ]
                .filter(c => c !== "")
                .join(" ")}
              data-entry={r.id}
              data-here={people.length > 0 ? String(people.length) : undefined}
              data-open={open.has(r.id) ? "yes" : "no"}
              data-track={r.track}
              key={r.id}
              onClick={() => onPick(r.id)}
              style={{
                left: x(r.track) - DOT,
                top: y(i) - DOT,
                background: trackColor(r.track),
                opacity: open.has(r.id) || first !== undefined ? 1 : 0.35,
                // Someone else follows this thread: a ring in their colour, with
                // a dark gap so it reads against any track's colour. The dot is
                // 8 px, so the rail marks and the column header names.
                boxShadow:
                  first === undefined
                    ? undefined
                    : `0 0 0 1.5px #14161a, 0 0 0 3.5px ${first.color}`,
              }}
              title={
                people.length === 0
                  ? undefined
                  : `here: ${people.map(p => p.name).join(", ")}`
              }
              type="button"
            >
              {people.length > 1 && (
                <span className="here-count">{people.length}</span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
