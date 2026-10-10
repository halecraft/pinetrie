// web/renderings — how each kind of card is drawn at each level of detail
// (ADR-0126, *Renderings*): its face (a grid's cell), normal (the card
// itself, bounded: the inventory's preview) and whole (opened). One row per
// kind, declared with `satisfies`, so a kind added later does not compile
// until it draws all three. A card on a canvas is drawn whole by its column
// (`Strip`'s switch, total by kind too); a folded one by its face
// (`FoldedColumn`). What each draws is the interface's values (`faceOf`,
// `cardFrame`, `threadPreview`); what a row needs beyond its card comes from
// the surface drawing it (`RenderingContext`).

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
  cardFrame,
  type Detail,
  type DrawnKind,
  EDIT_AS_TEXT,
  type Face,
  type FaceOf,
  type Intent,
  KIND_ICON,
  type NoteColumnView,
  PUT,
  PUT_TITLE,
  type Reader,
  type ThreadPreview,
  textFaceWords,
} from "@pinetrie/interface"
import { askLine, factLine } from "@pinetrie/rules"
import { newCardId, type SessionClient } from "@pinetrie/session"
import { createContext, type ReactNode, useContext } from "react"
import { BoundCardEditor } from "./card-editor.tsx"
import { MessageText } from "./message-text.tsx"
import { Initial } from "./presence.tsx"
import { ThreadFaceView, ThreadPreviewView } from "./thread-preview.tsx"
import { useCardTexts } from "./use-card-texts.ts"
import { useFetched } from "./use-fetched.ts"

/** What a surface gives the cards it draws, beyond each card. */
export interface RenderingContext {
  readonly session: SessionClient
  readonly reader: Reader
  readonly colorOf: (writer: WriterId) => string
  /** A thread's path, read only (ADR-0124). */
  readonly previewOf: (thread: ThreadId) => ThreadPreview
  /** Each note column, as its column draws it. */
  readonly notes: ReadonlyMap<NoteColumnId, NoteColumnView>
  /** Each thread's name, which a reference to it names. */
  readonly threadNames: ReadonlyMap<ThreadId, ThreadName>
  /** The column a put lands in: the one last focused; null for none. */
  readonly column: string | null
  readonly onIntent: (intent: Intent) => void
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

/** A card of `K`. */
type CardOf<K extends DrawnKind> = Extract<CardRecord, { readonly kind: K }>

/** How a kind is drawn at each level. */
export interface Renderings<K extends DrawnKind> {
  readonly icon: string
  readonly Face: (p: { face: FaceOf<K> }) => ReactNode
  readonly Normal: (p: { card: CardOf<K>; width: CardWidth }) => ReactNode
  readonly Whole: (p: { card: CardOf<K>; width: CardWidth }) => ReactNode
}

/** A card's put, onto the column last focused, as its open frame's foot. */
function PutButton(p: { card: CardRecord; title: string }) {
  const { column, onIntent } = useRendering()
  return (
    <button
      className="put primary"
      disabled={column === null}
      onClick={() => {
        if (column !== null)
          onIntent({
            kind: "put",
            card: p.card.id,
            target: { kind: "column", key: column },
          })
      }}
      title={p.title}
      type="button"
    >
      {PUT}
    </button>
  )
}

/** A thread's put: onto the canvas you are on, after the column you were in. */
const PUT_THREAD_TITLE =
  "put this thread on the canvas you are on, after the column you were in"

/**
 * A text card folded (ADR-0113): a strip in its place's colour, its kind's
 * icon, its owner's circle, its command's chip, its first three lines, and
 * its slot's key in your inventory. Not an `Avatar`: the browser suite
 * counts people by `.avatar`.
 */
function TextFaceView({ face }: { face: FaceOf<"text"> }) {
  const { reader, colorOf } = useRendering()
  const words = textFaceWords(face, reader)
  return (
    <span
      className="card-face"
      data-tone={face.tone}
      title={`${words.owner}: ${face.lines}`}
    >
      <span className="card-face-head">
        <span aria-hidden className="card-icon">
          {KIND_ICON.text}
        </span>
        <Initial
          className="card-face-owner"
          colorOf={colorOf}
          nameOf={reader.nameOf}
          writer={face.owner}
        />
        {words.command !== null && (
          <span className="card-chip">{words.command}</span>
        )}
        {face.key !== null && <span className="card-face-key">{face.key}</span>}
      </span>
      <span className="card-face-lines">{face.lines}</span>
    </span>
  )
}

/** A card drawn normal: bounded at a column's height, scrolling, read only. */
function NormalFrame(p: {
  kind: DrawnKind
  card: CardRecord
  width: CardWidth
  children: ReactNode
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

/** A text card opened: its editor in its frame, with its put. */
function TextWhole(p: { card: CardOf<"text">; width: CardWidth }) {
  const { session, reader, onIntent } = useRendering()
  return (
    <BoundCardEditor
      among={null}
      card={p.card}
      catchUps={null}
      foot={<PutButton card={p.card} title={PUT_TITLE} />}
      key={p.card.id}
      onDiscard={() => onIntent({ kind: "discard", card: p.card.id })}
      onTyping={() => {}}
      readOnly={false}
      reader={reader}
      rows={4}
      session={session}
      view={cardFrame(p.card, "inventory", { me: reader.me, readOnly: false })}
    />
  )
}

/** A thread's card, normal: its face, then its first and last messages. */
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

/** A thread's card opened: its path, read only, with its put (ADR-0124). */
function ThreadWhole(p: { card: CardOf<"thread">; width: CardWidth }) {
  const { previewOf } = useRendering()
  return (
    <ThreadPreviewView
      foot={<PutButton card={p.card} title={PUT_THREAD_TITLE} />}
      preview={previewOf(p.card.id)}
    />
  )
}

function NoteColumnFaceView({ face }: { face: FaceOf<"note-column"> }) {
  return (
    <span className="note-column-face" data-card={face.card}>
      <span aria-hidden className="card-icon">
        {KIND_ICON["note-column"]}
      </span>
      <span className="note-column-face-title">{face.title}</span>
      {face.notes !== null && (
        <span className="note-column-face-count">{face.notes}</span>
      )}
    </span>
  )
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

/** A reference's quote, fetched from its blob: it never changes (ADR-0126). */
function useQuote(quote: Sha256): string | null {
  const [loaded] = useFetched([blobUrl(quote)], r => r.text())
  return loaded?.kind === "ready" ? loaded.value : null
}

/** A reference's face: a chip naming what it names, with its slot's key. */
function ReferenceFaceView({ face }: { face: FaceOf<"reference"> }) {
  return (
    <span className="reference-face" data-card={face.card}>
      <span aria-hidden className="card-icon">
        {KIND_ICON.reference}
      </span>
      <span className="reference-face-label">{addressWords(face.address)}</span>
      {face.key !== null && <span className="card-face-key">{face.key}</span>}
    </span>
  )
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
 * *Edit as text*, which makes it a text card you can change (ADR-0126).
 */
function ReferenceWhole(p: { card: CardOf<"reference">; width: CardWidth }) {
  const { onIntent, threadNames } = useRendering()
  const quote = useQuote(p.card.content.quote)
  const { address } = p.card.content
  const from =
    address.kind === "card" ? null : (threadNames.get(address.thread) ?? null)
  return (
    <NormalFrame card={p.card} kind="reference" width={p.width}>
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

/** A fact's face: its kind's icon, and its line. */
function FactFaceView({ face }: { face: FaceOf<"fact"> }) {
  return (
    <span className="fact-face" data-card={face.card}>
      <span aria-hidden className="card-icon">
        {KIND_ICON.fact}
      </span>
      {factLine(face.fact)}
    </span>
  )
}

/**
 * A fact, normal and whole alike (ADR-0080): its one line, the host's,
 * waiting for its thread's end. Nobody edits or moves it.
 */
function FactLine(p: { card: CardOf<"fact">; width: CardWidth }) {
  return (
    <div className="queued-fact" data-card={p.card.id}>
      {factLine(p.card.content.fact)}
    </div>
  )
}

/** An ask card's face: its kind's icon, and its line. */
function AskFaceView({ face }: { face: FaceOf<"ask"> }) {
  return (
    <span className="fact-face" data-card={face.card}>
      <span aria-hidden className="card-icon">
        {KIND_ICON.ask}
      </span>
      {askLine(face.relay)}
    </span>
  )
}

/**
 * An ask from another thread, normal and whole alike (ADR-0128): its one
 * line, the host's, waiting for its thread's end. Nobody edits or moves it.
 */
function AskLine(p: { card: CardOf<"ask">; width: CardWidth }) {
  return (
    <div className="queued-fact queued-ask" data-card={p.card.id}>
      {askLine(p.card.content.relay)}
    </div>
  )
}

/** Every kind, drawn at every level. */
export const RENDERINGS = {
  text: {
    icon: KIND_ICON.text,
    Face: TextFaceView,
    Normal: TextNormal,
    Whole: TextWhole,
  },
  thread: {
    icon: KIND_ICON.thread,
    Face: ThreadFaceView,
    Normal: ThreadNormal,
    Whole: ThreadWhole,
  },
  "note-column": {
    icon: KIND_ICON["note-column"],
    Face: NoteColumnFaceView,
    Normal: p => <NoteList {...p} limit={NOTES_SHOWN} />,
    Whole: p => <NoteList {...p} limit={null} />,
  },
  fact: {
    icon: KIND_ICON.fact,
    Face: FactFaceView,
    Normal: FactLine,
    Whole: FactLine,
  },
  reference: {
    icon: KIND_ICON.reference,
    Face: ReferenceFaceView,
    Normal: ReferenceNormal,
    Whole: ReferenceWhole,
  },
  ask: {
    icon: KIND_ICON.ask,
    Face: AskFaceView,
    Normal: AskLine,
    Whole: AskLine,
  },
} as const satisfies { readonly [K in DrawnKind]: Renderings<K> }

const NoteColumnRow = RENDERINGS["note-column"]

/** `face`, drawn by its kind's row. */
export function DrawFace({ face }: { face: Face }) {
  switch (face.kind) {
    case "text":
      return <RENDERINGS.text.Face face={face} />
    case "thread":
      return <RENDERINGS.thread.Face face={face} />
    case "note-column":
      return <NoteColumnRow.Face face={face} />
    case "fact":
      return <RENDERINGS.fact.Face face={face} />
    case "reference":
      return <RENDERINGS.reference.Face face={face} />
    case "ask":
      return <RENDERINGS.ask.Face face={face} />
  }
}

/** `card` at `detail` above a face, `width` columns wide, by its kind's row. */
export function DrawCard(p: {
  card: CardRecord
  detail: Exclude<Detail, "face">
  width: CardWidth
}) {
  const { card, width } = p
  const whole = p.detail === "whole"
  switch (card.kind) {
    case "text":
      return whole ? (
        <RENDERINGS.text.Whole card={card} width={width} />
      ) : (
        <RENDERINGS.text.Normal card={card} width={width} />
      )
    case "thread":
      return whole ? (
        <RENDERINGS.thread.Whole card={card} width={width} />
      ) : (
        <RENDERINGS.thread.Normal card={card} width={width} />
      )
    case "note-column":
      return whole ? (
        <NoteColumnRow.Whole card={card} width={width} />
      ) : (
        <NoteColumnRow.Normal card={card} width={width} />
      )
    case "fact":
      return whole ? (
        <RENDERINGS.fact.Whole card={card} width={width} />
      ) : (
        <RENDERINGS.fact.Normal card={card} width={width} />
      )
    case "reference":
      return whole ? (
        <RENDERINGS.reference.Whole card={card} width={width} />
      ) : (
        <RENDERINGS.reference.Normal card={card} width={width} />
      )
    case "ask":
      return <RENDERINGS.ask.Normal card={card} width={width} />
  }
}
