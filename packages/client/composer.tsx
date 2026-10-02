// client/composer — one per column, at its foot: your drafting card's editor
// (ADR-0048), and who else is typing here.

import type {
  CardPlace,
  CardRecord,
  CommandSummary,
  Position,
  SeatRecord,
  ThreadLane,
} from "@pineta/core"
import type { ReadOnly } from "./app-view.ts"
import { CardEditor, type Where } from "./card-editor.tsx"
import type { Pending, Prefill } from "./columns.ts"
import type { Intent } from "./intent.ts"
import { nameFor } from "./presence.tsx"
import type { Reader } from "./send.ts"
import type { ColumnHow, SessionClient } from "./session-view.ts"
import { useTypingAt } from "./use-presence.ts"

/**
 * The column's foot. What you type here is your drafting card at this
 * thread's end, or this fresh column's: created with the first keystroke worth
 * keeping, and kept across tab switches, reloads and restarts (ADR-0048).
 * Sending it spends it; a conflict or a refusal leaves it.
 */
export function Composer(p: {
  session: SessionClient
  /** Your card here, once it exists. */
  card: CardRecord | undefined
  /** Where a card made here goes; undefined where none may be made. */
  place: CardPlace | undefined
  at: Position
  lane: ThreadLane
  how: ColumnHow
  fresh: boolean
  commands: readonly CommandSummary[]
  participants: readonly string[]
  reader: Reader
  seats: readonly SeatRecord[]
  prefill: Prefill | undefined
  pending: Pending | undefined
  insert: { readonly text: string; readonly key: number } | null
  where: Where
  /** The thread end whose typists it names; null names none. */
  typingAt: string | null
  onTyping: () => void
  onSend: () => string | undefined
  onBranchInstead: (pending: Pending) => void
  onCreatesLane: (createsLane: boolean) => void
  /** Where a read-only action goes (`ReadOnly.action.intent`). */
  onIntent: (intent: Intent) => void
  readOnly: ReadOnly | null
  takeFocus: () => boolean
}) {
  return (
    <form
      className="composer"
      onSubmit={event => {
        // The editor sends on Enter and on its button; a form submit is not one.
        event.preventDefault()
      }}
    >
      {p.typingAt !== null && (
        <TypingLine end={p.typingAt} reader={p.reader} session={p.session} />
      )}
      <CardEditor
        at={p.at}
        how={p.how}
        card={p.card}
        commands={p.commands}
        fresh={p.fresh}
        insert={p.insert}
        lane={p.lane}
        onBranchInstead={p.onBranchInstead}
        onCreatesLane={p.onCreatesLane}
        onIntent={p.onIntent}
        onSend={p.onSend}
        onTyping={p.onTyping}
        participants={p.participants}
        pending={p.pending}
        place={p.readOnly === null ? p.place : undefined}
        prefill={p.prefill}
        readOnly={p.readOnly}
        reader={p.reader}
        seats={p.seats}
        session={p.session}
        takeFocus={p.takeFocus}
        where={p.where}
      />
    </form>
  )
}

/**
 * Others typing at `end`. It reads presence itself, so their typing redraws
 * this line and not the column.
 */
function TypingLine(p: {
  session: SessionClient
  end: string
  reader: Reader
}) {
  const typing = useTypingAt(p.session.presence, p.reader.me, p.end)
  if (typing.length === 0) return null
  const names = typing.map(w => nameFor(p.reader.nameOf, w))
  return (
    <div className="typing">
      {names.join(", ")} {names.length === 1 ? "is" : "are"} typing…
    </div>
  )
}
