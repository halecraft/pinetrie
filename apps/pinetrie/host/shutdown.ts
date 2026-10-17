// host/shutdown — the order a host stops in, as a value (`startHost`'s
// `shutdown` carries it out).

/** One step of a host's shutdown, in the order `planShutdown` returns them. */
export type ShutdownStep =
  /** No new command, seat or queued card reaches a step. */
  | "intake"
  /** The host's and the proposed changes' queues refuse new steps; your repo's upkeep not yet started is dropped, and its watch stops. */
  | "close"
  /** Every step the queues still hold finishes, and its writes reach the store. */
  | "quiet"
  /** Every harness closes, which ends running runs. */
  | "agent"
  /** Every pi session closes, after the harnesses over it: a later write is refused. */
  | "scribe"
  /** Every lane's container stops. */
  | "work"
  | "exchange"
  /** The HTTP server stops accepting; Vite, every socket and request close; then the server. */
  | "server"

/**
 * A host's shutdown, in order. The queues close before `quiet`: a step that
 * started after it would write to a closing agent and document, and lose its
 * writes. Closing the agent ends running runs, whose ends queue steps; the
 * closed queues refuse them. The scribe closes after the agent, in a step of
 * its own, so a failed agent close still closes the sessions.
 */
export const planShutdown = (): readonly ShutdownStep[] => [
  "intake",
  "close",
  "quiet",
  "agent",
  "scribe",
  "work",
  "exchange",
  "server",
]
