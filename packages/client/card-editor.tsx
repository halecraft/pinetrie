// client/card-editor — one card's editor (ADR-0048): your composer's box,
// every other drafting card at a thread's end, and each queued card above
// the line (`QueuedCardEditor`), and the card selected in your inventory, both
// a `BoundCardEditor`.
//
// One uncontrolled textarea for the editor's whole life. Until there is
// something worth keeping it is local; the input that makes it worth keeping
// creates the card and binds this same element to the card's text, in one
// handler, so no keystroke falls between the card existing and the element
// being bound, and focus and the caret never move. `editorState` decides each
// step; this component carries it out. Every write the editor makes itself
// (a command chosen, a pasted image) goes through the element, so no path
// asks whether a card exists yet.

import { attach } from "@kyneta/react"
import { subscribe } from "@kyneta/schema"
import type {
  CardId,
  CardPlace,
  CardRecord,
  CommandSummary,
  LineRecord,
  Position,
  ProjectRecord,
  SeatRecord,
  ThreadBase,
  ThreadLane,
  WorkSetting,
} from "@pineta/core"
import { type QueuedCard, writersOf } from "@pineta/marginalia"
import { textClients } from "@pineta/schema"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { ReadOnly } from "./app-view.ts"
import { IN_COLUMN } from "./card-moves.ts"
import {
  type EditorEvent,
  type EditorState,
  type EditorStep,
  editorState,
  startText,
} from "./card-state.ts"
import {
  CLEAR_COMMAND,
  cardStatus,
  commandNote,
  queuedWords,
  TAKE,
  TAKE_TITLE,
  UNQUEUE,
} from "./card-words.ts"
import type { Pending, Prefill } from "./columns.ts"
import { matchCommands } from "./commands.ts"
import { newCardId } from "./ids.ts"
import type { ColumnAct, Intent } from "./intent.ts"
import { Menu } from "./menu.tsx"
import { cardHeading } from "./names.ts"
import {
  imageMarkdown,
  insertAt,
  pastedFiles,
  type Selection,
  uploadImage,
} from "./paste.ts"
import { CARD_MIME } from "./put-target.ts"
import {
  baseChoices,
  type ComposerMode,
  placeholderWords,
  planSend,
  queueWords,
  type Reader,
  sendable,
  sendButton,
  settleSend,
  spent,
  whereChoices,
  whereWords,
} from "./send.ts"
import type { ColumnHow, SessionClient } from "./session-view.ts"

/**
 * Bind a box to a card's text, its undo reaching only that card's steps
 * (ADR-0052), and tell `onText` the text now and at every change, others'
 * edits included. Returns the unbinding.
 */
function bindText(
  session: SessionClient,
  id: CardId,
  el: HTMLTextAreaElement,
  onText: (text: string) => void,
): () => void {
  const doc = session.cardText(id)
  const off = attach(el, doc.text, { undo: session.undoFor(id) })
  onText(doc.text())
  const stop = subscribe(doc, () => onText(doc.text()))
  return () => {
    off()
    stop()
  }
}

/** Where a lane this editor's send creates would work, and the choices. */
export interface Where {
  /** The lane above's setting, else the project's default (`workFor`). */
  readonly defaultWork: WorkSetting | null
  readonly project: ProjectRecord | null
  /** Directories other lanes work in directly: offered again. */
  readonly usedDirs: readonly string[]
  /** The integration line, for the bases a new lane may start from (ADR-0060). */
  readonly line: LineRecord | null
}

/**
 * Before sending, the button says what the message will do: who it is for,
 * and whether it will wait. `planSend` decides as the host will, over the
 * thread `threadOf` gives (ADR-0021), and `sendButton` words it. When the send
 * starts an agent, a chip beside it says where that agent will work, and
 * changes it.
 *
 * A reply carries the end its sender saw. If another writer's compelled
 * message got there first, or the lane became busy, the host writes nothing
 * and says so (`conflict`), and the sender chooses: queue, or branch here.
 * Either way, and after a refusal, the card is still there: nothing is put
 * back, because nothing was taken away. A send to a busy lane, or of a card
 * with a command, queues the card instead: this client asks the host to, and
 * the host takes it in turn (ADR-0055, ADR-0059).
 */
export function CardEditor(p: {
  session: SessionClient
  /** The card this edits: yours here once it exists, or someone else's. */
  card: CardRecord | undefined
  /**
   * Where a card made from this box goes: yours, at this column. Undefined
   * for someone else's card, which always exists.
   */
  place: CardPlace | undefined
  /** Where the message attaches: the column's end, or its branch point. */
  at: Position
  /** The thread's lane, from `threadOf`: whether the agent is busy there. */
  lane: ThreadLane
  /**
   * What every send from this column carries: its bound lane, whether it is a
   * Start Agent column, and its reserved lane (ADR-0057).
   */
  how: ColumnHow
  /** A fresh column: its first message starts the thread (`branch`). */
  fresh: boolean
  /** The commands the host's pi loaded, for completion (ADR-0036). */
  commands: readonly CommandSummary[]
  /** Everyone who can be mentioned, as shown. */
  participants: readonly string[]
  /** Who is sending, and everyone's names. */
  reader: Reader
  /** Every seat the host has seen: who wrote in the card (`writersOf`). */
  seats: readonly SeatRecord[]
  /** What the box starts with, unsent: a fresh column's (`Prefill`). */
  prefill: Prefill | undefined
  /** A first message to send at once: this column was opened to send it. */
  pending: Pending | undefined
  /** Where a lane the send creates works; absent for someone else's card. */
  where: Where | undefined
  readOnly: ReadOnly | null
  /** A fresh column's send id, recorded before its message is sent. */
  onSend: () => string | undefined
  /** After a conflict: open a branch at `at`, which sends the card's text. */
  onBranchInstead: (pending: Pending) => void
  /** Called on each keystroke; presence is written at most once a second. */
  onTyping: () => void
  /** Told whether the next send would create a lane, each time that changes. */
  onCreatesLane: ((createsLane: boolean) => void) | undefined
  /**
   * Told which card the box shows, each time that changes: the column draws
   * every other card at its end above it, a card put there among them.
   */
  onShows: ((card: CardId | null) => void) | undefined
  /** Where a read-only action goes (`ReadOnly.action.intent`). */
  onIntent: (intent: Intent) => void
  /** The column's acts: queueing a card, clearing its command. */
  onAct: (act: ColumnAct) => void
  /** The thread's base (`effectiveBase`): what a card's command catches up with. */
  threadBase: ThreadBase
  /** Whether this column asked for focus, just opened. Asked on mounting. */
  takeFocus: (() => boolean) | undefined
}) {
  const { session, card, prefill, pending } = p
  const box = useRef<HTMLTextAreaElement>(null)
  const [state, setState] = useState<EditorState>(() =>
    card === undefined ? { kind: "local" } : { kind: "bound", card: card.id },
  )
  // The state as the handlers last left it, read synchronously between renders.
  const current = useRef(state)
  // The box's text, as shown: the element's while local, the card's while bound.
  const [text, setText] = useState(() => startText({ pending, card, prefill }))
  const detach = useRef<(() => void) | null>(null)
  const [status, setStatus] = useState("")
  const [uploading, setUploading] = useState(0)
  const [conflict, setConflict] = useState<{
    text: string
    line: string
  } | null>(null)
  const [choice, setChoice] = useState<WorkSetting | null>(
    prefill?.work ?? null,
  )
  /** The WIP a new lane of its own starts from; null for the line (ADR-0060). */
  const [base, setBase] = useState<string | null>(null)
  const command = card?.command ?? null
  const plan = planSend({
    text,
    fresh: p.fresh,
    lane: p.lane,
    asksAgent: p.how.asksAgent,
    participants: p.participants,
    reader: p.reader,
    command,
  })
  const button = sendButton(plan, {
    uploading: uploading > 0,
    sending: state.kind === "sending",
  })
  const queue = queueWords(plan.queue)
  const [hidden, setHidden] = useState<string | null>(null)
  const [picked, setPicked] = useState(0)
  const matches = hidden === text ? [] : matchCommands(text, p.commands)
  const highlighted = matches[Math.min(picked, matches.length - 1)]
  const work = choice ?? p.where?.defaultWork ?? null
  const { onCreatesLane, onShows } = p
  useEffect(
    () => onCreatesLane?.(plan.createsLane),
    [plan.createsLane, onCreatesLane],
  )
  const shows = state.kind === "local" ? null : state.card
  useEffect(() => onShows?.(shows), [shows, onShows])

  /** Bind the box to a card's text, keeping the caret where it is. */
  const bind = (id: CardId) => {
    const el = box.current
    if (el === null) return
    detach.current?.()
    const { selectionStart, selectionEnd } = el
    detach.current = bindText(session, id, el, setText)
    el.setSelectionRange(selectionStart, selectionEnd)
  }
  /** Unbind the box, and empty it. */
  const unbind = () => {
    detach.current?.()
    detach.current = null
    if (box.current !== null) box.current.value = ""
    setText("")
  }
  /**
   * One step of `editorState`, its acts carried out in its order. A card
   * that cannot be created ends the step: nothing is bound to it.
   */
  const step = (event: EditorEvent): EditorStep => {
    const next = editorState(current.current, event, prefill)
    current.current = next.state
    setState(next.state)
    for (const act of next.acts)
      switch (act) {
        case "create": {
          const el = box.current
          if (
            el === null ||
            p.place === undefined ||
            next.state.kind !== "bound"
          )
            return next
          session.createCard(
            {
              id: next.state.card,
              owner: session.writer,
              place: p.place,
              placer: session.writer,
              command: null,
              unsent: null,
            },
            el.value,
            IN_COLUMN(p.how.column),
          )
          break
        }
        case "attach":
          if (next.state.kind === "bound") bind(next.state.card)
          break
        case "detach":
          unbind()
          break
      }
    return next
  }

  // The card as the column finds it: found, or gone. Gone only once it was
  // seen: a card just created is not in the records until they redraw. A box
  // left empty by a send finds the card the column gives it then: one put
  // here while this one was being written.
  const seen = useRef<CardId | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the card's coming and going, and the box coming free
  useEffect(() => {
    const now = current.current
    if (card !== undefined) {
      if (now.kind === "bound" && now.card === card.id) {
        seen.current = card.id
        if (detach.current === null) bind(card.id)
      } else if (now.kind === "local") {
        seen.current = card.id
        step({ kind: "found", card: card.id })
      }
    } else if (now.kind === "bound" && seen.current === now.card) {
      step({ kind: "gone" })
    }
  }, [card?.id, state.kind === "local"])
  // Unbound on unmount. StrictMode mounts twice, so the handle is cleared
  // too: the second mount binds again.
  useEffect(
    () => () => {
      detach.current?.()
      detach.current = null
    },
    [],
  )

  /**
   * Queue the card on this column's lane, from its end. False when there is
   * no card or no lane to queue on: nothing was queued.
   */
  const queueHere = (from: CardId | null): boolean => {
    if (from === null || p.lane.kind !== "lane" || p.at.kind !== "entry")
      return false
    p.onAct({ kind: "queue", card: from, lane: p.lane.name, at: p.at })
    return true
  }
  const send = async (
    message: string,
    as: ComposerMode,
    from: CardId | null,
  ) => {
    step({ kind: "send" })
    setConflict(null)
    if (as === "queue") {
      p.onSend()
      step({ kind: "settled", spent: queueHere(from) })
      setStatus("")
      return
    }
    setStatus("sending…")
    const id = p.onSend()
    const outcome = await session.chat(message, p.at, {
      ...p.how,
      mode: as,
      ...(id === undefined ? {} : { id }),
      ...(plan.createsLane && choice !== null ? { work: choice } : {}),
      ...(plan.createsLane && work?.kind === "own" && base !== null
        ? { base }
        : {}),
      ...(from === null ? {} : { card: from }),
    })
    step({ kind: "settled", spent: spent(outcome) })
    const settled = settleSend(outcome, message, p.reader)
    setConflict(settled.conflict)
    setStatus(settled.status)
  }
  const cardOf = (s: EditorState): CardId | null =>
    s.kind === "local" ? null : s.card

  // Sent once, however often React runs effects (StrictMode runs them twice).
  const sentPending = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening
  useEffect(() => {
    if (pending === undefined || sentPending.current) return
    sentPending.current = true
    void send(pending.text, "branch", pending.card ?? null)
  }, [])

  // A column you just opened is for typing in: focus lands after its
  // prefill (`onFocus`). After the strip's alignment, which is a layout
  // effect; the focus scrolls a column opened past the strip's edge into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening
  useEffect(() => {
    if (p.takeFocus?.() === true) box.current?.focus()
  }, [])

  /**
   * Write into the box as typing would: the element changes, and its `input`
   * event does the rest, local or bound.
   */
  const write = (start: number, end: number, insert: string) => {
    const el = box.current
    if (el === null) return
    el.setRangeText(insert, start, end, "end")
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }

  const choose = (name: string) => {
    write(0, box.current?.value.length ?? 0, `/${name} `)
    setPicked(0)
  }

  const submit = async () => {
    const message = sendable(text, prefill, uploading > 0, command)
    const now = current.current
    if (message === null || p.readOnly !== null || now.kind === "sending")
      return
    await send(message, plan.mode, cardOf(now))
  }

  /**
   * Upload pasted images, then put their markdown where the selection was
   * when they were pasted, all at once and in order. A refused one is left
   * out, and the host's reason shown.
   */
  const pasteImages = async (files: readonly File[], at: Selection) => {
    setUploading(n => n + 1)
    setStatus("uploading image…")
    const uploads = await Promise.all(files.map(uploadImage))
    setUploading(n => n - 1)
    const snippets = uploads.flatMap((u, i) =>
      u.ok ? [imageMarkdown(files[i]?.name ?? "", u.ref)] : [],
    )
    const refused = uploads.flatMap(u => (u.ok ? [] : [u.reason]))
    setStatus(
      refused.length === 0 ? "" : `image not added: ${refused.join("; ")}`,
    )
    const el = box.current
    if (snippets.length === 0 || el === null) return
    // `insertAt` decides the text, a line of its own for each image; the
    // element is given it as one edit over the selection, as typing would.
    const before = el.value
    const start = Math.min(at.start, before.length)
    const end = Math.min(Math.max(at.end, start), before.length)
    const after = insertAt(before, at, snippets.join("\n")).text
    write(start, end, after.slice(start, after.length - (before.length - end)))
  }

  const writers =
    card === undefined
      ? []
      : writersOf(textClients(session.cardText(card.id)), p.seats)
  const others = card !== undefined && card.owner !== session.writer
  const { readOnly } = p

  return (
    <div className={others ? "card-editor others" : "card-editor"}>
      {others && card !== undefined && (
        <div className="card-heading">
          {cardHeading(p.reader.nameOf, card.owner, writers)}
        </div>
      )}
      {conflict !== null && (
        <div className="conflict">
          <span className="conflict-text">{conflict.line}</span>{" "}
          <button
            className="queue-after"
            onClick={() =>
              void send(conflict.text, "queue", cardOf(current.current))
            }
            title={queue.title ?? undefined}
            type="button"
          >
            {queue.label}
          </button>{" "}
          <button
            className="branch-instead"
            onClick={() => {
              setConflict(null)
              const from = cardOf(current.current)
              p.onBranchInstead({
                text: conflict.text,
                ...(from === null ? {} : { card: from }),
              })
            }}
            type="button"
          >
            branch here
          </button>
        </div>
      )}
      {card !== undefined && command !== null && p.readOnly === null && (
        <div className="card-command">
          {commandNote(command, p.threadBase)}{" "}
          <button
            aria-label={CLEAR_COMMAND}
            className="card-command-clear"
            onClick={() =>
              p.onAct({ kind: "setCommand", card: card.id, command: null })
            }
            title={CLEAR_COMMAND}
            type="button"
          >
            ×
          </button>
        </div>
      )}
      {matches.length > 0 && p.readOnly === null && (
        <div className="command-menu" role="listbox">
          {matches.map(c => (
            <div
              aria-selected={c === highlighted}
              className={c === highlighted ? "command highlighted" : "command"}
              data-command={c.name}
              key={c.name}
              onMouseDown={e => {
                // Before the input loses focus.
                e.preventDefault()
                choose(c.name)
              }}
              role="option"
              // Focus stays in the input; the keys there move the choice.
              tabIndex={-1}
            >
              <span className="command-name">/{c.name}</span>
              {c.argumentHint !== null && (
                <span className="command-hint"> {c.argumentHint}</span>
              )}
              <span className="command-kind"> · {c.kind}</span>
              {c.description !== "" && (
                <span className="command-description"> {c.description}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {/* Enter sends; Shift+Enter is a new line. It grows with what is
          typed, up to a limit, then scrolls. Uncontrolled: while bound, the
          card's binding owns its value. */}
      <textarea
        autoComplete="off"
        className="input"
        data-card={card?.id}
        defaultValue={text}
        onFocus={e => {
          // Focused while it holds only what it started with: type after it.
          if (prefill === undefined || e.currentTarget.value !== prefill.text)
            return
          const end = e.currentTarget.value.length
          e.currentTarget.setSelectionRange(end, end)
        }}
        onInput={e => {
          const value = e.currentTarget.value
          setText(value)
          setPicked(0)
          p.onTyping()
          if (current.current.kind === "local" && p.place !== undefined)
            step({ kind: "input", text: value, card: newCardId() })
        }}
        onPaste={e => {
          const files = pastedFiles(e.clipboardData)
          if (files.length === 0) return
          e.preventDefault()
          const el = e.currentTarget
          void pasteImages(files, {
            start: el.selectionStart,
            end: el.selectionEnd,
          })
        }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          // While commands are offered, the keys move through them.
          if (highlighted !== undefined) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              const by = e.key === "ArrowDown" ? 1 : -1
              setPicked((picked + by + matches.length) % matches.length)
              return
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault()
              choose(highlighted.name)
              return
            }
            if (e.key === "Escape") {
              e.preventDefault()
              setHidden(text)
              return
            }
          }
          if (e.key !== "Enter" || e.shiftKey) return
          e.preventDefault()
          void submit()
        }}
        placeholder={placeholderWords(plan)}
        readOnly={p.readOnly !== null || state.kind === "sending"}
        ref={box}
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
      />
      {readOnly !== null ? (
        <div className="read-only">
          <span className="read-only-label">{readOnly.label}</span>
          <button
            className="read-only-action"
            onClick={() => p.onIntent(readOnly.action.intent)}
            type="button"
          >
            {readOnly.action.title}
          </button>
        </div>
      ) : (
        <div className="compose-row">
          {plan.createsLane &&
            work !== null &&
            p.where !== undefined &&
            p.where.project !== null && (
              <div className="where-line">
                <WhereMenu
                  project={p.where.project}
                  usedDirs={p.where.usedDirs}
                  work={work}
                  choose={setChoice}
                  line={p.where.line}
                  base={base}
                  chooseBase={setBase}
                />
              </div>
            )}
          {card !== undefined && (
            <TakeButton
              card={card.id}
              onTake={id => p.onAct({ kind: "take", card: id })}
            />
          )}
          <button
            className="send"
            disabled={button.disabled}
            onClick={() => void submit()}
            title={button.title ?? undefined}
            type="button"
          >
            {button.label}
          </button>
        </div>
      )}
      <span className="status">{cardStatus(status, card?.unsent ?? null)}</span>
    </div>
  )
}

/** Start a card's drag: its id, under Pineta's own type (`put-target.ts`). */
export const dragCard = (
  e: { readonly dataTransfer: DataTransfer | null },
  card: CardId,
) => {
  e.dataTransfer?.setData(CARD_MIME, card)
  if (e.dataTransfer !== null) e.dataTransfer.effectAllowed = "move"
}

/**
 * A card's take button: a press takes it into your inventory, and a drag
 * moves it wherever it is dropped (ADR-0048).
 */
export function TakeButton(p: {
  card: CardId
  onTake: (card: CardId) => void
}) {
  return (
    <button
      className="take"
      data-card={p.card}
      draggable
      onClick={() => p.onTake(p.card)}
      onDragStart={e => dragCard(e, p.card)}
      title={TAKE_TITLE}
      type="button"
    >
      {TAKE}
    </button>
  )
}

/**
 * A card that exists, bound whole: a heading, its text, and its buttons. A
 * queued card is one, and so is your inventory's selected card.
 */
export function BoundCardEditor(p: {
  session: SessionClient
  card: CardRecord
  className: string
  heading: ReactNode
  readOnly: boolean
  /** The box's least height, in lines. */
  rows: number
  onTyping: () => void
  /** Its buttons. */
  children: ReactNode
  /** `data-queued`: a queued card's, which the browser suite reads. */
  queued: CardId | null
}) {
  const { session, card } = p
  const box = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState("")
  useEffect(() => {
    const el = box.current
    return el === null ? undefined : bindText(session, card.id, el, setText)
  }, [session, card.id])
  return (
    <div className={p.className} data-queued={p.queued ?? undefined}>
      <div className="card-heading">{p.heading}</div>
      <textarea
        autoComplete="off"
        className="input"
        data-card={card.id}
        onInput={p.onTyping}
        readOnly={p.readOnly}
        ref={box}
        rows={Math.min(8, Math.max(p.rows, text.split("\n").length))}
      />
      <div className="compose-row">{p.children}</div>
    </div>
  )
}

/**
 * A queued card above the line (ADR-0048): its text, which anyone here may
 * edit until the host takes it, who queued it and its place in line, its
 * command, a button that unqueues it, and one that takes it.
 */
export function QueuedCardEditor(p: {
  session: SessionClient
  card: QueuedCard
  /** Its place in its lane's queue, from 0. */
  n: number
  reader: Reader
  readOnly: ReadOnly | null
  /** The thread's base (`effectiveBase`): what its command catches up with. */
  threadBase: ThreadBase
  onAct: (act: ColumnAct) => void
  onTyping: () => void
}) {
  const { card } = p
  return (
    <BoundCardEditor
      card={card}
      className="card-editor queued"
      heading={
        <>
          {queuedWords(card.place.by, p.n, p.reader)}
          {card.command !== null && (
            <div className="card-command">
              {commandNote(card.command, p.threadBase)}
            </div>
          )}
        </>
      }
      onTyping={p.onTyping}
      queued={card.id}
      readOnly={p.readOnly !== null}
      rows={1}
      session={p.session}
    >
      {p.readOnly === null && (
        <>
          <button
            className="unqueue"
            onClick={() =>
              p.onAct({
                kind: "unqueue",
                card: card.id,
                lane: card.place.lane,
                by: card.place.by,
              })
            }
            type="button"
          >
            {UNQUEUE}
          </button>
          <TakeButton
            card={card.id}
            onTake={id => p.onAct({ kind: "take", card: id })}
          />
        </>
      )}
    </BoundCardEditor>
  )
}

/**
 * The line under the box that says where a new thread's agent works, and
 * what that does to your files; it opens the menu that changes it. A lane of
 * its own may start from a WIP instead of the project (ADR-0060), offered
 * only when there is one.
 */
function WhereMenu(p: {
  project: ProjectRecord
  usedDirs: readonly string[]
  work: WorkSetting
  choose: (work: WorkSetting) => void
  line: LineRecord | null
  base: string | null
  chooseBase: (base: string | null) => void
}) {
  const row = (name: string, detail: string | null) => (
    <>
      <span className="where-name">{name}</span>
      {detail !== null && <span className="where-detail">{detail}</span>}
    </>
  )
  const bases = p.work.kind === "own" ? baseChoices(p.line, p.base) : []
  return (
    <Menu
      className="where-menu"
      label="where the agent works"
      sections={[
        {
          key: "work",
          heading: "where the agent works",
          items: whereChoices(
            p.project,
            p.usedDirs,
            p.work,
            p.line?.onto ?? null,
          ).map(c => ({
            key: c.key,
            label: row(c.row, c.detail),
            className: c.className,
            disabled: c.disabled,
            ...(c.checked === undefined ? {} : { checked: c.checked }),
            ...(c.title === undefined ? {} : { title: c.title }),
            onChoose: () => {
              if (c.setting !== null) return p.choose(c.setting)
              const dir = window.prompt("The directory to work in")?.trim()
              if (dir !== undefined && dir !== "")
                p.choose({ kind: "direct", dir })
            },
          })),
        },
        ...(bases.length === 0
          ? []
          : [
              {
                key: "base",
                heading: "start from",
                items: bases.map(c => ({
                  key: c.key,
                  label: row(c.row, c.detail),
                  className: "where-base",
                  checked: c.chosen,
                  title: c.title,
                  data: { base: c.base ?? "" },
                  onChoose: () => p.chooseBase(c.base),
                })),
              },
            ]),
      ]}
      trigger={
        <>
          <span className="where-words" data-work={p.work.kind}>
            {whereWords(
              p.work,
              p.project,
              p.work.kind === "own" ? p.base : null,
            )}
          </span>
          <span className="where-caret">▾</span>
        </>
      }
      triggerClassName="where-trigger"
    />
  )
}
