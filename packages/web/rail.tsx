// web/rail — one root's tree, beside its columns.
//
// A dot per message, a capsule per stretch of uneventful messages, and a line
// per parent link, drawn from `compactRail`. A long ask is a dot and a capsule
// of its own. The rail is E (everything in this root); the lit column is T
// (what the agent reads). A track's colour comes from the palette, seeded by
// the root (`useTrackColors`), and the column headers and fork dots take the
// same, so a branch looks the same everywhere.

import type {
  AgentRun,
  AskIndex,
  DigestBody,
  EntryId,
  RailRow,
  RevisionRecord,
  TreeIndex,
  WriterId,
} from "@pinetrie/core"
import {
  askLine,
  compactRail,
  matchCountWords,
  opens,
  pickAt,
  type RailItem,
  type RailStretch,
  type RailStub,
  railItems,
  railKeep,
  railScroll,
  railView,
  type SearchResult,
  type StretchFill,
  signalWords,
  stretchFill,
  stretchWords,
  type ThreadLink,
  type Tick,
  type ViewportStore,
  workWords,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import {
  type ComponentProps,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react"
import { useTrackColors } from "./palette-context.ts"
import { nameFor } from "./presence.tsx"
import { SignalMark } from "./signal-mark.tsx"
import { useReadingAt } from "./use-presence.ts"

const ROW = 16
const GAP = 12
const PAD = 8
/** A dot's radius. */
const DOT = 4
/** The panel behind the rail: a ring's gap, and a capsule's unfilled part. */
const PANEL = "#14161a"
const x = (across: number) => PAD + across * GAP
const y = (slot: number) => PAD + slot * ROW

/** A rail stub as drawn: where it forks, where it leads, and its words. */
interface DrawnStub {
  readonly stub: RailStub
  readonly label: string
  readonly title: string
}

export function Rail({
  index,
  items,
  stubs = [],
  onLink,
  open,
  activity,
  onPick,
  here,
  yours,
  nameOf,
  digests,
  viewports,
  matches,
}: {
  /** The tree the items were compacted from: a long ask's capsule names its ask. */
  index: TreeIndex
  /** Each ask's model-written digest, which a long ask's capsule shows. */
  digests: ReadonlyMap<EntryId, DigestBody>
  items: readonly RailItem[]
  /** Ids on any open column's path: marked `data-open`. */
  open: ReadonlySet<EntryId>
  /** Every running lane: each tip pulses, whether or not a column shows it. */
  activity: readonly AgentRun[]
  onPick: (id: EntryId) => void
  /** Others reading each thread end, with their names and colours: a ring there. */
  here: ReadonlyMap<EntryId, readonly { name: string; color: string }[]>
  /**
   * Thread ends holding an unsent card of yours (`UnsentSignals.ends`), with
   * your colour: each dot there carries a pip.
   */
  yours: { readonly ends: ReadonlySet<EntryId>; readonly color: string }
  /** A writer's name, for a capsule's label. */
  nameOf: (writer: WriterId) => string
  /** Each mounted column's view, outlined; none, no outlines. */
  viewports?: ViewportStore
  /** What a search finds here: the rest is dimmed. Null while not searching. */
  matches: SearchResult | null
  /**
   * Each fork to a thread on no column of this canvas, worded: a press follows
   * its link, which a thread someone else holds does not.
   */
  stubs?: readonly DrawnStub[]
  onLink?: (link: ThreadLink, at: EntryId) => void
}) {
  const colors = useTrackColors()
  // Every message, a stretch's included, to the item that draws it.
  const itemOf = new Map(items.flatMap(it => it.ids.map(id => [id, it])))
  const places = items.reduce((n, it) => Math.max(n, it.across + 1), 1)
  // Rows go by depth, so the last item in depth-first order need not be the lowest.
  const slots = items.reduce((n, it) => Math.max(n, it.slot + it.span), 0)
  return (
    <nav
      aria-label="this thread's tree"
      className="rail"
      data-searching={matches === null ? undefined : "yes"}
    >
      <div className="rail-tree">
        <svg height={y(slots)} width={x(places - 1) + PAD}>
          <title>
            every message, as a dot in its branch's colour, or in a capsule
          </title>
          {items.map(it => {
            const parent =
              it.parentId === null ? undefined : itemOf.get(it.parentId)
            if (parent === undefined) return null
            // An edge leaves its parent's last slot: a capsule's bottom.
            const from = parent.slot + parent.span - 1
            // A branch bends from its parent's place to its own within half
            // a row, then runs down to its first item on the next row.
            const d =
              it.across === parent.across
                ? `M${x(it.across)},${y(from)} L${x(it.across)},${y(it.slot)}`
                : `M${x(parent.across)},${y(from)} L${x(it.across)},${y(from) + ROW / 2} L${x(it.across)},${y(it.slot)}`
            return (
              <path
                d={d}
                fill="none"
                key={`e-${it.ids[0]}`}
                stroke={colors.color(it.track)}
                strokeWidth={2}
              />
            )
          })}
        </svg>
        {/* Dots and capsules are buttons over the drawing, so they are
          reachable by keyboard and read as controls. */}
        {railItems(items, { open, yours, matches }).map(([it, marks]) =>
          it.kind === "stretch" ? (
            <Capsule
              key={it.ids[0]}
              label={stretchWords(
                askLine(index, it.ask, nameOf),
                workWords(it.stats, nameOf),
                it.ask === null ? null : (digests.get(it.ask) ?? null),
              )}
              matches={marks.matches}
              onPick={onPick}
              open={marks.open}
              stretch={it}
            />
          ) : (
            <Dot
              activity={activity}
              id={it.ids[0]}
              key={it.ids[0]}
              yours={marks.yours}
              matches={marks.matches}
              onPick={onPick}
              open={marks.open}
              people={here.get(it.ids[0]) ?? []}
              across={it.across}
              slot={it.slot}
              track={it.track}
            />
          ),
        )}
        {/* After the dots: its ticks lie over the capsules, its outlines
          under everything (`.rail-view`'s z-index). */}
        {viewports !== undefined && (
          <RailViewport itemOf={itemOf} store={viewports} />
        )}
        {/* Each fork to a thread elsewhere: a stub beside the row it leaves. */}
        {stubs.map(({ stub, label, title }) => {
          const from = itemOf.get(stub.from)
          if (from === undefined) return null
          return (
            <button
              className="rail-stub"
              data-thread={stub.thread}
              disabled={onLink === undefined || !opens(stub.link)}
              key={stub.at}
              onClick={() => onLink?.(stub.link, stub.at)}
              style={{
                left: x(from.across) + GAP,
                top: y(from.slot) + ROW / 2,
              }}
              title={title}
              type="button"
            >
              {label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** An outline's width: a dot's, and a little room either side. */
const OUTLINE = 14
/** A tick's width: wider than a capsule, so its ends show on any fill. */
const TICK = 12

/**
 * Where a tick is drawn, in px: centred on its edge (or between two merged
 * edges), at least 2 px tall, and kept on its capsule's box.
 */
const tickBox = (t: Tick): { top: number; height: number } => {
  const top = y(t.slot) - ROW / 2 + 2
  const length = t.span * ROW - 4
  const height = Math.max(2, (t.to - t.from) * length)
  const middle = ((t.from + t.to) / 2) * length
  return {
    top: top + Math.min(length - height, Math.max(0, middle - height / 2)),
    height,
  }
}

/**
 * What each column shows, on the rail in its colour (`railView`): an outline
 * around the whole dots and capsules in its view, under them, and a tick across
 * a capsule where the view's top or bottom falls in it, over it. It reads the
 * columns' views itself, so a scroll redraws these alone. The rail follows the
 * view's own extent, not its outline: a capsule outlined whole can be far
 * taller than what is in view. The rail follows the column moved last: it
 * scrolls when that column's outline leaves its view (`railScroll`), unless the
 * reader has just scrolled the rail.
 */
function RailViewport({
  itemOf,
  store,
}: {
  itemOf: ReadonlyMap<string, RailItem>
  store: ViewportStore
}) {
  const views = useSyncExternalStore(store.subscribe, store.get)
  const colors = useTrackColors()
  const drawn = [...views.columns].map(
    ([key, v]) =>
      ({
        key,
        color: colors.color(v.track),
        ...railView(itemOf, v.ids, v.first, v.last),
      }) as const,
  )
  const outlines = drawn.flatMap(({ key, color, bands }) =>
    bands.map((b, n) => ({ key, n, color, ...b }) as const),
  )
  const ticks = drawn.flatMap(({ key, color, ticks }) =>
    ticks.map((t, n) => ({ key, n, color, ...t }) as const),
  )
  const anchor = useRef<HTMLSpanElement>(null)
  // The rail's own scroll: where it last put it, and when the reader last
  // moved it. While the pointer is over the rail, the reader is reading it.
  const set = useRef<number | null>(null)
  const reader = useRef(Number.NEGATIVE_INFINITY)
  const over = useRef(false)
  useEffect(() => {
    const rail = anchor.current?.closest<HTMLElement>(".rail")
    if (rail === null || rail === undefined) return
    const scrolled = () => {
      if (set.current === null || Math.abs(rail.scrollTop - set.current) > 1)
        reader.current = performance.now()
    }
    const enter = () => {
      over.current = true
    }
    const leave = () => {
      over.current = false
      reader.current = performance.now()
    }
    rail.addEventListener("scroll", scrolled, { passive: true })
    rail.addEventListener("pointerenter", enter)
    rail.addEventListener("pointerleave", leave)
    return () => {
      rail.removeEventListener("scroll", scrolled)
      rail.removeEventListener("pointerenter", enter)
      rail.removeEventListener("pointerleave", leave)
    }
  }, [])
  const followed = drawn.find(d => d.key === views.moved)?.extent ?? null
  // Only when a column's view moves: a redraw of the rail for anything else
  // leaves its scroll where the reader put it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the views change
  useLayoutEffect(() => {
    const tree = anchor.current?.parentElement
    const rail = tree?.closest<HTMLElement>(".rail")
    if (tree === null || tree === undefined) return
    if (rail === null || rail === undefined) return
    if (followed === null) return
    const band = {
      top: tree.offsetTop + y(followed.top),
      bottom: tree.offsetTop + y(followed.bottom),
    }
    const since = over.current ? 0 : performance.now() - reader.current
    const to = railScroll(band, rail, since)
    if (to === null) return
    rail.scrollTop = to
    set.current = rail.scrollTop
  }, [views])
  return (
    <>
      <span aria-hidden className="rail-anchor" ref={anchor} />
      {outlines.map(o => (
        <span
          aria-hidden
          className="rail-view"
          data-key={o.key}
          data-track={o.track}
          key={`${o.key}-${o.n}`}
          style={{
            left: x(o.across) - OUTLINE / 2,
            top: y(o.top),
            height: (o.bottom - o.top) * ROW,
            borderColor: o.color,
            background: `color-mix(in srgb, ${o.color} 10%, transparent)`,
          }}
        />
      ))}
      {ticks.map(t => (
        <span
          aria-hidden
          className="rail-tick"
          data-key={t.key}
          data-track={t.track}
          key={`${t.key}-${t.n}`}
          style={{
            left: x(t.across) - TICK / 2,
            width: TICK,
            ...tickBox(t),
            background: t.color,
            // A dark edge, so it shows on a capsule filled in its colour.
            boxShadow: `0 0 0 1px ${PANEL}`,
          }}
        />
      ))}
    </>
  )
}

/**
 * A root's rail with others' rings. It reads presence itself, so a presence
 * write redraws the rail and not the columns. Others' thread ends are kept
 * out of stretches (`railKeep`), so which items are drawn depends on
 * presence too.
 */
export function LiveRail({
  session,
  rows,
  ends,
  names,
  colorOf,
  asks,
  revisions,
  ...rail
}: {
  session: SessionClient
  /** The root's rows (`projectRail`), before compacting. */
  rows: readonly RailRow[]
  /** Every ask, which a long one's stretch keeps to (`indexAsks`). */
  asks: AskIndex
  /** The turns' revisions, whose paths a capsule counts. */
  revisions: ReadonlyMap<EntryId, RevisionRecord>
  /** Each open column's end (`ColumnView.tipId`). */
  ends: readonly (EntryId | null)[]
  names: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
} & Omit<ComponentProps<typeof Rail>, "items" | "here" | "nameOf">) {
  const reading = useReadingAt(session.presence, session.writer)
  const here = useMemo(
    () =>
      new Map(
        [...reading].map(([end, writers]) => [
          end,
          writers.map(w => ({ name: nameFor(names, w), color: colorOf(w) })),
        ]),
      ),
    [reading, names, colorOf],
  )
  const { index, activity, yours } = rail
  const items = useMemo(
    () =>
      compactRail(
        index,
        rows,
        railKeep({ rings: here, activity, ends, cards: yours.ends }),
        { asks, revisions },
      ),
    [index, rows, here, activity, ends, yours.ends, asks, revisions],
  )
  return (
    <Rail {...rail} here={here} items={items} nameOf={w => nameFor(names, w)} />
  )
}

/**
 * A canvas's rail before its first message, a new canvas's: a hollow dot where that message
 * will be drawn. It is as wide as the rail it
 * turns into, so the columns do not move when the first message lands.
 */
export function EmptyRail() {
  return (
    <nav aria-label="this thread's tree" className="rail">
      <div
        className="rail-tree"
        style={{ width: x(0) + PAD, height: y(0) + PAD }}
      >
        <span
          className="rail-start"
          style={{ left: x(0) - DOT, top: y(0) - DOT }}
          title="the first message goes here"
        />
      </div>
    </nav>
  )
}

function Dot(p: {
  id: EntryId
  slot: number
  across: number
  track: number
  open: boolean
  /** Your colour when a card of yours waits at this end; null otherwise. */
  yours: string | null
  activity: readonly AgentRun[]
  people: readonly { name: string; color: string }[]
  /** Its matches while searching (`RailMarks.matches`), else null. */
  matches: number | null
  onPick: (id: EntryId) => void
}) {
  const colors = useTrackColors()
  const [first] = p.people
  const here =
    p.people.length === 0
      ? undefined
      : `here: ${p.people.map(person => person.name).join(", ")}`
  return (
    <button
      aria-label="open this message's thread"
      className={[
        "rail-dot",
        p.activity.some(run => run.tip === p.id) ? "pulse" : "",
      ]
        .filter(c => c !== "")
        .join(" ")}
      data-entry={p.id}
      data-here={p.people.length > 0 ? String(p.people.length) : undefined}
      data-match={p.matches ?? undefined}
      data-open={p.open ? "yes" : "no"}
      data-track={p.track}
      onClick={() => p.onPick(p.id)}
      style={{
        left: x(p.across) - DOT,
        top: y(p.slot) - DOT,
        background: colors.color(p.track),
        // Someone else is reading this thread: a ring in their colour, with a
        // dark gap so it reads against any track's colour. The dot is 8 px,
        // so the rail marks and the column header names.
        boxShadow:
          first === undefined
            ? undefined
            : `0 0 0 1.5px ${PANEL}, 0 0 0 3.5px ${first.color}`,
      }}
      title={
        [
          p.matches === null || p.matches === 0
            ? undefined
            : matchCountWords(p.matches),
          here,
          p.yours === null ? undefined : signalWords("unsent"),
        ]
          .filter(t => t !== undefined)
          .join(" · ") || undefined
      }
      type="button"
    >
      {p.people.length > 1 && (
        <span className="here-count">{p.people.length}</span>
      )}
      {p.yours !== null && <SignalMark color={p.yours} signal="unsent" />}
    </button>
  )
}

/** A capsule's background in its track's colour, by `stretchFill`. */
const FILL: Record<StretchFill, (color: string) => string> = {
  agent: () => PANEL,
  people: color => color,
  // Half strength, blended with the panel rather than transparent: the track's
  // line runs under a capsule's ends and would show through.
  mixed: color => `color-mix(in srgb, ${color} 50%, ${PANEL})`,
}

/**
 * A stretch: a capsule in its branch's place and colour, `span` rows long
 * (one, and one more per digit of its size), filled by who wrote it
 * (`stretchFill`). A click opens the message at that point of the stretch
 * (`pickAt`), its ask's fold included; the column is where a stretch is read.
 */
function Capsule(p: {
  stretch: RailStretch
  label: string
  open: boolean
  /** Its matches while searching (`RailMarks.matches`), else null. */
  matches: number | null
  onPick: (id: EntryId) => void
}) {
  const { stretch } = p
  const label =
    p.matches === null || p.matches === 0
      ? p.label
      : `${matchCountWords(p.matches)} · ${p.label}`
  const color = useTrackColors().color(stretch.track)
  const fill = stretchFill(stretch.stats)
  return (
    <button
      aria-label={label}
      className="rail-stretch"
      data-ask={stretch.ask ?? undefined}
      data-count={stretch.ids.length}
      data-entry={stretch.ids[0]}
      data-fill={fill}
      data-match={p.matches ?? undefined}
      data-open={p.open ? "yes" : "no"}
      data-span={stretch.span}
      data-track={stretch.track}
      onClick={e => {
        const box = e.currentTarget.getBoundingClientRect()
        // A click from the keyboard has no point: `detail` is 0.
        const at = e.detail === 0 ? null : (e.clientY - box.top) / box.height
        p.onPick(pickAt(stretch.ids, at))
      }}
      style={{
        left: x(stretch.across) - DOT,
        top: y(stretch.slot) - ROW / 2 + 2,
        height: stretch.span * ROW - 4,
        borderColor: color,
        background: FILL[fill](color),
      }}
      title={label}
      type="button"
    />
  )
}
