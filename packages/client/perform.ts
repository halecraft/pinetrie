// client/perform — carry out the effects `planIntent` decided (`intent.ts`).
// The shell: one port call per effect, and nothing decided here.

import type { Identity } from "./identity.ts"
import { afterRestore, type Effect } from "./intent.ts"
import type { LayoutAction } from "./layout.ts"
import type { SessionClient } from "./session-view.ts"

export interface AppPorts {
  readonly dispatch: (action: LayoutAction) => void
  readonly session: Pick<
    SessionClient,
    "archive" | "mark" | "note" | "discardCard" | "setName"
  >
  /** Scroll to an entry once it is drawn (`useReveal`). */
  readonly reveal: (entry: string) => void
  /** Select a root in the Archive tab. */
  readonly pickArchived: (root: string) => void
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
    case "openNote":
      void ports.session.note({ kind: "open", entry: effect.entry })
      return
    case "discardCard":
      ports.session.discardCard(effect.card)
      return
    case "reveal":
      ports.reveal(effect.entry)
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
