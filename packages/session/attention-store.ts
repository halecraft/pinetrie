// session/attention-store — what your attention document holds, read and
// marked, as the page takes it. Its shell, over Kyneta, is `attention-doc.ts`.

import type { EntryId, ThreadId } from "@pinetrie/core"
import type { Attention } from "@pinetrie/schema"
import type { Readable } from "./store.ts"

/**
 * The mentions you have seen, as the page's inbox decides them
 * (`@pinetrie/interface`'s `inbox.ts`): every one at or before `since`, and
 * `seen` above it.
 */
export interface SeenMentions {
  readonly since: string
  readonly seen: readonly string[]
}

export interface AttentionStore {
  readonly attention: Readable<Attention>
  /** A column of `lane` follows its end, at `entry`. */
  read(lane: ThreadId, entry: EntryId): void
  /** A column has left its thread's end, or the page is hidden: write every waiting mark. */
  leave(): void
  /** Mark `lane`'s run-end report, of the run `ask` started, "not needed". */
  dismiss(lane: ThreadId, ask: EntryId): void
  /** Mark `lane`'s proposed changes "not needed" while it holds `source`. */
  dismissReady(lane: ThreadId, source: string): void
  /** The mentions seen, as the inbox decided them next. */
  setInbox(next: SeenMentions): void
  dispose(): void
}
