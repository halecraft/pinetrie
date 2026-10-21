// web/dock — a column's foot, where you act: its head (the changes row, the
// queue's header, which says what happens next and holds the one control for
// it, and the dock's one ⋯, the changes' commands then the queue's), the
// queued cards, "+ add to queue", the line, and what the column puts below it
// (your message, the notes line). CSS keeps it to a third of the column,
// scrolling within, its head in view.
//
// It reads presence (who types in which card) itself, so a keystroke anywhere
// redraws the dock, not the column; which queued cards are blank is `App`'s,
// one set for every reader.

import { useSelector } from "@kyneta/react"
import type { Position, WriterId } from "@pinetrie/core"
import {
  ADD_TO_QUEUE,
  type ColumnAct,
  cardFrame,
  type LatestSources,
  type NextButton,
  type NextItem,
  nextButtonWords,
  nextItemWords,
  nextWords,
  type QueuedCard,
  type QueueHead,
  queuedCardsDrawn,
  queueHead,
  queueHeadPlan,
  type Reader,
  type ReadOnly,
  readTypingIn,
  type WorkStrip,
  type WorkStripButton,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import { newCardId } from "@pinetrie/session/connect"
import type {
  AskIndex,
  CardId,
  CardRecord,
  LaneView,
  TreeIndex,
} from "@pinetrie/threads"
import type { ReactNode } from "react"
import { Button } from "./button.tsx"
import { QueuedCardEditor } from "./card-editor.tsx"
import { CardFrame } from "./card-frame.tsx"
import { Menu, type MenuSection } from "./menu.tsx"
import { RENDERINGS } from "./renderings.tsx"
import { WorkStripView, workStripMenu } from "./work-strip.tsx"

/**
 * A reference queued to tell the agent, framed as a queued message is: who
 * queued it, its place in line, ↑ and ↓, its ⋯ (back to the notes, into your
 * inventory: the moves its kind may make, `cardFrame`) and ×. Its body is its
 * quote, read only.
 */
function QueuedReference(p: {
  card: Extract<QueuedCard, { kind: "reference" }>
  among: readonly CardRecord[]
  held: boolean
  me: WriterId
  reader: Reader
  readOnly: ReadOnly | null
  onAct: (act: ColumnAct) => void
}) {
  const { card } = p
  const view = cardFrame(card, "queued", {
    me: p.me,
    queueOn: null,
    among: p.among,
    held: p.held,
    pinned: null,
    readOnly: p.readOnly !== null,
  })
  return (
    <CardFrame
      card={card}
      latestSources={null}
      foot={null}
      onAct={p.onAct}
      onClearCommand={null}
      onTrash={() => p.onAct({ kind: "trash", card: card.id })}
      reader={p.reader}
      view={view}
    >
      <RENDERINGS.reference.Normal card={card} width={1} />
    </CardFrame>
  )
}

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
  /** Where "+ add to queue" makes its card: the thread's end and root. */
  queueAt: { readonly at: Position } | null
  reader: Reader
  readOnly: ReadOnly | null
  latestSources: LatestSources
  onAct: (act: ColumnAct) => void
  onTyping: (card: CardId) => void
  /** The changes row, while it has something to say or do (`DockShows`); null otherwise. */
  strip: WorkStrip | null
  /** What a press on a changes button does (`actOnProposedChanges`). */
  onStrip: (button: WorkStripButton) => void
  /** The changes' review, in the column's pane. */
  review: {
    readonly id: string
    readonly open: boolean
    readonly toggle: () => void
  }
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
        })
  const plan = head === null ? null : queueHeadPlan(head)
  const mark = plan?.mark
  const drawn = queuedCardsDrawn(queued, head?.next ?? null)
  // One ⋯ for the dock: the changes' commands, then the queue's.
  const changes = p.strip === null ? null : workStripMenu(p.strip, p.onStrip)
  const menu: readonly MenuSection[] = [
    ...(changes === null ? [] : [changes]),
    ...(head === null || plan === null || plan.items.length === 0
      ? []
      : [
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
        ]),
  ]
  const addToQueue = () => {
    if (lane === null || p.queueAt === null) return
    p.onAct({
      kind: "queue-new",
      card: newCardId(),
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
    >
      {(p.strip !== null || (head !== null && plan !== null)) && (
        <div className="dock-head">
          {p.strip !== null && (
            <WorkStripView act={p.onStrip} review={p.review} strip={p.strip} />
          )}
          {((head !== null && plan !== null) || menu.length > 0) && (
            <div className="queue-head" data-next={mark?.kind}>
              {head !== null && plan !== null && (
                <>
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
                </>
              )}
              {menu.length > 0 && (
                <Menu
                  className="dock-menu"
                  label="the changes and the queue"
                  sections={menu}
                  trigger="⋯"
                  triggerClassName="dock-menu-trigger"
                  triggerProps={{ "data-role": "dock-menu" }}
                />
              )}
            </div>
          )}
        </div>
      )}
      {drawn.length > 0 && (
        <div className="queue-cards">
          {drawn.map(c =>
            c.kind === "fact" ? (
              // The host's fact, waiting for the run's end: a dock draws its
              // cards normal (`DETAIL_ON`), and nobody edits or moves it.
              <RENDERINGS.fact.Normal card={c} key={c.id} width={1} />
            ) : c.kind === "ask" ? (
              // An ask from another thread, the host's.
              <RENDERINGS.ask.Normal card={c} key={c.id} width={1} />
            ) : (
              <div
                className="queued-card"
                data-next={
                  mark?.kind === "card" && mark.card === c.id ? "" : undefined
                }
                key={c.id}
              >
                {c.kind === "reference" ? (
                  <QueuedReference
                    among={drawn}
                    card={c}
                    held={lane?.heldBy != null}
                    me={p.session.writer}
                    onAct={p.onAct}
                    readOnly={p.readOnly}
                    reader={p.reader}
                  />
                ) : (
                  <QueuedCardEditor
                    among={drawn}
                    card={c}
                    latestSources={p.latestSources}
                    held={lane?.heldBy != null}
                    onAct={p.onAct}
                    onTyping={p.onTyping}
                    readOnly={p.readOnly}
                    reader={p.reader}
                    session={p.session}
                  />
                )}
              </div>
            ),
          )}
        </div>
      )}
      {head !== null && p.queueAt !== null && (
        <Button
          look="plain"
          className={ADD_TO_QUEUE.className}
          onClick={addToQueue}
          title={ADD_TO_QUEUE.title}
        >
          {ADD_TO_QUEUE.label}
        </Button>
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
        return p.onAct({ kind: "hold-queue", lane, held: false })
    }
  }
  return (
    <Button
      look="outline"
      className={`next-button ${words.className}`}
      onClick={press}
      title={words.title}
    >
      {words.label}
    </Button>
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
  else if (item === "unqueue-all") onAct({ kind: "unqueue-all", lane })
  else onAct({ kind: "hold-queue", lane, held: item === "hold" })
}
