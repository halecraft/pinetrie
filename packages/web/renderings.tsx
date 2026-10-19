// web/renderings — how cards are drawn at each level of detail
// (*Renderings*): compact (a slot) by one component for every kind
// (`CompactCard`), and normal (the card itself, bounded: the bench) and full
// (opened on the bench) by one row per kind, declared with `satisfies`, so a
// kind added later does not compile until it draws both. A card on a canvas is
// drawn full by its column (`Strip`'s switch, total by kind too); a folded one
// as its strip (`FoldedColumn`). What each draws is the interface's values
// (`cardCompact`, `cardFrame`, `threadPreview`); what a row needs beyond its
// card comes from the surface drawing it (`RenderingContext`).

import {
  blobUrl,
  type CardRecord,
  type CardWidth,
  type NoteColumnId,
  type Sha256,
  type ThreadId,
  type ThreadName,
  type WriterId,
} from "@pinetrie/core"
import {
  addressWords,
  CLOSE_CARD,
  type Compact,
  cardFrame,
  compactWords,
  type Detail,
  type DrawnKind,
  EDIT_AS_TEXT,
  type Intent,
  KIND_ICON,
  type NoteColumnView,
  PUT,
  PUT_TITLE,
  type Reader,
  type ThreadPreview,
} from "@pinetrie/interface"
import { askLine, factLine } from "@pinetrie/rules"
import { AT_INVENTORY, newCardId, type SessionClient } from "@pinetrie/session"
import { createContext, type ReactNode, useContext } from "react"
import { BoundCardEditor } from "./card-editor.tsx"
import { InventoryIcon } from "./icons.tsx"
import { MessageText } from "./message-text.tsx"
import { Initial } from "./presence.tsx"
import { ThreadIconImage } from "./thread-icon-image.tsx"
import { ThreadPreviewView } from "./thread-preview.tsx"
import { useCardTexts } from "./use-card-texts.ts"
import { useFetched } from "./use-fetched.ts"

/** What a surface gives the cards it draws, beyond each card. */
interface RenderingContext {
  readonly session: SessionClient
  readonly reader: Reader
  readonly colorOf: (writer: WriterId) => string
  /** A thread's path, read only. */
  readonly previewOf: (thread: ThreadId) => ThreadPreview
  /** Each note column, as its column draws it. */
  readonly notes: ReadonlyMap<NoteColumnId, NoteColumnView>
  /** Each thread's name, which a reference to it names. */
  readonly threadNames: ReadonlyMap<ThreadId, ThreadName>
  /** The column a put lands in: the one last focused; null for none. */
  readonly column: string | null
  readonly onIntent: (intent: Intent) => void
  /** Folds the card open on the bench back to read only; null where none is open. */
  readonly onClose: (() => void) | null
}

const Rendering = createContext<RenderingContext | null>(null)

/** Gives the cards drawn inside it what `context` holds. */
export function RenderingProvider(p: {
  context: RenderingContext
  children: ReactNode
}) {
  return <Rendering.Provider value={p.context}>{p.children}</Rendering.Provider>
}

const useRendering = (): RenderingContext => {
  const context = useContext(Rendering)
  if (context === null)
    throw new Error("a card is drawn outside a RenderingProvider")
  return context
}

type CardOf<K extends DrawnKind> = Extract<CardRecord, { readonly kind: K }>

/** How a kind is drawn normal and full. */
export interface Renderings<K extends DrawnKind> {
  readonly icon: string
  readonly Normal: (p: { card: CardOf<K>; width: CardWidth }) => ReactNode
  readonly Full: (p: { card: CardOf<K>; width: CardWidth }) => ReactNode
}

/**
 * The bench's put: its card onto the column last focused, a thread's after
 * that column on the canvas you are on. Disabled with no card, or no column.
 */
export function PutButton(p: { card: CardRecord | null }) {
  const { column, onIntent } = useRendering()
  const { card } = p
  return (
    <button
      className="put primary"
      disabled={column === null || card === null}
      onClick={() => {
        if (column !== null && card !== null)
          onIntent({
            kind: "put",
            source: { kind: "card", card: card.id },
            target: { kind: "column", key: column },
            how: "move",
          })
      }}
      title={card?.kind === "thread" ? PUT_THREAD_TITLE : PUT_TITLE}
      type="button"
    >
      <InventoryIcon way="put" /> {PUT}
    </button>
  )
}

/** A thread's put: onto the canvas you are on, after the column you were in. */
const PUT_THREAD_TITLE =
  "put this thread on the canvas you are on, after the column you were in"

/**
 * A card at its least detail, every kind alike: its kind's icon, its mark (a
 * writer's circle, not an `Avatar`, since the browser suite counts people by
 * `.avatar`; or a thread's icon), its command's chip and its badge, then its
 * lead and second line as one flow, cut at two lines by its stylesheet.
 */
export function CompactCard({ compact }: { compact: Compact }) {
  const { reader, colorOf } = useRendering()
  const words = compactWords(compact, reader)
  const { mark } = compact
  return (
    <span
      className="compact"
      data-card={compact.card}
      data-kind={compact.kind}
      data-tone={compact.tone}
    >
      <span className="compact-head">
        <span aria-hidden className="card-icon">
          {KIND_ICON[compact.kind]}
        </span>
        {mark.kind === "writer" && (
          <Initial
            className="compact-mark"
            colorOf={colorOf}
            nameOf={reader.nameOf}
            writer={mark.writer}
          />
        )}
        {mark.kind === "thread" && mark.icon !== null && (
          <ThreadIconImage className="compact-mark" icon={mark.icon} />
        )}
        {words.command !== null && (
          <span className="card-chip">{words.command}</span>
        )}
        {words.badge !== null && (
          <span
            className="compact-badge"
            data-status={compact.badge?.kind === "status" || undefined}
          >
            {words.badge}
          </span>
        )}
      </span>
      <CompactFlow compact={compact} owner={words.owner} />
    </span>
  )
}

/** A compact's lead and second line, one flow; a reference's quote once read. */
function CompactFlow(p: { compact: Compact; owner: string | null }) {
  const { lead, second } = p.compact
  const quote = useQuote(lead.kind === "quote" ? lead.quote : null)
  const text = lead.kind === "text" ? lead.text : (quote?.trim() ?? lead.until)
  return (
    <span
      className="compact-text"
      title={p.owner === null ? text : `${p.owner}: ${text}`}
    >
      {text}
      {second !== null && <span className="compact-second"> {second}</span>}
    </span>
  )
}

/** A card drawn normal: bounded at a column's height, scrolling, read only. */
function NormalFrame(p: {
  kind: DrawnKind
  card: CardRecord
  width: CardWidth
  children: ReactNode
  /** Given, the card is open on the bench, and its header ends in ×, which closes it. */
  onClose?: (() => void) | null
}) {
  return (
    <section
      aria-label="the card, read only"
      className="card-normal"
      data-card={p.card.id}
      data-kind={p.kind}
      data-width={p.width}
    >
      <header className="card-normal-head">
        <span aria-hidden className="card-icon">
          {KIND_ICON[p.kind]}
        </span>
        {p.onClose != null && (
          <button
            aria-label={CLOSE_CARD.title}
            className="close-card"
            onClick={p.onClose}
            title={CLOSE_CARD.title}
            type="button"
          >
            {CLOSE_CARD.label}
          </button>
        )}
      </header>
      <div className="card-normal-body">{p.children}</div>
    </section>
  )
}

function TextNormal(p: { card: CardOf<"text">; width: CardWidth }) {
  const { session } = useRendering()
  const text = useCardTexts(session, [p.card.id]).get(p.card.id) ?? ""
  return (
    <NormalFrame card={p.card} kind="text" width={p.width}>
      <MessageText mode="committed" text={text} />
    </NormalFrame>
  )
}

/** A text card opened on the bench: its editor in its frame, whose × closes it; its put and its trash are the bench's. */
function TextFull(p: { card: CardOf<"text">; width: CardWidth }) {
  const { session, reader, onIntent, onClose } = useRendering()
  return (
    <BoundCardEditor
      among={null}
      card={p.card}
      catchUps={null}
      foot={null}
      key={p.card.id}
      onClose={onClose ?? undefined}
      onDiscard={() =>
        onIntent({ kind: "discard", card: p.card.id, at: AT_INVENTORY })
      }
      onTyping={() => {}}
      readOnly={false}
      reader={reader}
      rows={4}
      session={session}
      view={cardFrame(p.card, "inventory", { me: reader.me, readOnly: false })}
    />
  )
}

/** A thread's card, normal: its first and last messages. */
function ThreadNormal(p: { card: CardOf<"thread">; width: CardWidth }) {
  const { previewOf } = useRendering()
  const { rows } = previewOf(p.card.id)
  const first = rows[0]
  const last = rows.length > 1 ? rows[rows.length - 1] : undefined
  return (
    <NormalFrame card={p.card} kind="thread" width={p.width}>
      {[first, last].map(
        row =>
          row !== undefined && (
            <div className="card-normal-message" key={row.id}>
              <span className="thread-preview-who">{row.who}</span>
              <MessageText mode="committed" text={row.text} />
            </div>
          ),
      )}
    </NormalFrame>
  )
}

/** A thread's card opened: its path, read only; its put is the bench's. */
function ThreadFull(p: { card: CardOf<"thread">; width: CardWidth }) {
  const { previewOf } = useRendering()
  return <ThreadPreviewView preview={previewOf(p.card.id)} />
}

/** A note column's notes, the first `limit` of them (all for null), read only. */
function NoteList(p: {
  card: CardOf<"note-column">
  width: CardWidth
  limit: number | null
}) {
  const { session, notes } = useRendering()
  const view = notes.get(p.card.id)
  const shown = (view?.notes ?? []).slice(0, p.limit ?? undefined)
  const texts = useCardTexts(
    session,
    shown.map(n => n.id),
  )
  return (
    <NormalFrame card={p.card} kind="note-column" width={p.width}>
      <div className="card-normal-title">{view?.title ?? ""}</div>
      {shown.map(n => (
        <div className="card-normal-message" key={n.id}>
          <MessageText mode="committed" text={texts.get(n.id) ?? ""} />
        </div>
      ))}
    </NormalFrame>
  )
}

/**
 * Each quote this page has fetched, by its blob: a copy of a reference writes
 * its quote as text, and a copy cannot wait for a fetch. A quote never changes,
 * so nothing here goes stale.
 */
const fetchedQuotes = new Map<Sha256, string>()

/** A reference's quote if this page has fetched it (`useQuote`); null otherwise. */
export const fetchedQuote = (quote: Sha256): string | null =>
  fetchedQuotes.get(quote) ?? null

/** A reference's quote, fetched from its blob: it never changes. Null asks for none. */
function useQuote(quote: Sha256 | null): string | null {
  const [loaded] = useFetched(quote === null ? [] : [blobUrl(quote)], r =>
    r.text(),
  )
  if (quote === null || loaded?.kind !== "ready") return null
  fetchedQuotes.set(quote, loaded.value)
  return loaded.value
}

/** A reference, normal: its quote, read only. */
function ReferenceNormal(p: { card: CardOf<"reference">; width: CardWidth }) {
  const quote = useQuote(p.card.content.quote)
  return (
    <NormalFrame card={p.card} kind="reference" width={p.width}>
      <div className="card-normal-title">
        {addressWords(p.card.content.address)}
      </div>
      <blockquote className="reference-quote">
        <MessageText mode="committed" text={quote ?? ""} />
      </blockquote>
    </NormalFrame>
  )
}

/**
 * A reference opened: its quote with the thread it is from, read only, and
 * *Edit as text*, which makes it a text card you can change.
 */
function ReferenceFull(p: { card: CardOf<"reference">; width: CardWidth }) {
  const { onIntent, threadNames, onClose } = useRendering()
  const quote = useQuote(p.card.content.quote)
  const { address } = p.card.content
  const from =
    address.kind === "card" ? null : (threadNames.get(address.thread) ?? null)
  return (
    <NormalFrame
      card={p.card}
      kind="reference"
      onClose={onClose}
      width={p.width}
    >
      <div className="card-normal-title">
        {addressWords(address)}
        {from !== null && <span className="reference-from"> · {from}</span>}
      </div>
      <blockquote className="reference-quote">
        <MessageText mode="committed" text={quote ?? ""} />
      </blockquote>
      <button
        className="edit-as-text"
        disabled={quote === null}
        onClick={() => {
          if (quote !== null)
            onIntent({
              kind: "editAsText",
              reference: p.card.id,
              card: newCardId(),
              text: quote,
            })
        }}
        title={EDIT_AS_TEXT.title}
        type="button"
      >
        {EDIT_AS_TEXT.label}
      </button>
    </NormalFrame>
  )
}

/** How many notes a note column shows, normal. */
const NOTES_SHOWN = 3

/**
 * A fact, normal and full alike: its one line, the host's, waiting for its
 * thread's end. Nobody edits or moves it.
 */
function FactLine(p: { card: CardOf<"fact">; width: CardWidth }) {
  return (
    <div className="queued-fact" data-card={p.card.id}>
      {factLine(p.card.content.fact)}
    </div>
  )
}

/**
 * An ask from another thread, normal and full alike: its one line, the host's,
 * waiting for its thread's end. Nobody edits or moves it.
 */
function AskLine(p: { card: CardOf<"ask">; width: CardWidth }) {
  return (
    <div className="queued-fact queued-ask" data-card={p.card.id}>
      {askLine(p.card.content.relay)}
    </div>
  )
}

/** Every kind, drawn normal and full; compact is `CompactCard`, the same for all. */
export const RENDERINGS = {
  text: {
    icon: KIND_ICON.text,
    Normal: TextNormal,
    Full: TextFull,
  },
  thread: {
    icon: KIND_ICON.thread,
    Normal: ThreadNormal,
    Full: ThreadFull,
  },
  "note-column": {
    icon: KIND_ICON["note-column"],
    Normal: p => <NoteList {...p} limit={NOTES_SHOWN} />,
    Full: p => <NoteList {...p} limit={null} />,
  },
  fact: {
    icon: KIND_ICON.fact,
    Normal: FactLine,
    Full: FactLine,
  },
  reference: {
    icon: KIND_ICON.reference,
    Normal: ReferenceNormal,
    Full: ReferenceFull,
  },
  ask: {
    icon: KIND_ICON.ask,
    Normal: AskLine,
    Full: AskLine,
  },
} as const satisfies { readonly [K in DrawnKind]: Renderings<K> }

const NoteColumnRow = RENDERINGS["note-column"]

/** `card` at `detail` above compact, `width` columns wide, by its kind's row. */
export function DrawCard(p: {
  card: CardRecord
  detail: Exclude<Detail, "compact">
  width: CardWidth
}) {
  const { card, width } = p
  const full = p.detail === "full"
  switch (card.kind) {
    case "text":
      return full ? (
        <RENDERINGS.text.Full card={card} width={width} />
      ) : (
        <RENDERINGS.text.Normal card={card} width={width} />
      )
    case "thread":
      return full ? (
        <RENDERINGS.thread.Full card={card} width={width} />
      ) : (
        <RENDERINGS.thread.Normal card={card} width={width} />
      )
    case "note-column":
      return full ? (
        <NoteColumnRow.Full card={card} width={width} />
      ) : (
        <NoteColumnRow.Normal card={card} width={width} />
      )
    case "fact":
      return full ? (
        <RENDERINGS.fact.Full card={card} width={width} />
      ) : (
        <RENDERINGS.fact.Normal card={card} width={width} />
      )
    case "reference":
      return full ? (
        <RENDERINGS.reference.Full card={card} width={width} />
      ) : (
        <RENDERINGS.reference.Normal card={card} width={width} />
      )
    case "ask":
      return <RENDERINGS.ask.Normal card={card} width={width} />
  }
}
