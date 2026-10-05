// pi/scribe — the host's writes into the documents, through pi (ADR-0092):
// its records (ADR-0062) and a conversation thread's messages (S21). The
// scribe writes what the host decided, and decides nothing.
//
// It holds one pi session per document, and nothing else may open one: two
// sessions over one document drift apart, since each indexes only its own
// commits (S113). So the agent builds each root's harness through the
// scribe, over that session (`scribeInside.over`), and the scribe ends both:
// at `release` of the root, or at `close`.

import {
  BACKGROUND_CONTEXT,
  deleteValue,
  StorageBackedSession,
  setValue,
  value,
} from "@earendil-works/pi-agent-core"
import { insertEntry } from "@earendil-works/pi-agent-core/harness/session"
import {
  type BlobStore,
  entryId,
  type RootId,
  type Spot,
  type Target,
  type ValueWrite,
} from "@pinetrie/core"
import type { ChatMessage } from "@pinetrie/rules"
import type { StorageDocHandle } from "@pinetrie/schema"
import type { AgentDocuments, Stack } from "./agent.ts"
import { sealed } from "./inside.ts"
import { KynetaStorage } from "./storage.ts"
import { type AppendOutcome, toPi } from "./thread-lanes.ts"

const CTX = BACKGROUND_CONTEXT

/** Every member is a closure: it may be passed on its own. */
export interface Scribe {
  /**
   * Write the host's records (ADR-0062): each document's writes in one
   * commit, by their target (ADR-0063). A value can be written while a lane
   * runs: it does not go through the lane (S70). Throws, writing nothing, for
   * a namespace that is not the host's.
   */
  writeValues(writes: readonly ValueWrite[]): Promise<void>
  /**
   * Append at exactly `spot`, with no lane: a conversation thread (S21 Q1).
   * The host's serial executor guarantees nothing was written there since it
   * planned, so no re-read is needed here.
   */
  appendToTree(message: ChatMessage, spot: Spot): Promise<AppendOutcome>
  /**
   * Before the host lets `root`'s document go (ADR-0063): what was built over
   * its session closes, then the session. The next call that needs the root
   * opens it again.
   */
  release(root: RootId): Promise<void>
  /** Every session, after what was built over it. Every later write is refused. */
  close(): Promise<void>
}

/** Sealed into the scribe; `createAgent` is its one reader. */
export interface ScribeInside {
  /**
   * The stack built over `root`'s one session: made once, by the first
   * caller's `build`, and closed with the session. Two callers asking at
   * once share one.
   */
  over(
    root: RootId,
    build: (session: StorageBackedSession) => Promise<Stack>,
  ): Promise<Stack>
  /** Close and forget every stack built, leaving the sessions: the agent's `close`. */
  closeBuilt(): Promise<void>
}

export const scribeInside = sealed<Scribe, ScribeInside>("createScribe")

/** What `writeValues` does with `writes`, decided before anything is written. */
export type WritePlan =
  | { readonly kind: "refused"; readonly namespace: string }
  | {
      readonly kind: "groups"
      readonly groups: readonly (readonly [Target, readonly ValueWrite[]])[]
    }

/**
 * Writes grouped by the document they go to, in the order each target first
 * appears. Pure.
 */
function byTarget(
  writes: readonly ValueWrite[],
): readonly (readonly [Target, readonly ValueWrite[]])[] {
  const groups = new Map<string, [Target, ValueWrite[]]>()
  for (const w of writes) {
    const key = keyOf(w.target)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [w.target, [w]])
    else group[1].push(w)
  }
  return [...groups.values()]
}

/**
 * Refused, naming the first namespace that is not the host's; else the
 * writes by document. A type rule cannot do this: type stripping does not
 * check `HostNamespace` (ADR-0062). Pure.
 */
export function planWrites(writes: readonly ValueWrite[]): WritePlan {
  const foreign = writes.find(w => !w.namespace.startsWith("pinetrie."))
  return foreign === undefined
    ? { kind: "groups", groups: byTarget(writes) }
    : { kind: "refused", namespace: foreign.namespace }
}

/** A host write as pi's: set or delete the value at its address. */
const toPiWrite = (w: ValueWrite) =>
  w.kind === "set"
    ? setValue(value(w.namespace, w.key), w.value as never)
    : deleteValue(value(w.namespace, w.key))

const keyOf = (target: Target): string =>
  target.kind === "session" ? "" : target.root

/** A document's one session, and the stack built over it, if any. */
interface Held {
  readonly session: Promise<StorageBackedSession>
  built: Promise<Stack> | undefined
}

export function createScribe(options: {
  readonly documents: Pick<AgentDocuments, "session" | "root">
  /**
   * This PROCESS's replica id, used by storage for write tokens. It is not a
   * writer's identity: writers are people, identified by the transport.
   */
  readonly replicaId: string
  /**
   * Where images are kept: a message's image the store holds is stored as a
   * reference to it (ADR-0051). Without it, every image is stored inline.
   */
  readonly blobs?: Pick<BlobStore, "get" | "ref">
}): Scribe {
  const { documents, replicaId } = options
  const held = new Map<string, Held>()
  let closed = false

  function sessionOver(doc: StorageDocHandle, key: string) {
    return new StorageBackedSession(
      {
        id: `pinetrie-${replicaId}-${key === "" ? "session" : key}`,
        createdAt: Date.now(),
        storageVersion: 1,
      },
      new KynetaStorage({
        doc,
        peerId: replicaId,
        ...(options.blobs === undefined ? {} : { blobs: options.blobs }),
      }),
      {},
    )
  }

  /** The target's entry, made on first use: the promise is held, so two callers share one session. */
  function heldOf(target: Target): Held {
    if (closed) throw new Error("the scribe is closed")
    const key = keyOf(target)
    const known = held.get(key)
    if (known !== undefined) return known
    const doc: Promise<StorageDocHandle> =
      target.kind === "session"
        ? Promise.resolve(documents.session)
        : documents.root(target.root)
    const made: Held = {
      session: doc.then(d => sessionOver(d, key)),
      built: undefined,
    }
    held.set(key, made)
    return made
  }

  async function closeBuiltOf(entry: Held): Promise<void> {
    const built = entry.built
    entry.built = undefined
    if (built !== undefined) await (await built).close()
  }

  async function closeBuilt(): Promise<void> {
    for (const entry of held.values()) await closeBuiltOf(entry)
  }

  const scribe: Scribe = {
    async writeValues(writes) {
      if (writes.length === 0) return
      const plan = planWrites(writes)
      if (plan.kind === "refused")
        throw new Error(
          `writeValues: ${plan.namespace} is not the host's to write`,
        )
      for (const [target, group] of plan.groups) {
        const session = await heldOf(target).session
        await session.mutate(m => m.commit(group.map(toPiWrite), CTX), CTX)
      }
    },

    async appendToTree(message, spot) {
      const session = await heldOf({ kind: "root", root: spot.root }).session
      const id = session.idGenerator.next()
      await session.mutate(
        m =>
          m.commit(
            [
              insertEntry({
                id,
                parentId: toPi(spot.at),
                type: "message",
                message,
              }),
            ],
            CTX,
          ),
        CTX,
      )
      return { kind: "appended", id: entryId(id) }
    },

    async release(root) {
      const entry = held.get(root)
      if (entry === undefined) return
      held.delete(root)
      await closeBuiltOf(entry)
      // A harness closed the session already; a root never run has none.
      await (await entry.session).close(CTX)
    },

    async close() {
      closed = true
      await closeBuilt()
      for (const entry of held.values()) await (await entry.session).close(CTX)
    },
  }

  return scribeInside.seal(scribe, {
    over(root, build) {
      const entry = heldOf({ kind: "root", root })
      if (entry.built === undefined) entry.built = entry.session.then(build)
      return entry.built
    },
    closeBuilt,
  })
}
