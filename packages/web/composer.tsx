// web/composer — one per column, at its foot: your message's editor, which only
// you see, and who else is writing here.

import type {
  AgentCandidate,
  CardId,
  CommandSummary,
  EntryId,
  Position,
  TextCard,
  TextPlace,
  ThreadLane,
} from "@pinetrie/core"
import {
  type CatchUps,
  type ColumnAct,
  type ColumnHow,
  dropProps,
  type Intent,
  type Pending,
  type Prefill,
  type Reader,
  type ReadOnly,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import { CardEditor, type Where } from "./card-editor.tsx"
import { nameFor } from "./presence.tsx"
import { useOthersTyping } from "./use-presence.ts"

/**
 * The column's foot. What you type here is your message at this thread's end,
 * or at it before it starts: created with the first keystroke worth keeping,
 * and kept across tab switches, reloads and restarts. Sending it spends it; a
 * conflict or a refusal leaves it; a busy thread, or a command, queues it above
 * the line. A card dropped here becomes your message (`planPut`).
 */
export function Composer(p: {
  session: SessionClient
  /** Your message here, once it exists. */
  card: TextCard | undefined
  /** Where a card made here goes; undefined where none may be made. */
  place: TextPlace | undefined
  at: Position
  lane: ThreadLane
  how: ColumnHow
  unstarted: boolean
  commands: readonly CommandSummary[]
  /** Why the host has no model (`noModelLine`); null when it has one. */
  noModel: string | null
  participants: readonly string[]
  /** Other threads' agents a mention may reach. */
  agents: readonly AgentCandidate[]
  reader: Reader
  prefill: Prefill | undefined
  pending: Pending | undefined
  where: Where
  /** The thread end whose typists it names; null names none. */
  typingAt: EntryId | null
  onTyping: (card: CardId | null) => void
  onSend: () => string | undefined
  onBranchInstead: (pending: Pending) => void
  onCreatesLane: (createsLane: boolean) => void
  /** Where a read-only action goes (`ReadOnly.action.intent`). */
  onIntent: (intent: Intent) => void
  /** The column's acts: queueing your card, clearing its command. */
  onAct: (act: ColumnAct) => void
  readOnly: ReadOnly | null
  /** What a card's command catches up with: the thread's base, or the thread it branched from. */
  catchUps: CatchUps
  /** The column's key when a card may be dropped here (`put-target.ts`). */
  putColumn: string | null
}) {
  return (
    <form
      className="composer"
      {...(p.putColumn === null
        ? {}
        : dropProps({ kind: "composer", key: p.putColumn }))}
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
        noModel={p.noModel}
        unstarted={p.unstarted}
        lane={p.lane}
        onBranchInstead={p.onBranchInstead}
        onAct={p.onAct}
        onCreatesLane={p.onCreatesLane}
        onIntent={p.onIntent}
        catchUps={p.catchUps}
        onSend={p.onSend}
        onTyping={p.onTyping}
        participants={p.participants}
        agents={p.agents}
        pending={p.pending}
        place={p.readOnly === null ? p.place : undefined}
        prefill={p.prefill}
        readOnly={p.readOnly}
        reader={p.reader}
        session={p.session}
        where={p.where}
      />
    </form>
  )
}

/**
 * Others writing at `end`: in their own message, or a note there. It reads
 * presence itself, so their typing redraws this line and not the column.
 */
function TypingLine(p: {
  session: SessionClient
  end: EntryId
  reader: Reader
}) {
  const typing = useOthersTyping(p.session.presence, p.reader.me, p.end)
  if (typing.length === 0) return null
  const names = typing.map(w => nameFor(p.reader.nameOf, w))
  return (
    <div className="typing">
      {names.join(", ")} {names.length === 1 ? "is" : "are"} writing…
    </div>
  )
}
