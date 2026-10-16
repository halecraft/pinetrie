// interface/fixtures — test support for the interface's unit tests and the
// page's: core's entries (`@pinetrie/core/fixtures`), and the trees and roots
// these tests share. Production code never imports it; the page's tests take
// it as `@pinetrie/interface/fixtures`.

import {
  type CanvasId,
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  type EntryId,
  type EntryLike,
  indexTree,
  NO_CONTENT,
  rootIdFor,
  rootOf,
  type ThreadCard,
  type ThreadId,
  type ThreadRecord,
  type TreeIndex,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  canvasCard,
  entriesOf,
  entry,
  withThreads,
} from "@pinetrie/core/fixtures"
import type { ClipLookups } from "./effects.ts"
import type { Focus } from "./focus.ts"

export {
  entriesOf,
  entry,
  fromParents,
  threadOfEntry,
  withThreads,
} from "@pinetrie/core/fixtures"

import { type Canvases, canvasesOnBoard } from "./canvases.ts"

/**
 * The index of `list`, keyed by each entry's own id as the reads key them,
 * in threads as a branch writes them (`withThreads`).
 */
export const indexOf = (list: Iterable<EntryLike>): TreeIndex =>
  indexTree(withThreads(entriesOf(list)))

/**
 * A tree of chat messages from `child: parent` pairs, each message's text its
 * id; `sends` gives some entries a send id.
 */
export const tree = (
  parents: Record<string, string | null>,
  sends: Record<string, string> = {},
): TreeIndex =>
  indexOf(
    Object.entries(parents).map(([id, parentId]) =>
      entry(id, parentId, {
        role: "person",
        content: id,
        ...(sends[id] === undefined ? {} : { sendId: sends[id] }),
      }),
    ),
  )

/** The root a test's places and entries are in. */
export const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
/** A root a new canvas minted as it opened, in the shape the host accepts. */
export const NEW_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
/** A thread a column minted as it opened, in the shape the host accepts. */
export const NEW_THREAD = threadIdFor("01a0ffd2-0000-7000-8000-0000000000aa")

/** A note column minted for an intent, in `parseCardId`'s shape. */
export const NEW_NOTE_COLUMN = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000cc",
)

/** A text card a paste made, a bare uuidv7. */
export const NEW_TEXT = textCardId("01a0ffd2-0000-7000-8000-0000000000dd")

/**
 * What a copy reads beyond the cards, for a test: every text
 * card holds "copied text", no quote is fetched, nothing is in the cell.
 */
export const NO_CLIPS: ClipLookups = {
  textOf: () => "copied text",
  quoteOf: () => null,
  cell: null,
}

/** Focus nowhere: nothing selected, no card, no column, no box (`Focus`). */
export const NO_FOCUS: Focus = {
  card: null,
  inText: false,
  inPanel: false,
  selectedCard: null,
  column: null,
  page: false,
  search: "unavailable",
  selection: null,
  block: null,
  selected: null,
  cell: false,
  inColumn: null,
  zone: null,
}

/** The canvas a new canvas's first send starts, in `parseNewCanvas`'s shape. */
export const NEW_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000bb")

/** A canvas the fixtures' threads are in. */
export const TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")

/**
 * The page's canvases for a test: each canvas holding every thread of
 * `index` whose first entry is under the root entry named with it, each a
 * thread card on its canvas in thread order, its root `TEST_ROOT`.
 */
export function canvasesFor(
  index: TreeIndex,
  ...pairs: readonly (readonly [CanvasId, EntryId])[]
): Canvases {
  const cards: ThreadCard[] = []
  const threads = new Map<ThreadId, ThreadRecord>()
  for (const [thread, first] of [...index.firstOf].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const root = rootOf(index, first)
    const canvas = pairs.find(([, entry]) => entry === root)?.[0]
    if (canvas === undefined) continue
    cards.push({
      kind: "thread",
      id: thread,
      owner: TEST_WRITER,
      placer: TEST_WRITER,
      place: { kind: "canvas", canvas, order: `a${cards.length}`, width: 1 },
      content: NO_CONTENT,
    })
    threads.set(thread, {
      thread,
      root: TEST_ROOT,
      by: TEST_WRITER,
      createdAt: 0,
      origin: { kind: "root" },
    })
  }
  return canvasesOnBoard({
    cards: [
      ...pairs.map(([canvas], i) => canvasCard(canvas, `a${i}`)),
      ...cards,
    ],
    threads,
  })
}

/**
 * The page's canvases for a test, each of `known` a canvas whose card is on
 * the board, beside `cards`.
 */
export const canvasesWith = (input: {
  readonly known: readonly CanvasId[]
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
}): Canvases =>
  canvasesOnBoard({
    cards: [...input.known.map(canvas => canvasCard(canvas)), ...input.cards],
    threads: input.threads,
  })

const TEST_WRITER = writerId("ada@x.io")
