// web/dock — a column's foot (ADR-0113): the queue's header, which says what
// happens next and holds the one control for it, the queued cards, "+ add to
// queue", the line, and what the column puts below it (your message, the
// notes line). CSS keeps it to a third of the column, scrolling within, its
// header in view.
//
// It reads presence (who types in which card) itself, so a keystroke anywhere
// redraws the dock, not the column (S59); which queued cards are blank is
// `App`'s, one set for every reader.

import { useSelector } from "@kyneta/react"
import type {
  AskIndex,
  CardId,
  CardRecord,
  EntryId,
  LaneView,
  Position,
  StopRecord,
  TreeIndex,
} from "@pinetrie/core"
import {
  ADD_TO_QUEUE,
  type CatchUps,
  type ColumnAct,
  type NextButton,
  type NextItem,
  nextButtonWords,
  nextItemWords,
  nextWords,
  type QueueHead,
  queueHead,
  queueHeadPlan,
  type Reader,
  type ReadOnly,
} from "@pinetrie/interface"
import { readTypingIn } from "@pinetrie/reads"
import { factLine, type QueuedCard } from "@pinetrie/rules"
import { newCardId, type SessionClient } from "@pinetrie/session"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { QueuedCardEditor } from "./card-editor.tsx"
import { Menu } from "./menu.tsx"

export function Dock(p: {
  session: SessionClient
  /** The thread's lane; null for a column whose thread has none: no queue. */
  lane: LaneView | null
  /** Its lane's queue, in the order the host pops it. */
  queued: readonly QueuedCard[]
  cards: readonly CardRecord[]
  /** The queued cards that are blank messages (`useBlankQueued`, in `App`). */
  blank: ReadonlySet<CardId>
  index: TreeIndex
  asks: AskIndex
  stops: ReadonlyMap<EntryId, StopRecord>
  /** Where "+ add to queue" makes its card: the thread's end and root. */
  queueAt: { readonly at: Position } | null
  reader: Reader
  readOnly: ReadOnly | null
  catchUps: CatchUps
  onAct: (act: ColumnAct) => void
  onTyping: (card: CardId) => void
  /** Between the line and your message: what you did here that was refused. */
  notices: ReactNode
  /** Below the line: your message, and the notes line. */
  children: ReactNode
}) {
  const { lane, queued } = p
  const typing = useSelector(p.session.presence, readTypingIn)
  const head =
    lane === null || p.readOnly !== null
      ? null
      : queueHead(lane, {
          cards: p.cards,
          typing,
          blank: p.blank,
          index: p.index,
          asks: p.asks,
          stops: p.stops,
        })
  const plan = head === null ? null : queueHeadPlan(head)
  // "+ add to queue" focuses its card's box once the card is drawn.
  const dock = useRef<HTMLDivElement>(null)
  const [focusing, setFocusing] = useState<CardId | null>(null)
  useEffect(() => {
    if (focusing === null) return
    const box = dock.current?.querySelector<HTMLTextAreaElement>(
      `textarea[data-card="${focusing}"]`,
    )
    if (box == null) return
    box.focus()
    setFocusing(null)
  })
  const mark = plan?.mark
  const addToQueue = () => {
    if (lane === null || p.queueAt === null) return
    const card = newCardId()
    setFocusing(card)
    p.onAct({
      kind: "queueNew",
      card,
      lane: lane.name,
      at: p.queueAt.at,
      command: null,
      hold: "hold-if-idle",
    })
  }
  return (
    <div
      className="dock"
      data-next={mark?.kind === "message" ? "message" : undefined}
      ref={dock}
    >
      {head !== null && plan !== null && (
        <div className="queue-head" data-next={mark?.kind}>
          <span className="next-state" data-next={head.next.kind}>
            {nextWords(head.next, p.reader)}
          </span>
          {plan.button !== null && (
            <HeadButton
              button={plan.button}
              head={head}
              onAct={p.onAct}
              session={p.session}
            />
          )}
          {plan.items.length > 0 && (
            <Menu
              className="queue-menu"
              label="queue actions"
              sections={[
                {
                  key: "queue",
                  items: plan.items.map(item => {
                    const w = nextItemWords(item)
                    return {
                      key: item,
                      className: w.className,
                      label: w.label,
                      title: w.title,
                      onChoose: () => itemAct(item, head, p.onAct, p.session),
                    }
                  }),
                },
              ]}
              trigger="⋯"
              triggerClassName="queue-menu-trigger"
            />
          )}
        </div>
      )}
      {queued.length > 0 && (
        <div className="queue-cards">
          {queued.map(c =>
            c.carries.kind === "fact" ? (
              // The host's fact, waiting for the run's end: nobody edits
              // or moves it (ADR-0080).
              <div className="queued-fact" key={c.id}>
                {factLine(c.carries.fact)}
              </div>
            ) : (
              <div
                className="queued-card"
                data-next={
                  mark?.kind === "card" && mark.card === c.id ? "" : undefined
                }
                key={c.id}
              >
                <QueuedCardEditor
                  among={queued}
                  card={c}
                  catchUps={p.catchUps}
                  held={lane?.heldBy != null}
                  onAct={p.onAct}
                  onTyping={p.onTyping}
                  readOnly={p.readOnly}
                  reader={p.reader}
                  session={p.session}
                />
              </div>
            ),
          )}
        </div>
      )}
      {head !== null && p.queueAt !== null && (
        <button
          className={ADD_TO_QUEUE.className}
          onClick={addToQueue}
          title={ADD_TO_QUEUE.title}
          type="button"
        >
          {ADD_TO_QUEUE.label}
        </button>
      )}
      {head !== null && <hr className="the-line" />}
      {p.notices}
      {p.children}
    </div>
  )
}

/** The queue header's one button: each a request or act the host decides again. */
function HeadButton(p: {
  button: NextButton
  head: QueueHead
  session: SessionClient
  onAct: (act: ColumnAct) => void
}) {
  const words = nextButtonWords(p.button, p.head)
  const { lane } = p.head
  const press = () => {
    switch (p.button) {
      case "stop":
        return void p.session.request({ kind: "stop", lane })
      case "resume":
        return void p.session.request({ kind: "carry-on", lane })
      case "send-queue":
        return p.onAct({ kind: "holdQueue", lane, held: false })
    }
  }
  return (
    <button
      className={`next-button ${words.className}`}
      onClick={press}
      title={words.title}
      type="button"
    >
      {words.label}
    </button>
  )
}

/** A ⋯ item, carried out. */
function itemAct(
  item: NextItem,
  head: QueueHead,
  onAct: (act: ColumnAct) => void,
  session: SessionClient,
): void {
  const { lane } = head
  if (item === "resume") void session.request({ kind: "carry-on", lane })
  else if (item === "unqueue-all") onAct({ kind: "unqueueAll", lane })
  else onAct({ kind: "holdQueue", lane, held: item === "hold" })
}
