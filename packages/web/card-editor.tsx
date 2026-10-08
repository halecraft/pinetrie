// web/card-editor — one card's editor (ADR-0048), in its frame
// (`card-frame.tsx`, ADR-0111): your message in the composer and the box
// "+ pin" opens, each a `CardEditor`; each note at a thread's end
// (`NoteCardEditor`), each queued card above the line (`QueuedCardEditor`),
// each pinned card and the card selected in your inventory, all a
// `BoundCardEditor`.
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
  AcceptedRecord,
  CardId,
  CardPlace,
  CardRecord,
  CommandSummary,
  PinnedView,
  Position,
  ProjectRecord,
  SeatRecord,
  ThreadLane,
  WorkSetting,
} from "@pinetrie/core"
import { commandOf } from "@pinetrie/core"
import {
  baseChoices,
  type CardFrameFacts,
  type CardFrameView,
  type CatchUps,
  type ColumnAct,
  type ColumnHow,
  type ComposerMode,
  cardFrame,
  cardKeyAct,
  type EditorEvent,
  type EditorState,
  type EditorStep,
  editorState,
  forkWords,
  free,
  type Intent,
  imageMarkdown,
  insertAt,
  matchCommands,
  NEW_PIN_PLACEHOLDER,
  type Pending,
  type Prefill,
  pastedFiles,
  pinnedStatus,
  placeholderWords,
  planSend,
  queueWords,
  type Reader,
  type ReadOnly,
  type Selection,
  sendable,
  sendButton,
  settleSend,
  shownBy,
  sizeWords,
  spent,
  startText,
  tokensOf,
  uploadImage,
  whereChoices,
  whereWords,
} from "@pinetrie/interface"
import { type QueuedCard, writersOfClients } from "@pinetrie/rules"
import { textClients } from "@pinetrie/schema"
import { IN_COLUMN, newCardId, type SessionClient } from "@pinetrie/session"
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { CardFrame } from "./card-frame.tsx"
import { Menu } from "./menu.tsx"
import { useStable } from "./use-stable.ts"

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
  /** Accepted work, for the bases a new lane may start from (ADR-0104). */
  readonly accepted: AcceptedRecord | null
  /** Files conflicted in the commit a new lane here would be cloned from (ADR-0072). */
  readonly forkConflicts: number
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
 * the host pops it in turn (ADR-0108, ADR-0059).
 *
 * A box whose `place` is pinned is the one "+ pin" opens: it makes a pinned
 * card at the first keystroke worth keeping and goes on editing it, the same
 * element, so nothing typed is lost. It never sends: Enter is a new line,
 * and Escape or leaving it closes it (`onLeave`).
 */
export function CardEditor(p: {
  session: SessionClient
  /** The card this edits: your message here (`yourCard`), once it exists. */
  card: CardRecord | undefined
  /** Where a card made from this box goes; undefined where none may be made. */
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
  /** What the box starts with, unsent: a fresh column's (`Prefill`). */
  prefill: Prefill | undefined
  /** A first message to send at once: this column was opened to send it. */
  pending: Pending | undefined
  /** Where a lane the send creates works; absent for the "+ pin" box. */
  where: Where | undefined
  readOnly: ReadOnly | null
  /** A fresh column's send id, recorded before its message is sent. */
  onSend: () => string | undefined
  /** After a conflict: open a branch at `at`, which sends the card's text. */
  onBranchInstead: (pending: Pending) => void
  /**
   * Called on each keystroke, with the card the box then shows; presence is
   * written at most once a second.
   */
  onTyping: (card: CardId | null) => void
  /** Told whether the next send would create a lane, each time that changes. */
  onCreatesLane: ((createsLane: boolean) => void) | undefined
  /**
   * Told the box's state each time it changes: the "+ pin" box's, so the
   * strip leaves out the card it shows.
   */
  onShows: ((state: EditorState) => void) | undefined
  /** Where a read-only action goes (`ReadOnly.action.intent`). */
  onIntent: (intent: Intent) => void
  /** The column's acts: queueing a card, clearing its command. */
  onAct: (act: ColumnAct) => void
  /** What a card's command catches up with: the thread's base, or the thread it branched from. */
  catchUps: CatchUps
  /** Whether this column asked for focus, just opened. Asked on mounting. */
  takeFocus: (() => boolean) | undefined
  /** A pinning box's focus left it: the column closes it. */
  onLeave: (() => void) | undefined
}) {
  const { session, prefill, pending } = p
  const pins = p.place?.kind === "pinned"
  const box = useRef<HTMLTextAreaElement>(null)
  const [state, setState] = useState<EditorState>(() =>
    p.card === undefined
      ? { kind: "local" }
      : { kind: "bound", card: p.card.id },
  )
  // The card the box shows: `p.card` once the state holds it.
  const card = p.card?.id === shownBy(state) ? p.card : undefined
  // The state as the handlers last left it, read synchronously between renders.
  const current = useRef(state)
  // The box's text, as shown: the element's while local, the card's while bound.
  const [text, setText] = useState(() =>
    startText({ pending, card: p.card, prefill }),
  )
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
  /** The WIP a new lane of its own starts from; null for accepted work (ADR-0104). */
  const [base, setBase] = useState<string | null>(null)
  const command = card === undefined ? null : commandOf(card)
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
  const matches = pins || hidden === text ? [] : matchCommands(text, p.commands)
  const highlighted = matches[Math.min(picked, matches.length - 1)]
  const work = choice ?? p.where?.defaultWork ?? null
  const { onCreatesLane, onShows } = p
  useEffect(
    () => onCreatesLane?.(plan.createsLane),
    [plan.createsLane, onCreatesLane],
  )
  useEffect(() => onShows?.(state), [state, onShows])

  /** Bind the box to a card's text, keeping the caret where it is. */
  const bind = (id: CardId) => {
    const el = box.current
    if (el === null) return
    detach.current?.()
    const { selectionStart, selectionEnd } = el
    detach.current = bindText(session, id, el, setText)
    el.setSelectionRange(selectionStart, selectionEnd)
  }
  /**
   * Unbind the box, and empty it. Kyneta's detach puts back the `readOnly`
   * the box had when it was bound, which React then no longer knows of: a
   * box bound while its column was read-only would stay so. So it is set
   * again from what the box is now.
   */
  const unbind = () => {
    detach.current?.()
    detach.current = null
    const el = box.current
    if (el !== null) {
      el.value = ""
      el.readOnly = p.readOnly !== null || current.current.kind === "sending"
    }
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
              place: p.place,
              carries: { kind: "message", command: null },
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
    const card = p.card
    if (card !== undefined) {
      if (now.kind === "bound" && now.card === card.id) {
        seen.current = card.id
        if (detach.current === null) bind(card.id)
      } else if (now.kind === "bound") {
        // Another card took its place: a card dropped here, whose swap
        // took the one it showed away (`planPut`).
        step({ kind: "gone" })
        seen.current = card.id
        step({ kind: "found", card: card.id })
      } else if (now.kind === "local") {
        seen.current = card.id
        step({ kind: "found", card: card.id })
      }
    } else if (now.kind === "bound" && seen.current === now.card) {
      step({ kind: "gone" })
    }
  }, [p.card?.id, state.kind === "local"])
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
   * Queue the card on this column's lane, from its end, releasing a held
   * queue when the plan says so (ADR-0113). False when there is no card or
   * no lane to queue on: nothing was queued.
   */
  const queueHere = (from: CardId | null): boolean => {
    if (from === null || p.lane.kind !== "lane" || p.at.kind !== "entry")
      return false
    p.onAct({
      kind: "queue",
      card: from,
      lane: p.lane.name,
      at: p.at,
      hold: plan.hold,
    })
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
    await send(message, plan.mode, shownBy(now))
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

  const { readOnly } = p
  const frame = cardFrame(card ?? null, pins ? "pinned" : "composing", {
    me: session.writer,
    queueOn:
      p.lane.kind === "lane" && p.at.kind === "entry"
        ? { lane: p.lane.name, at: p.at }
        : null,
    readOnly: readOnly !== null,
  })

  return (
    <CardFrame
      card={card ?? null}
      catchUps={p.catchUps}
      pinning={pins}
      foot={
        frame.primary !== "send" ? null : (
          <>
            {readOnly !== null ? (
              <div className="read-only">
                <span className="read-only-label">{readOnly.label}</span>
                {readOnly.action !== null && (
                  <button
                    className="read-only-action"
                    onClick={() => {
                      if (readOnly.action !== null)
                        p.onIntent(readOnly.action.intent)
                    }}
                    type="button"
                  >
                    {readOnly.action.title}
                  </button>
                )}
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
                        accepted={p.where.accepted}
                        base={base}
                        chooseBase={setBase}
                      />
                      {work.kind === "own" && p.where.forkConflicts > 0 && (
                        <span className="where-fork-conflict">
                          {forkWords(p.where.forkConflicts)}
                        </span>
                      )}
                    </div>
                  )}
                <button
                  className="send primary"
                  disabled={button.disabled}
                  onClick={() => void submit()}
                  title={button.title ?? undefined}
                  type="button"
                >
                  {button.label}
                </button>
              </div>
            )}
            <span className="status">{status}</span>
          </>
        )
      }
      onAct={p.onAct}
      onClearCommand={
        card === undefined || readOnly !== null
          ? null
          : () => p.onAct({ kind: "setCommand", card: card.id, command: null })
      }
      onDiscard={() => {
        if (card !== undefined) p.onAct({ kind: "discard", card: card.id })
      }}
      reader={p.reader}
      view={frame}
    >
      {conflict !== null && (
        <div className="conflict">
          <span className="conflict-text">{conflict.line}</span>{" "}
          <button
            className="queue-after"
            onClick={() =>
              void send(conflict.text, "queue", shownBy(current.current))
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
              const from = shownBy(current.current)
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
      {/* Enter sends; Shift+Enter is a new line; in a pinning box, Enter is
          a new line. It grows with what is typed, up to a limit, then
          scrolls. Uncontrolled: while bound, the card's binding owns its
          value. */}
      <textarea
        autoComplete="off"
        className="input"
        data-card={card?.id}
        defaultValue={text}
        onBlur={pins ? p.onLeave : undefined}
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
          if (free(current.current) && p.place !== undefined)
            step({ kind: "input", text: value, card: newCardId() })
          p.onTyping(shownBy(current.current))
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
          if (card !== undefined && p.readOnly === null) {
            const act = cardKeyAct(keyOfBox(e), card.id, null)
            if (act !== null) {
              e.preventDefault()
              p.onAct(act)
              return
            }
          }
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
          if (pins) {
            if (e.key !== "Escape") return
            e.preventDefault()
            e.currentTarget.blur()
            return
          }
          if (e.key !== "Enter" || e.shiftKey) return
          e.preventDefault()
          void submit()
        }}
        placeholder={pins ? NEW_PIN_PLACEHOLDER : placeholderWords(plan)}
        readOnly={p.readOnly !== null || state.kind === "sending"}
        ref={box}
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
      />
    </CardFrame>
  )
}

/**
 * A card that exists, bound whole, in its frame: a queued or pinned card,
 * and your inventory's selected card.
 */
export function BoundCardEditor(p: {
  session: SessionClient
  card: CardRecord
  view: CardFrameView
  reader: Reader
  /** What a command catches up with at its thread; null in your inventory. */
  catchUps: CatchUps | null
  readOnly: boolean
  /** The box's least height, in lines. */
  rows: number
  /** Called on each keystroke in its box, with its card. */
  onTyping: (card: CardId) => void
  /** Its footer, after ↑ and ↓. */
  foot: ReactNode
  /** Told the card's text each time it changes. */
  onText?: (text: string) => void
  /**
   * A queued or pinned card's list as drawn, which Alt+↑/↓ in its box move
   * it in (ADR-0048 step 7); null for a card with no place in line.
   */
  among: readonly CardRecord[] | null
  /** A move from its ⋯, a ↑ or ↓, or a key in its box; absent where it has none. */
  onAct?: (act: ColumnAct) => void
  /** Discards the card (ADR-0111): its × and Ctrl+Shift+Backspace. */
  onDiscard: () => void
  /** Every seat the host has seen, to name who wrote in a note; empty for none. */
  seats?: readonly SeatRecord[]
}) {
  const { session, card, view } = p
  const box = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState("")
  // Of fixed identity, so a new `onText` each render never binds the box again.
  const told = useStable((t: string) => {
    setText(t)
    p.onText?.(t)
  })
  useEffect(() => {
    const el = box.current
    return el === null ? undefined : bindText(session, card.id, el, told)
  }, [session, card.id, told])
  // A read-only box moves nothing (`cardFrame`).
  const among = view.tools.length === 0 ? null : p.among
  const onAct = p.onAct ?? (() => {})
  return (
    <CardFrame
      card={card}
      catchUps={p.catchUps}
      foot={p.foot}
      onAct={onAct}
      onClearCommand={null}
      onDiscard={p.onDiscard}
      reader={p.reader}
      view={view}
      writers={
        p.seats === undefined
          ? []
          : writersOfClients(textClients(session.cardText(card.id)), p.seats)
      }
    >
      <textarea
        autoComplete="off"
        className="input"
        data-card={card.id}
        onInput={() => p.onTyping(card.id)}
        onKeyDown={e => {
          const act = cardKeyAct(
            keyOfBox(e),
            card.id,
            among === null ? null : among.map(c => c.id),
          )
          if (act === null) return
          if (act.kind === "discard" && !view.discards) return
          if (act.kind === "reorder" && among === null) return
          e.preventDefault()
          if (act.kind === "discard") p.onDiscard()
          else onAct(act)
        }}
        readOnly={p.readOnly}
        ref={box}
        rows={Math.min(8, Math.max(p.rows, text.split("\n").length))}
      />
    </CardFrame>
  )
}

/** A card box's keydown, as `cardKeyAct` reads it. */
const keyOfBox = (e: KeyboardEvent<HTMLTextAreaElement>) => ({
  key: e.key,
  altKey: e.altKey,
  ctrlKey: e.ctrlKey,
  metaKey: e.metaKey,
  shiftKey: e.shiftKey,
  isComposing: e.nativeEvent.isComposing,
})

/**
 * A note at a thread's end (ADR-0113): its text, which anyone here may
 * edit, and whose it is. It has no send: Enter is a new line, and its ⋯
 * moves it into your message, the queue, the pinned cards or your
 * inventory.
 */
export function NoteCardEditor(p: {
  session: SessionClient
  card: CardRecord
  /** Where a queue from its column puts it; null where nothing can be queued. */
  queueOn: CardFrameFacts["queueOn"]
  reader: Reader
  readOnly: ReadOnly | null
  catchUps: CatchUps
  seats: readonly SeatRecord[]
  onAct: (act: ColumnAct) => void
  onTyping: (card: CardId) => void
}) {
  const { card } = p
  const view = cardFrame(card, "note", {
    me: p.session.writer,
    queueOn: p.queueOn,
    readOnly: p.readOnly !== null,
  })
  return (
    <BoundCardEditor
      among={null}
      card={card}
      catchUps={p.catchUps}
      foot={null}
      onAct={p.onAct}
      onDiscard={() => p.onAct({ kind: "discard", card: card.id })}
      onTyping={p.onTyping}
      readOnly={p.readOnly !== null}
      reader={p.reader}
      rows={1}
      seats={p.seats}
      session={p.session}
      view={view}
    />
  )
}

/**
 * A queued card above the line (ADR-0048): its text, which anyone here may
 * edit until the host pops it, who queued it and its place in line, its
 * command, and ↑ and ↓ that move it in line (as Alt+↑/↓ in its box do). Its
 * other moves are its ⋯'s; the queue's controls send it.
 */
export function QueuedCardEditor(p: {
  session: SessionClient
  card: QueuedCard
  /** Its queue is held. */
  held: boolean
  reader: Reader
  readOnly: ReadOnly | null
  /** What its command catches up with: the thread's base, or the thread it branched from. */
  catchUps: CatchUps
  /** Its lane's queue as drawn, facts included: what a reorder moves it among. */
  among: readonly CardRecord[]
  onAct: (act: ColumnAct) => void
  onTyping: (card: CardId) => void
}) {
  const { card } = p
  const view = cardFrame(card, "queued", {
    me: p.session.writer,
    queueOn: null,
    among: p.among,
    held: p.held,
    pinned: null,
    readOnly: p.readOnly !== null,
  })
  return (
    <BoundCardEditor
      among={p.among}
      card={card}
      catchUps={p.catchUps}
      foot={null}
      onAct={p.onAct}
      onDiscard={() => p.onAct({ kind: "discard", card: card.id })}
      onTyping={p.onTyping}
      readOnly={p.readOnly !== null}
      reader={p.reader}
      rows={1}
      session={p.session}
      view={view}
    />
  )
}

/**
 * A pinned card at the top of its column (ADR-0048): its text, which anyone
 * here may edit, who pinned it, its size, how it stands against what the
 * agent last read (`inView`), and ↑ and ↓ that move it among the thread's
 * pinned cards (as Alt+↑/↓ in its box do). It has no send: Enter is a new
 * line. Its other moves are its ⋯'s.
 */
export function PinnedCardEditor(p: {
  session: SessionClient
  card: CardRecord
  /** What the agent reads of the thread's pinned cards now (`pinnedInView`). */
  inView: PinnedView | null
  /** The thread's pinned cards as drawn: what a reorder moves it among. */
  among: readonly CardRecord[]
  /** Where a queue from its column puts it; null where nothing can be queued. */
  queueOn: CardFrameFacts["queueOn"]
  reader: Reader
  readOnly: ReadOnly | null
  catchUps: CatchUps
  onAct: (act: ColumnAct) => void
  onTyping: (card: CardId) => void
}) {
  const { card } = p
  const [text, setText] = useState("")
  const view = cardFrame(card, "pinned", {
    me: p.session.writer,
    queueOn: p.queueOn,
    among: p.among,
    held: false,
    pinned: pinnedStatus(card, text, p.inView),
    readOnly: p.readOnly !== null,
  })
  return (
    <BoundCardEditor
      among={p.among}
      card={card}
      catchUps={p.catchUps}
      foot={<span className="pinned-size">{sizeWords(tokensOf(text))}</span>}
      onAct={p.onAct}
      onDiscard={() => p.onAct({ kind: "discard", card: card.id })}
      onText={setText}
      onTyping={p.onTyping}
      readOnly={p.readOnly !== null}
      reader={p.reader}
      rows={1}
      session={p.session}
      view={view}
    />
  )
}

/**
 * The line under the box that says where a new thread's agent works, and
 * what that does to your files; it opens the menu that changes it. A lane of
 * its own may start from a WIP instead of accepted work (ADR-0104), offered
 * only when there is one.
 */
function WhereMenu(p: {
  project: ProjectRecord
  usedDirs: readonly string[]
  work: WorkSetting
  choose: (work: WorkSetting) => void
  accepted: AcceptedRecord | null
  base: string | null
  chooseBase: (base: string | null) => void
}) {
  const row = (name: string, detail: string | null) => (
    <>
      <span className="where-name">{name}</span>
      {detail !== null && <span className="where-detail">{detail}</span>}
    </>
  )
  const bases = p.work.kind === "own" ? baseChoices(p.accepted, p.base) : []
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
            p.accepted?.acceptedBookmark ?? null,
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
