// session/root-docs — the roots' documents this client holds, and a
// `canShare` policy that declines every other: Kyneta takes in every
// announced document whose schema a client knows, and every root's is one.

import type { Exchange } from "@kyneta/exchange"
import {
  type EntryId,
  ERR,
  type MessageAt,
  type RootId,
  rootDocId,
  rootOfDocId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { RootDoc, type RootDocHandle } from "@pinetrie/schema"
import { newRootId } from "./ids.ts"
import { planHold } from "./root-hold.ts"
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
   * root a new canvas minted as it opened, or, for a send at the
   * root that names none (a script's), one minted here.
   */
  rootFor(at: MessageAt, minting?: RootId): RootId | undefined
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
    name: "pinetrie.roots",
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
    // Destroyed while still wanted: Kyneta tells a peer this client leaves a
    // document only where `canShare` still allows it, and the host keeps a
    // root loaded while a tab holds it. Narrowed first, the host would never
    // hear the drop. `destroy` lets go of this client's copy only.
    for (const root of plan.drop) void exchange.destroy(rootDocId(root))
    wanted = plan.want
    const next = new Map([...now].filter(([root]) => plan.want.has(root)))
    for (const root of plan.open)
      next.set(root, exchange.get(rootDocId(root), RootDoc))
    roots.set(next)
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
      const entry = at.kind === "end" ? at.seen : at.at
      if (entry !== null) return rootOf(entry)
      const root = minting ?? newRootId()
      minted = new Set([...minted, root])
      hold()
      return root
    },
  }
}
