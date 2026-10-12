// web/pane-context — how what a message draws reaches its column's pane, with
// no prop through the memoised list and messages: a context change redraws only
// the components that read it.

import type { EntryId, ThreadId } from "@pinetrie/core"
import { createContext } from "react"
import type { PaneSubject } from "./pane.ts"

/**
 * The column's pane: what it shows, and `open`, which toggles a subject
 * (`togglePane`). `Column` provides it, memoised on `shown`, with a stable
 * `open`. Null outside a column: nothing there opens a pane.
 */
export interface PaneReach {
  readonly shown: PaneSubject | null
  readonly open: (subject: PaneSubject) => void
}

export const PaneReach = createContext<PaneReach | null>(null)

/**
 * The message being drawn: an entry, or a reply still streaming, which has
 * none yet. `MessageView` and `Reply` provide it. Null elsewhere (an ask's
 * digest), where a table has no bar and an image names no message.
 */
export type MessageSource =
  | {
      readonly kind: "entry"
      readonly thread: ThreadId
      readonly entry: EntryId
    }
  | { readonly kind: "streaming" }

export const MessageSource = createContext<MessageSource | null>(null)

/** A streaming reply's source: one value, so its readers keep it. */
export const STREAMING: MessageSource = { kind: "streaming" }
