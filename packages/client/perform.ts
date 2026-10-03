// client/perform — carry out the effects `planIntent` decided (`intent.ts`).
// The shell: one port call per effect, and nothing decided here.

import type { CardId, EntryId } from "@pineta/core"
import { afterKeep } from "./card-intents.ts"
import type { Identity } from "./identity.ts"
import { afterRestore, type Effect, type Intent } from "./intent.ts"
import type { LayoutAction } from "./layout.ts"
import type { Direction } from "./move-undo.ts"
import type { SessionClient } from "./session-view.ts"

export interface AppPorts {
  readonly dispatch: (action: LayoutAction) => void
  readonly session: Pick<
    SessionClient,
    | "archive"
    | "mark"
    | "discardCard"
    | "setName"
    | "createCard"
    | "queueCard"
    | "unqueueCard"
    | "moveCard"
    | "swapSlots"
    | "dropEntry"
    | "refuse"
    | "setCommand"
    | "offer"
  >
  /** The inventory panel: opened (briefly, for a take's flight), and its selection. */
  readonly inventory: {
    readonly show: (brief: boolean) => void
    readonly select: (slot: number) => void
  }
  /** Measure a card's box before it moves, so it flies to where it lands. */
  readonly fly: (card: CardId) => void
  /** Ask, in the dialog, whether to restore `root` to undo there. */
  readonly askRestore: (root: EntryId, direction: Direction) => void
  /** Plan and carry out an intent afresh, after something it waited for. */
  readonly intent: (intent: Intent) => void
  /** Show an entry once this tab holds it (`openAt`). */
  readonly openWhenHeld: (entry: EntryId) => void
  /** Scroll to an entry once it is drawn (`useReveal`). */
  readonly reveal: (entry: string) => void
  /** Open an ask's fold (`FoldMemory`). */
  readonly openFold: (ask: string) => void
  /** Select a root in the Archive tab. */
  readonly pickArchived: (root: EntryId) => void
  /** The column keyed `key` takes focus when it mounts. */
  readonly arm: (key: string) => void
  readonly identity: {
    readonly save: (identity: Identity) => void
    readonly clear: () => void
  }
  readonly reload: () => void
}

export function perform(effects: readonly Effect[], ports: AppPorts): void {
  for (const effect of effects) performOne(effect, ports)
}

function performOne(effect: Effect, ports: AppPorts): void {
  switch (effect.kind) {
    case "layout":
      ports.dispatch(effect.action)
      return
    case "archive":
      void ports.session.archive("archive", effect.root)
      return
    case "restore":
      void ports.session
        .archive("restore", effect.root)
        .then(outcome => perform(afterRestore(outcome, effect.root), ports))
      return
    case "mark":
      void ports.session.mark(effect.root, effect.title)
      return
    case "discardCard":
      ports.session.discardCard(effect.card, effect.how)
      return
    case "createCard":
      void ports.session.createCard(effect.card, effect.text, effect.how)
      return
    case "queueCard":
      ports.session.queueCard(
        effect.card,
        { lane: effect.lane, at: effect.at },
        effect.how,
      )
      return
    case "unqueueCard":
      ports.session.unqueueCard(
        effect.card,
        { lane: effect.lane, by: effect.by },
        effect.how,
      )
      return
    case "moveCard":
      ports.fly(effect.move.card)
      void ports.session.moveCard(effect.move, effect.how)
      return
    case "swapSlots":
      ports.session.swapSlots(effect.a, effect.b, effect.step)
      return
    case "keep":
      for (const { move } of effect.moves) ports.fly(move.card)
      void Promise.all(
        effect.moves.map(m => ports.session.moveCard(m.move, m.how)),
      ).then(answers => perform(afterKeep(answers, effect.close), ports))
      return
    case "dropEntry":
      ports.session.dropEntry(effect.entry, effect.refusal)
      return
    case "refuse":
      ports.session.refuse(effect.refusal)
      return
    case "showInventory":
      ports.inventory.show(effect.brief)
      return
    case "select":
      ports.inventory.select(effect.slot)
      return
    case "askRestore":
      ports.askRestore(effect.root, effect.direction)
      return
    case "restoreThen":
      void ports.session.archive("restore", effect.root).then(outcome => {
        if (outcome.kind === "restored") ports.intent(effect.next)
      })
      return
    case "setCommand":
      ports.session.setCommand(effect.card, effect.command)
      return
    case "offer":
      void ports.session.offer(effect.lane, effect.action, effect.to)
      return
    case "openFold":
      ports.openFold(effect.ask)
      return
    case "reveal":
      ports.reveal(effect.entry)
      return
    case "openWhenHeld":
      ports.openWhenHeld(effect.entry)
      return
    case "pickArchived":
      ports.pickArchived(effect.root)
      return
    case "armFocus":
      ports.arm(effect.key)
      return
    case "setName":
      void ports.session.setName(effect.name)
      return
    case "storeIdentity":
      ports.identity.save(effect.identity)
      return
    case "forgetIdentity":
      ports.identity.clear()
      return
    case "reload":
      ports.reload()
      return
  }
}
