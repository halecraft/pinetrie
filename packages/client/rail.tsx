// client/rail — one root's tree, beside its columns (ADR-0029).
//
// A dot per message, a capsule per stretch of uneventful messages, and a line
// per parent link, drawn from `compactRail`. The rail is E (everything in this
// root); the lit column is T (what the agent reads). Colours come from one palette indexed by track, which the column
// headers and fork dots share, so a branch looks the same everywhere.

import {
  type AgentRun,
  PENDING_TRACK,
  type RailItem,
  type RailRun,
  type WriterId,
} from "@pineta/core"
import { pickAt, type RunFill, runFill, runLabel } from "./rail-view.ts"

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
/** The panel behind the rail: a ring's gap, and a capsule's unfilled part. */
const PANEL = "#14161a"
const x = (track: number) => PAD + track * GAP
const y = (slot: number) => PAD + slot * ROW

export function Rail({
  items,
  open,
  activity,
  onPick,
  here,
  notes,
  nameOf,
  notesPanel,
}: {
  items: readonly RailItem[]
  /** Ids on any open column's path: marked `data-open`. */
  open: ReadonlySet<string>
  /** Every running lane: each tip pulses, whether or not a column shows it. */
  activity: readonly AgentRun[]
  onPick: (id: string) => void
  /** Others following each thread end, with their names and colours: a ring there. */
  here: ReadonlyMap<string, readonly { name: string; color: string }[]>
  /** Messages that are notes' (ADR-0025): drawn as squares. */
  notes: ReadonlySet<string>
  /** A writer's name, for a capsule's label. */
  nameOf: (writer: WriterId) => string
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
  // Every message, a run's included, to the item that draws it.
  const itemOf = new Map(items.flatMap(it => it.ids.map(id => [id, it])))
  const tracks = items.reduce((n, it) => Math.max(n, it.track + 1), 1)
  const last = items.at(-1)
  const slots = last === undefined ? 0 : last.slot + last.span
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
        <svg height={y(slots)} width={x(tracks)}>
          <title>
            every message, as a dot on its branch's track, or in a capsule
          </title>
          {items.map(it => {
            const parent =
              it.parentId === null ? undefined : itemOf.get(it.parentId)
            if (parent === undefined || it.parentTrack === null) return null
            // An edge leaves its parent's last slot: a run's bottom.
            const from = parent.slot + parent.span - 1
            // Down the parent's track to its row, then across and down the
            // child's: a branch leaves its parent and runs on its own rail.
            const d =
              it.track === it.parentTrack
                ? `M${x(it.track)},${y(from)} L${x(it.track)},${y(it.slot)}`
                : `M${x(it.parentTrack)},${y(from)} L${x(it.track)},${y(from) + ROW / 2} L${x(it.track)},${y(it.slot)}`
            return (
              <path
                d={d}
                fill="none"
                key={`e-${it.ids[0]}`}
                stroke={trackColor(it.track)}
                strokeWidth={2}
              />
            )
          })}
        </svg>
        {/* Dots and capsules are buttons over the drawing, so they are
          reachable by keyboard and read as controls. */}
        {items.map(it =>
          it.kind === "run" ? (
            <Capsule
              key={it.ids[0]}
              label={runLabel(it.ids.length, it.stats, nameOf)}
              onPick={onPick}
              open={open.has(it.ids[0])}
              run={it}
            />
          ) : (
            <Dot
              activity={activity}
              id={it.ids[0]}
              key={it.ids[0]}
              noted={notes.has(it.ids[0])}
              onPick={onPick}
              open={open.has(it.ids[0])}
              people={here.get(it.ids[0]) ?? []}
              slot={it.slot}
              track={it.track}
            />
          ),
        )}
      </div>
    </nav>
  )
}

function Dot(p: {
  id: string
  slot: number
  track: number
  open: boolean
  noted: boolean
  activity: readonly AgentRun[]
  people: readonly { name: string; color: string }[]
  onPick: (id: string) => void
}) {
  const [first] = p.people
  return (
    <button
      aria-label="open this message's thread"
      className={[
        "rail-dot",
        p.activity.some(run => run.tip === p.id) ? "pulse" : "",
        p.noted ? "noted" : "",
      ]
        .filter(c => c !== "")
        .join(" ")}
      data-entry={p.id}
      data-here={p.people.length > 0 ? String(p.people.length) : undefined}
      data-open={p.open ? "yes" : "no"}
      data-track={p.track}
      onClick={() => p.onPick(p.id)}
      style={{
        left: x(p.track) - DOT,
        top: y(p.slot) - DOT,
        background: trackColor(p.track),
        // Someone else follows this thread: a ring in their colour, with a
        // dark gap so it reads against any track's colour. The dot is 8 px,
        // so the rail marks and the column header names.
        boxShadow:
          first === undefined
            ? undefined
            : `0 0 0 1.5px ${PANEL}, 0 0 0 3.5px ${first.color}`,
      }}
      title={
        p.people.length === 0
          ? undefined
          : `here: ${p.people.map(person => person.name).join(", ")}`
      }
      type="button"
    >
      {p.people.length > 1 && (
        <span className="here-count">{p.people.length}</span>
      )}
    </button>
  )
}

/**
 * A run: a capsule on its track, `span` rows long (one, and one more per digit
 * of its size), filled by who wrote it (`runFill`). A click opens the message at that point of the run (`pickAt`); the
 * column is where a run is read.
 */
/** A capsule's background in its track's colour, by `runFill`. */
const FILL: Record<RunFill, (color: string) => string> = {
  agent: () => PANEL,
  people: color => color,
  // Half strength, blended with the panel rather than transparent: the track's
  // line runs under a capsule's ends and would show through.
  mixed: color => `color-mix(in srgb, ${color} 50%, ${PANEL})`,
}

function Capsule(p: {
  run: RailRun
  label: string
  open: boolean
  onPick: (id: string) => void
}) {
  const { run } = p
  const color = trackColor(run.track)
  const fill = runFill(run.ids.length, run.stats)
  return (
    <button
      aria-label={p.label}
      className="rail-run"
      data-count={run.ids.length}
      data-entry={run.ids[0]}
      data-fill={fill}
      data-open={p.open ? "yes" : "no"}
      data-span={run.span}
      data-track={run.track}
      onClick={e => {
        const box = e.currentTarget.getBoundingClientRect()
        // A click from the keyboard has no point: `detail` is 0.
        const at = e.detail === 0 ? null : (e.clientY - box.top) / box.height
        p.onPick(pickAt(run.ids, at))
      }}
      style={{
        left: x(run.track) - DOT,
        top: y(run.slot) - ROW / 2 + 2,
        height: run.span * ROW - 4,
        borderColor: color,
        background: FILL[fill](color),
      }}
      title={p.label}
      type="button"
    />
  )
}
