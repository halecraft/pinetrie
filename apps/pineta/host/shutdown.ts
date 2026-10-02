// host/shutdown — the order a host stops in, as a value (`startHost`'s
// `shutdown` carries it out).

/** One step of a host's shutdown, in the order `planShutdown` returns them. */
export type ShutdownStep =
  /** No new command, seat or queued card reaches a step. */
  | "intake"
  /** The host's and the offers' queues refuse new steps; the offers' poll stops. */
  | "close"
  /** Every step already queued finishes, and its writes reach the store. */
  | "quiet"
  | "agent"
  /** Every lane's container stops. */
  | "work"
  | "exchange"
  | "server"

/**
 * A host's shutdown, in order. The queues close before `quiet`: a step that
 * started after it would write to a closing agent and document, and lose
 * its writes (S73). Closing the agent ends running runs, whose ends queue
 * steps; the closed queues refuse them.
 */
export const planShutdown = (): readonly ShutdownStep[] => [
  "intake",
  "close",
  "quiet",
  "agent",
  "work",
  "exchange",
  "server",
]
