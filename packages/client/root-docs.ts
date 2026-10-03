// client/root-docs — the roots' documents this client holds (ADR-0063, S86).
// Runs in a browser and in Node alike: it touches only the Exchange.
//
// Kyneta takes in every announced document whose schema a client knows, and
// every root's is the session's, so a `canShare` policy declines each root
// this client does not hold. `planHold` (`held-roots.ts`) decides what to
// open and let go of; this module carries it out.

import type { Exchange } from "@kyneta/exchange"
import {
  type EntryId,
  ERR,
  type Position,
  type RootId,
  rootDocId,
  rootOfDocId,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import { asRootDoc, type RootDocHandle, StorageDoc } from "@pineta/schema"
import { planHold } from "./held-roots.ts"
import { newRootId } from "./ids.ts"
import { type Readable, readable, snapshotStore } from "./store.ts"

/** A write at an entry in no root this tab holds: refused before it is sent. */
export const NO_ROOT: Outcome = {
  kind: "refused",
  code: ERR.UNKNOWN_TARGET,
  message: "that message is in no root this tab holds",
}

export interface RootDocs {
  /** The documents held, by root. */
  readonly roots: Readable<ReadonlyMap<RootId, RootDocHandle>>
  /** Hold exactly `asked`, and a root this client just started. */
  hold(asked: ReadonlySet<RootId>): void
  /** The held root that has `entry`, or undefined. */
  rootOf(entry: EntryId): RootId | undefined
  /**
   * The root a write at `at` goes to: its entry's, or, at the root, one this
   * client starts and holds until the page asks for it too: `minting`, the
   * root a new tab minted as it opened (ADR-0066), or, for a send at the
   * root that names none (a script's), one minted here.
   */
  rootFor(at: Position, minting?: RootId): RootId | undefined
}

export function rootDocs(exchange: Exchange): RootDocs {
  let asked: ReadonlySet<RootId> = new Set()
  let minted: ReadonlySet<RootId> = new Set()
  const roots = snapshotStore<ReadonlyMap<RootId, RootDocHandle>>(new Map())
  // What is about to be held. Kyneta asks `canShare` as `get` opens a
  // document, to announce it and ask the host for it, and not again: a root
  // not yet wanted then is never asked for.
  let wanted: ReadonlySet<RootId> = new Set()
  exchange.register({
    name: "pineta.roots",
    canShare: (docId: string) => {
      const root = rootOfDocId(docId)
      return root === undefined ? undefined : wanted.has(root)
    },
  })
  const hold = () => {
    const now = roots.current()
    const plan = planHold({ asked, minted, held: new Set(now.keys()) })
    minted = plan.minted
    if (plan.open.length === 0 && plan.drop.length === 0) return
    wanted = plan.want
    const next = new Map([...now].filter(([root]) => plan.want.has(root)))
    for (const root of plan.open)
      next.set(root, asRootDoc(exchange.get(rootDocId(root), StorageDoc)))
    roots.set(next)
    // `destroy` lets go of this client's copy; the host keeps its own.
    for (const root of plan.drop) void exchange.destroy(rootDocId(root))
  }
  const rootOf = (entry: EntryId): RootId | undefined => {
    for (const [root, doc] of roots.current())
      if (doc.entries.get(entry) !== undefined) return root
    return undefined
  }
  return {
    roots: readable(roots),
    hold(next) {
      asked = next
      hold()
    },
    rootOf,
    rootFor(at, minting) {
      if (at.kind === "entry") return rootOf(at.id)
      const root = minting ?? newRootId()
      minted = new Set([...minted, root])
      hold()
      return root
    },
  }
}
