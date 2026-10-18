// web/card-editor — one card's editor, in its frame (`card-frame.tsx`): your
// message in the composer (`CardEditor`); the box a new note or pinned card
// is written in (`NewCardBox`); and each card that exists, a
// `BoundCardEditor`: a note (`NoteCardEditor`), a queued card
// (`QueuedCardEditor`), a pinned card, and the card selected in your
// inventory.
//
// One uncontrolled textarea for the editor's whole life. Until there is
// something worth keeping it is local; the input that makes it worth keeping
// creates the card and binds this same element to the card's text, in one
// handler, so no keystroke falls between the card existing and the element
// being bound, and focus and the caret never move. `editorState` decides each
// step; `useCardBox` (`card-box.ts`) carries it out. Every write your
// message's editor makes itself (a command chosen, a pasted image) goes
// through the element, so no path asks whether a card exists yet.

import type {
  AgentCandidate,
  CardId,
  CardRecord,
  PinnedView,
  Position,
  TextPlace,
  ThreadLane,
} from "@pinetrie/core"
import {
  cardCommand,
  type ListKey,
  type TextCard,
  type TextCardId,
} from "@pinetrie/core"
import {
  baseChoices,
  type CardFrameFacts,
  type CardFrameView,
  type CatchUps,
  type ColumnAct,
  type ColumnHow,
  type CompletionOption,
  type ComposerMode,
  cardFrame,
  cardKeyAct,
  completion,
  forkWords,
  free,
  type Intent,
  newCardBox,
  newCardKeys,
  type Pending,
  type Prefill,
  pinnedStatus,
  placeholderWords,
  planSend,
  queueWords,
  type Reader,
  type ReadOnly,
  SEE_SETUP,
  sendable,
  sendButton,
  settleSend,
  shownBy,
  sizeWords,
  spent,
  startText,
  startWords,
  textTokens,
} from "@pinetrie/interface"
import {
  type AcceptedRecord,
  type CommandSummary,
  type QueuedText,
  type SeatRecord,
  writersOfClients,
} from "@pinetrie/rules"
import { textClients } from "@pinetrie/schema"
import {
  columnMessageTarget,
  IN_COLUMN,
  newCardId,
  type SessionClient,
} from "@pinetrie/session"
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import { bindText, useCardBox } from "./card-box.ts"
import { CardFrame } from "./card-frame.tsx"
import { eventPastedFiles } from "./clipboard.ts"
import { useFocusClaim } from "./focus-claim.ts"
import { Menu } from "./menu.tsx"
import { useThreadStates } from "./thread-states.ts"
import { useShareFiles } from "./use-share-files.ts"
import { useStable } from "./use-stable.ts"

/** What a lane this editor's send creates would start from. */
export interface Where {
  /** Accepted work, for the bases a new lane may start from. */
  readonly accepted: AcceptedRecord | null
  /** Files conflicted in the commit a new lane here would be cloned from. */
  readonly forkConflicts: number
}

/**
 * Before sending, the button says what the message will do: who it is for, and
 * whether it will wait. `planSend` decides as the host will, over the column's
 * thread and its lane, and `sendButton` words it. When the send starts a thread
 * and there is a WIP, a line beside it says what the thread starts from, and
 * changes it (`StartLine`).
 *
 * A reply carries the end its sender saw. If another writer's compelled message
 * got there first, or the lane became busy, the host writes nothing and says so
 * (`conflict`), and the sender chooses: queue, or branch here. Either way, and
 * after a refusal, the card is still there: nothing is put back, because
 * nothing was taken away. A send to a busy lane, or of a card with a command,
 * queues the card instead: this client asks the host to, and the host pops it
 * in turn.
 */
export function CardEditor(p: {
  session: SessionClient
  /** The card this edits: your message here (`yourCard`), once it exists. */
  card: TextCard | undefined
  /** Where a card made from this box goes; undefined where none may be made. */
  place: TextPlace | undefined
  /** Where the message attaches: the column's end, or its branch point. */
  at: Position
  /** The thread's lane (`threadLane`): whether the agent is busy there. */
  lane: ThreadLane
  /**
   * What every send from this column carries: its thread, and a new canvas's
   * root.
   */
  how: ColumnHow
  /** A unstarted column: its first message starts the thread (`branch`). */
  unstarted: boolean
  /** The commands the host's pi loaded, for completion. */
  commands: readonly CommandSummary[]
  /** Why the host has no model (`noModelLine`); null when it has one. */
  noModel: string | null
  /** Everyone who can be mentioned, as shown. */
  participants: readonly string[]
  /** Other threads' agents a mention may reach. */
  agents: readonly AgentCandidate[]
  /** Who is sending, and everyone's names. */
  reader: Reader
  /** What the box starts with, unsent: a unstarted column's (`Prefill`). */
  prefill: Prefill | undefined
  /** A first message to send at once: this column was opened to send it. */
  pending: Pending | undefined
  /** Where a lane the send creates works. */
  where: Where
  readOnly: ReadOnly | null
  /** A unstarted column's send id, recorded before its message is sent. */
  onSend: () => string | undefined
  /** After a conflict: open a branch at `at`, which sends the card's text. */
  onBranchInstead: (pending: Pending) => void
  /**
   * Called on each keystroke, with the card the box then shows; presence is
   * written at most once a second.
   */
  onTyping: (card: CardId | null) => void
  /** Told whether the next send would create a lane, each time that changes. */
  onCreatesLane: (createsLane: boolean) => void
  /** Where a read-only action goes (`ReadOnly.action.intent`). */
  onIntent: (intent: Intent) => void
  /** The column's acts: queueing a card, clearing its command. */
  onAct: (act: ColumnAct) => void
  /** What a card's command catches up with: the thread's base, or the thread it branched from. */
  catchUps: CatchUps
}) {
  const { session, prefill, pending } = p
  const threadIn = useThreadStates()
  const { box, state, current, text, setText, boundTo, step } = useCardBox({
    session,
    start: p.card?.id,
    startText: startText({ pending, card: p.card, prefill }),
    prefill,
    found: () => p.card?.id,
    readOnly: p.readOnly !== null,
    make: (id, text) => {
      if (p.place === undefined) return false
      session.createCard(
        {
          id,
          place: p.place,
          content: { command: null, unsent: null, origin: null },
        },
        text,
        IN_COLUMN(p.how.column),
      )
      return true
    },
  })
  // The card the box shows: `p.card` once the state holds it.
  const card = p.card?.id === shownBy(state) ? p.card : undefined
  const [status, setStatus] = useState("")
  const shares = useShareFiles(
    p.readOnly === null ? { box, session, boundTo } : null,
  )
  const [conflict, setConflict] = useState<{
    text: string
    line: string
  } | null>(null)
  /** The WIP a new lane of its own starts from; null for accepted work. */
  const [base, setBase] = useState<string | null>(null)
  const command = card === undefined ? null : cardCommand(card)
  const plan = planSend({
    text,
    unstarted: p.unstarted,
    lane: p.lane,
    participants: p.participants,
    agents: p.agents,
    reader: p.reader,
    command,
    noModel: p.noModel,
  })
  const button = sendButton(plan, {
    uploading: shares.uploading,
    sending: state.kind === "sending",
  })
  const queue = queueWords(plan.queue)
  const [hidden, setHidden] = useState<string | null>(null)
  const [picked, setPicked] = useState(0)
  // Where the caret is while the box has focus; null while it has none.
  const [caret, setCaret] = useState<number | null>(null)
  const list =
    hidden === text
      ? null
      : completion({
          text,
          caret,
          commands: p.commands,
          participants: p.participants,
          agents: p.agents,
          reader: p.reader,
        })
  const options = list?.options ?? []
  const highlighted = options[Math.min(picked, options.length - 1)]
  const { onCreatesLane } = p
  useEffect(
    () => onCreatesLane(plan.createsLane),
    [plan.createsLane, onCreatesLane],
  )

  /**
   * Queue the card on this column's lane, from its end, releasing a held queue
   * when the plan says so. False when there is no card or no lane to queue on:
   * nothing was queued.
   */
  const queueHere = (from: TextCardId | null): boolean => {
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
    from: TextCardId | null,
  ) => {
    step({ kind: "send" })
    setConflict(null)
    if (as === "queue") {
      p.onSend()
      step({ kind: "settled", spent: queueHere(from) })
      setStatus("")
      return
    }
    const { thread, canvas, ...how } = p.how
    // A column's canvas is known once its card is on a canvas; until then
    // nothing is sent.
    if (canvas === null) {
      step({ kind: "settled", spent: false })
      return
    }
    setStatus("sending…")
    const id = p.onSend()
    const outcome = await session.send(
      message,
      columnMessageTarget(as, thread, p.at, canvas),
      {
        ...how,
        ...(id === undefined ? {} : { id }),
        ...(plan.createsLane && base !== null ? { base } : {}),
        ...(from === null ? {} : { card: from }),
      },
    )
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
  const claim = useFocusClaim()
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening
  useEffect(() => {
    if (claim({ kind: "column", key: p.how.column })) box.current?.focus()
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

  const choose = (option: CompletionOption) => {
    if (list === null) return
    write(list.start, list.end, option.insert)
    setPicked(0)
  }

  const submit = async () => {
    const message = sendable(text, prefill, shares.uploading, command)
    const now = current.current
    if (message === null || p.readOnly !== null || now.kind === "sending")
      return
    await send(message, plan.mode, shownBy(now))
  }

  const { readOnly } = p
  const frame = cardFrame(card ?? null, "composing", {
    me: session.writer,
    queueOn:
      p.lane.kind === "lane" && p.at.kind === "entry"
        ? { lane: p.lane.name, at: p.at }
        : null,
    readOnly: readOnly !== null,
    threadIn,
  })

  return (
    <CardFrame
      card={card ?? null}
      catchUps={p.catchUps}
      {...shareProps(shares)}
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
                {plan.createsLane && (
                  <StartLine
                    accepted={p.where.accepted}
                    base={base}
                    chooseBase={setBase}
                    forkConflicts={p.where.forkConflicts}
                  />
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
                {button.setup && (
                  <a className="composer-setup" href="#setup">
                    {SEE_SETUP}
                  </a>
                )}
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
      {options.length > 0 && p.readOnly === null && (
        <div className="command-menu" role="listbox">
          {options.map(o => (
            <div
              aria-selected={o === highlighted}
              className={o === highlighted ? "command highlighted" : "command"}
              data-option={o.key}
              key={o.key}
              onMouseDown={e => {
                // Before the input loses focus.
                e.preventDefault()
                choose(o)
              }}
              role="option"
              // Focus stays in the input; the keys there move the choice.
              tabIndex={-1}
            >
              <span className="command-name">{o.label}</span>
              {o.hint !== null && (
                <span className="command-hint"> {o.hint}</span>
              )}
              {o.kind !== null && (
                <span className="command-kind"> · {o.kind}</span>
              )}
              {o.description !== "" && (
                <span className="command-description"> {o.description}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {/* Enter sends; Shift+Enter is a new line. It grows with what is
          typed, up to a limit, then scrolls. Uncontrolled: while bound, the card's binding owns its
          value. */}
      <textarea
        autoComplete="off"
        className="input"
        data-card={card?.id}
        defaultValue={text}
        onBlur={() => setCaret(null)}
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
          setCaret(e.currentTarget.selectionStart)
          setPicked(0)
          if (free(current.current) && p.place !== undefined)
            step({ kind: "input", text: value, card: newCardId() })
          p.onTyping(shownBy(current.current))
        }}
        onSelect={e => {
          const at = e.currentTarget.selectionStart
          if (at !== caret) setPicked(0)
          setCaret(at)
        }}
        onPaste={e => sharePasted(e, shares.share)}
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
          // While commands or mentions are offered, the keys move through them.
          if (highlighted !== undefined) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              const by = e.key === "ArrowDown" ? 1 : -1
              setPicked((picked + by + options.length) % options.length)
              return
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault()
              choose(highlighted)
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
    </CardFrame>
  )
}

/**
 * A card that exists, bound whole, in its frame: a queued or pinned card,
 * and your inventory's selected card.
 */
export function BoundCardEditor(p: {
  session: SessionClient
  card: TextCard
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
   * A queued or pinned card's list as drawn, which Alt+↑/↓ in its box move it
   * in; null for a card with no place in line.
   */
  among: readonly CardRecord[] | null
  /** A move from its ⋯, a ↑ or ↓, or a key in its box; absent where it has none. */
  onAct?: (act: ColumnAct) => void
  /** Discards the card: its bin and Ctrl+Shift+Backspace. */
  onDiscard: () => void
  /** Given, the card is open on your inventory's bench: its × closes it. */
  onClose?: () => void
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
  const claim = useFocusClaim()
  // A card a plan armed (a new comment, "+ add to queue", a new note handed
  // to its list) takes focus here, after its text is bound: claimed before,
  // the caret would land at the end of an empty box.
  useEffect(() => {
    const el = box.current
    if (el === null) return undefined
    const unbind = bindText(session, card.id, el, told)
    if (claim({ kind: "card", card: card.id })) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    return unbind
  }, [session, card.id, told, claim])
  const shares = useShareFiles(
    p.readOnly ? null : { box, session, boundTo: () => card.id },
  )
  // A read-only box moves nothing (`cardFrame`).
  const among = view.tools.length === 0 ? null : p.among
  const onAct = p.onAct ?? (() => {})
  return (
    <CardFrame
      {...shareProps(shares)}
      card={card}
      catchUps={p.catchUps}
      foot={p.foot}
      onAct={onAct}
      onClearCommand={null}
      onDiscard={p.onDiscard}
      onClose={p.onClose}
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
        // A queued command with no words folds its box away at rest.
        data-empty={text === "" ? true : undefined}
        onInput={() => p.onTyping(card.id)}
        onPaste={e => sharePasted(e, shares.share)}
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

/** A paste that brings files shares them instead (`eventPastedFiles`). */
function sharePasted(
  e: ClipboardEvent<HTMLTextAreaElement>,
  share: ((files: readonly File[]) => void) | null,
): void {
  const files = eventPastedFiles(e)
  if (files.length === 0 || share === null) return
  e.preventDefault()
  share(files)
}

/** A card frame's share prop, from its box's shares: none for a read-only box. */
const shareProps = (shares: ReturnType<typeof useShareFiles>) =>
  shares.share === null
    ? {}
    : { share: { onFiles: shares.share, status: shares.status } }

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
 * A note in a note column: its text, which anyone in the canvas may edit, and
 * whose it is, with ↑ and ↓ that move it in its column (as Alt+↑/↓ in its box
 * do). It has no send: Enter is a new line, and its ⋯ takes it into your
 * inventory or makes it a thread; a drag takes it anywhere else.
 */
export function NoteCardEditor(p: {
  session: SessionClient
  card: TextCard
  /** Its note column's notes as drawn: what a reorder moves it among. */
  among: readonly CardRecord[]
  reader: Reader
  readOnly: ReadOnly | null
  /** What a command catches up with; null in a note column, at no thread. */
  catchUps: CatchUps | null
  seats: readonly SeatRecord[]
  onAct: (act: ColumnAct) => void
  onTyping: (card: CardId) => void
}) {
  const { card } = p
  const view = cardFrame(card, "note", {
    me: p.session.writer,
    among: p.among,
    readOnly: p.readOnly !== null,
    threadIn: useThreadStates(),
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
      seats={p.seats}
      session={p.session}
      view={view}
    />
  )
}

/**
 * The box at a list's end where a new card is written: a note column's, and
 * the one "+ pin" opens. Until it holds something worth keeping it is local;
 * the input that makes it worth keeping makes the card, with that text, at
 * the list's end, and binds this same element to it (`useCardBox`). It holds
 * the card until focus leaves it, its list leaving that card out meanwhile
 * (`onShows`), then empties. Enter is a new line and Escape leaves; its
 * other keys are `newCardKeys`'.
 */
export function NewCardBox(p: {
  session: SessionClient
  /** The list its card is made at the end of. */
  to: ListKey
  /**
   * Its list's cards, its own among them once drawn: what Alt+↑/↓ move it
   * among, and where it finds it gone.
   */
  among: readonly CardRecord[]
  reader: Reader
  /** It takes focus as it mounts: a box opened only to be typed in. */
  focusOnMount: boolean
  onAct: (act: ColumnAct) => void
  onTyping: (card: CardId) => void
  /** Told the card it shows, or null, each time that changes. */
  onShows: (card: TextCardId | null) => void
  /** Focus left it, once it let its card go. */
  onLeave?: () => void
}) {
  const { session } = p
  const view = newCardBox(p.to)
  const { box, state, current, text, setText, boundTo, step } = useCardBox({
    session,
    start: undefined,
    startText: "",
    prefill: undefined,
    found: now => {
      const shown = shownBy(now)
      return shown !== null && p.among.some(c => c.id === shown)
        ? shown
        : undefined
    },
    readOnly: false,
    make: (card, text) => {
      p.onAct({ kind: "newCard", card, to: p.to, text })
      return true
    },
  })
  const shares = useShareFiles({ box, session, boundTo })
  const shown = shownBy(state)
  const { onShows } = p
  useEffect(() => onShows(shown), [shown, onShows])
  // Unmounted (its column made read-only, or the pin box closed), it lets
  // its card go to the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on unmounting
  useEffect(() => () => onShows(null), [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on opening
  useEffect(() => {
    if (p.focusOnMount) box.current?.focus()
  }, [])
  return (
    <div className="new-card">
      <CardFrame
        {...shareProps(shares)}
        card={null}
        catchUps={null}
        foot={null}
        onAct={p.onAct}
        onClearCommand={null}
        onDiscard={() => {}}
        reader={p.reader}
        view={cardFrame(null, view.tone, {
          me: session.writer,
          readOnly: false,
        })}
      >
        <textarea
          autoComplete="off"
          className="input"
          data-card={shown ?? undefined}
          onBlur={() => {
            step({ kind: "release" })
            p.onLeave?.()
          }}
          onPaste={e => sharePasted(e, shares.share)}
          onInput={e => {
            const value = e.currentTarget.value
            setText(value)
            if (free(current.current))
              step({ kind: "input", text: value, card: newCardId() })
            const now = shownBy(current.current)
            if (now !== null) p.onTyping(now)
          }}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return
            if (e.key === "Escape") {
              e.preventDefault()
              e.currentTarget.blur()
              return
            }
            const now = shownBy(current.current)
            if (now === null) return
            const keys = newCardKeys(
              keyOfBox(e),
              now,
              p.among.map(c => c.id),
            )
            if (keys.acts.length === 0) return
            e.preventDefault()
            for (const act of keys.acts) p.onAct(act)
            if (keys.release) step({ kind: "release" })
          }}
          placeholder={view.placeholder}
          ref={box}
          rows={Math.min(8, Math.max(1, text.split("\n").length))}
          title={view.title}
        />
      </CardFrame>
    </div>
  )
}

/**
 * A queued card above the line: its text, which anyone here may edit until the
 * host pops it, who queued it and its place in line, its command, and ↑ and ↓
 * that move it in line (as Alt+↑/↓ in its box do). Its other moves are its ⋯'s;
 * the queue's controls send it.
 */
export function QueuedCardEditor(p: {
  session: SessionClient
  card: QueuedText
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
 * A pinned card at the top of its column: its text, which anyone here may edit,
 * who pinned it, its size, how it stands against what the agent last read
 * (`inView`), and ↑ and ↓ that move it among the thread's pinned cards (as
 * Alt+↑/↓ in its box do). It has no send: Enter is a new line. Its other moves
 * are its ⋯'s.
 */
export function PinnedCardEditor(p: {
  session: SessionClient
  card: TextCard
  /** What the agent reads of the thread's pinned cards now (`pinnedInView`). */
  inView: Pick<PinnedView, "cards"> | null
  /** The thread's pinned cards as drawn: what a reorder moves it among. */
  among: readonly CardRecord[]
  /** Where a queue from its column puts it; null where nothing can be queued. */
  queueOn: CardFrameFacts["queueOn"]
  reader: Reader
  readOnly: ReadOnly | null
  /** What a command catches up with; null away from a thread: a canvas's pin. */
  catchUps: CatchUps | null
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
      foot={<span className="pinned-size">{sizeWords(textTokens(text))}</span>}
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
 * The line under the box that says what a new thread starts from, opening the
 * menu of bases: accepted work or a WIP. With no WIP there is no choice, and no
 * line; a fork from a conflicted commit says so.
 */
function StartLine(p: {
  accepted: AcceptedRecord | null
  base: string | null
  chooseBase: (base: string | null) => void
  forkConflicts: number
}) {
  const bases = baseChoices(p.accepted, p.base)
  if (bases.length === 0 && p.forkConflicts === 0) return null
  return (
    <div className="start-line">
      {bases.length > 0 && (
        <Menu
          className="start-menu"
          label="what the thread starts from"
          sections={[
            {
              key: "base",
              heading: "start from",
              items: bases.map(c => ({
                key: c.key,
                label: (
                  <>
                    <span className="start-name">{c.row}</span>
                    {c.detail !== null && (
                      <span className="start-detail">{c.detail}</span>
                    )}
                  </>
                ),
                className: "start-base",
                checked: c.chosen,
                title: c.title,
                data: { base: c.base ?? "" },
                onChoose: () => p.chooseBase(c.base),
              })),
            },
          ]}
          trigger={
            <>
              <span className="start-words">{startWords(p.base)}</span>
              <span className="start-caret">▾</span>
            </>
          }
          triggerClassName="start-trigger"
        />
      )}
      {p.forkConflicts > 0 && (
        <span className="start-fork-conflict">
          {forkWords(p.forkConflicts)}
        </span>
      )}
    </div>
  )
}
