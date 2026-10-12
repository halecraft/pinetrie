// pi/scribe — the host's writes into a root's tree, through pi: a
// conversation thread's messages. The scribe writes what the host decided,
// and decides nothing.
//
// It holds one pi session per document, and nothing else may open one: two
// sessions over one document drift apart, since each indexes only its own
// commits. So the agent builds each root's harness through the
// scribe, over that session (`scribeInside.over`), and the scribe ends both:
// at `release` of the root, or at `close`.

import {
  BACKGROUND_CONTEXT,
  StorageBackedSession,
} from "@earendil-works/pi-agent-core"
import { insertEntry } from "@earendil-works/pi-agent-core/harness/session"
import {
  type BlobStore,
  entryId,
  type RootId,
  type Spot,
  type ThreadId,
} from "@pinetrie/core"
import type { AnswerMessage, ChatMessage, FactMessage } from "@pinetrie/rules"
import type { RootDocHandle } from "@pinetrie/schema"
import type { AgentDocuments, Stack } from "./agent.ts"
import { sealed } from "./inside.ts"
import { KynetaStorage } from "./storage.ts"
import { threadContext } from "./thread-context.ts"
import { type AppendOutcome, toPi } from "./thread-lanes.ts"

const CTX = BACKGROUND_CONTEXT

/** Every member is a closure: it may be passed on its own. */
export interface Scribe {
  /**
   * Append at exactly `spot`, with no lane: a conversation thread, the entry
   * in `thread`. The host's serial executor guarantees
   * nothing was written there since it planned, so no re-read is needed here.
   */
  appendToTree(
    message: ChatMessage | AnswerMessage | FactMessage,
    spot: Spot,
    thread: ThreadId,
  ): Promise<AppendOutcome>
  /**
   * Before the host lets `root`'s document go: what was built over
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

/** A document's one session, and the stack built over it, if any. */
interface Held {
  readonly session: Promise<StorageBackedSession>
  built: Promise<Stack> | undefined
}

export function createScribe(options: {
  readonly documents: Pick<AgentDocuments, "root">
  /**
   * This PROCESS's replica id, used by storage for write tokens. It is not a
   * writer's identity: writers are people, identified by the transport.
   */
  readonly replicaId: string
  /**
   * Where images are kept: a message's image the store holds is stored as a
   * reference to it. Without it, every image is stored inline.
   */
  readonly blobs?: Pick<BlobStore, "get" | "ref">
}): Scribe {
  const { documents, replicaId } = options
  const held = new Map<string, Held>()
  let closed = false

  function sessionOver(doc: RootDocHandle, root: RootId) {
    return new StorageBackedSession(
      {
        id: `pinetrie-${replicaId}-${root}`,
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

  /** The root's entry, made on first use: the promise is held, so two callers share one session. */
  function heldOf(root: RootId): Held {
    if (closed) throw new Error("the scribe is closed")
    const known = held.get(root)
    if (known !== undefined) return known
    const made: Held = {
      session: documents.root(root).then(d => sessionOver(d, root)),
      built: undefined,
    }
    held.set(root, made)
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
    async appendToTree(message, spot, thread) {
      const session = await heldOf(spot.root).session
      const id = session.idGenerator.next()
      const ctx = threadContext(thread, CTX)
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
            ctx,
          ),
        ctx,
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
      const entry = heldOf(root)
      if (entry.built === undefined) entry.built = entry.session.then(build)
      return entry.built
    },
    closeBuilt,
  })
}
