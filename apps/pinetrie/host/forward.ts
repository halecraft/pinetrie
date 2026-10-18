// host/forward — a function that can be passed around before it is
// implemented. Some of the host's modules need each other: the agent needs
// the relays (its `ask` tool calls them), and the relays need the agent (they
// start its runs). One of them must be created first, so `startHost` gives it
// a forward's `call` in place of the missing function, and supplies the real
// one with `bind` once it exists.

/**
 * What happens to a call made before `bind`: `hold` keeps it and makes it
 * when `bind` is called, in order; `drop` ignores it; `refuse` throws.
 */
export type BeforeBind = "hold" | "drop" | "refuse"

export interface Forward<A extends readonly unknown[], R> {
  /** Calls the bound function; before `bind`, does what `BeforeBind` says. */
  readonly call: (...args: A) => R
  /** Supplies the real function. Only once: a second call throws. */
  bind(carry: (...args: A) => R): void
}

/**
 * A forward named `what` (used in its errors). Only a `refuse` forward
 * returns the bound function's result: a held or dropped call has no
 * result to give back when it is made, so those return nothing.
 */
export function forward<A extends readonly unknown[], R>(
  what: string,
  before: "refuse",
): Forward<A, R>
export function forward<A extends readonly unknown[]>(
  what: string,
  before: "hold" | "drop",
): Forward<A, void>
export function forward<A extends readonly unknown[], R>(
  what: string,
  before: BeforeBind,
): Forward<A, R | undefined> {
  let bound: ((...args: A) => R | undefined) | null = null
  const held: A[] = []
  return {
    call: (...args) => {
      if (bound !== null) return bound(...args)
      if (before === "refuse") throw new Error(`${what} is not made yet`)
      if (before === "hold") held.push(args)
      return undefined
    },
    bind(carry) {
      if (bound !== null) throw new Error(`${what} is bound already`)
      bound = carry
      for (const args of held.splice(0)) carry(...args)
    },
  }
}
