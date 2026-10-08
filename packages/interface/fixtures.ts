// interface/fixtures — test support for the interface's unit tests and the
// page's: core's entries (`@pinetrie/core/fixtures`), and the trees and roots
// these tests share. Production code never imports it; the page's tests take
// it as `@pinetrie/interface/fixtures`.

import {
  type EntryLike,
  indexTree,
  rootIdFor,
  type TreeIndex,
  threadIdFor,
} from "@pinetrie/core"
import { entriesOf, entry, withThreads } from "@pinetrie/core/fixtures"

export {
  entriesOf,
  entry,
  fromParents,
  threadOfEntry,
  withThreads,
} from "@pinetrie/core/fixtures"

/**
 * The index of `list`, keyed by each entry's own id as the reads key them,
 * each thread's first message marked (`withThreads`).
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
        role: "chat",
        content: id,
        ...(sends[id] === undefined ? {} : { sendId: sends[id] }),
      }),
    ),
  )

/** The root a test's places and entries are in (ADR-0063). */
export const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
/** A root a new tab minted as it opened (ADR-0066), in the shape the host accepts. */
export const NEW_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
/** A thread a fresh column minted as it opened (ADR-0117), in the shape the host accepts. */
export const NEW_THREAD = threadIdFor("01a0ffd2-0000-7000-8000-0000000000aa")
