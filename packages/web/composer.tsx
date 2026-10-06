// web/composer — one per column, at its foot: your drafting card's editor
// (ADR-0048), and who else is typing here.

import type {
  CardId,
  CardPlace,
  CardRecord,
  CommandSummary,
  EntryId,
  Position,
  SeatRecord,
  ThreadLane,
} from "@pinetrie/core"
import {
  type CatchUps,
  type ColumnAct,
  type ColumnHow,
  dropProps,
  type EditorState,
  type Intent,
  type Pending,
  type Prefill,
  type Reader,
  type ReadOnly,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import { CardEditor, type Where } from "./card-editor.tsx"
import { nameFor } from "./presence.tsx"
import { useTypingAt } from "./use-presence.ts"

/**
 * The column's foot. What you type here is your drafting card at this
 * thread's end, or this fresh column's: created with the first keystroke worth
 * keeping, and kept across tab switches, reloads and restarts (ADR-0048).
 * Sending it spends it; a conflict or a refusal leaves it; a busy thread, or
 * a command, queues it above the line.
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
  where: Where
  /** The thread end whose typists it names; null names none. */
  typingAt: EntryId | null
  onTyping: (card: CardId | null) => void
  onSend: () => string | undefined
  onBranchInstead: (pending: Pending) => void
  onCreatesLane: (createsLane: boolean) => void
  /** Told the box's state, so the column knows which card it shows (`CardEditor`). */
  onShows: (state: EditorState) => void
  /** Where a read-only action goes (`ReadOnly.action.intent`). */
  onIntent: (intent: Intent) => void
  /** The column's acts: queueing your card, clearing its command. */
  onAct: (act: ColumnAct) => void
  readOnly: ReadOnly | null
  /** What a card's command catches up with: the thread's base, or the thread it branched from. */
  catchUps: CatchUps
  takeFocus: () => boolean
  /** The column's key when a card may be put or dropped here (`put-target.ts`). */
  putColumn: string | null
}) {
  return (
    <form
      className="composer"
      {...(p.putColumn === null
        ? {}
        : dropProps({ kind: "column", key: p.putColumn }))}
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
        lane={p.lane}
        onBranchInstead={p.onBranchInstead}
        onAct={p.onAct}
        onCreatesLane={p.onCreatesLane}
        onShows={p.onShows}
        onIntent={p.onIntent}
        catchUps={p.catchUps}
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
        onLeave={undefined}
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
  end: EntryId
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
