// tui/ports — the ports a terminal holds for interface's input chain
// (`perform`). It has no layout to dispatch to and nothing that flies or
// folds in motion, so each port either notes what it was asked, does
// nothing, or, for a fold, lands it at once, as `AppPorts` allows when
// nothing moves. `satisfies AppPorts` makes a new port fail the type check
// here until a terminal says what it does with it.

import type { AppPorts } from "@pinetrie/interface"

/** A port asked something a terminal has no screen for, and what. */
export interface PortCall {
  readonly port: keyof AppPorts
  readonly with: readonly unknown[]
}

/**
 * The ports, over the session's (`given`), each other call noted with `log`.
 * Flights and focus do nothing: a terminal draws neither.
 */
export function terminalPorts(
  given: Pick<AppPorts, "session" | "attention" | "uploadBlob">,
  log: (call: PortCall) => void,
) {
  const noted =
    (port: keyof AppPorts) =>
    (...args: readonly unknown[]): void =>
      log({ port, with: args })
  const nothing = (..._args: readonly unknown[]): void => {}
  return {
    ...given,
    dispatch: noted("dispatch"),
    inventory: noted("inventory"),
    fly: nothing,
    foldColumn: (_motion, commit) => commit(),
    intent: noted("intent"),
    openWhenHeld: noted("openWhenHeld"),
    reveal: noted("reveal"),
    revealCard: noted("revealCard"),
    openFold: noted("openFold"),
    arm: nothing,
    identity: { save: noted("identity"), clear: noted("identity") },
    reload: noted("reload"),
    listWidth: nothing,
    page: noted("page"),
    search: noted("search"),
    landed: nothing,
    clipboardCell: noted("clipboardCell"),
    insertText: noted("insertText"),
  } satisfies AppPorts
}
