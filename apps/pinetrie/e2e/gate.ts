// e2e/gate — a scripted tool command a scenario holds and feeds: it prints
// nothing until fed, each fed line as it comes, and ends when closed. A
// scenario runs the command through a scripted tool call, then feeds it in
// the lane with `inLaneQuiet`, so a step waits for the line it fed instead
// of for a `sleep` to pass. The scripts are built here and run there, so
// their quoting is tested without a lane (`gate.test.ts`).

import { randomUUID } from "node:crypto"

/** One command's FIFO, under `/tmp`: never in `/workspace`, where a snapshot would take it. */
export interface Gate {
  readonly fifo: string
}

/** The line that ends a gate's command; never one a scenario feeds. */
const END = "--pinetrie-gate-end--"

/** How long a feed waits for its gate's command to make the FIFO: 400 tries 50 ms apart. */
const FIFO_TRIES = 400

/** A gate of its own: two gates never share a FIFO, so none is fed a stale one. */
export const newGate = (label: string): Gate => ({
  fifo: `/tmp/pinetrie-gate-${label}-${randomUUID()}`,
})

/** `line` as one `sh` word, whatever it holds. */
const quoted = (line: string): string =>
  ["'", line.replaceAll("'", "'\\''"), "'"].join("")

/**
 * The bash command a scripted tool call runs. It holds the FIFO open for
 * reading and writing, so a feed never blocks and the read never sees an
 * end of file between feeds.
 */
export function gateCommand(gate: Gate): string {
  const f = quoted(gate.fifo)
  return `mkfifo ${f} && exec 3<>${f} && while IFS= read -r l <&3; do [ "$l" = ${quoted(END)} ] && break; printf '%s\\n' "$l"; done`
}

/**
 * The script that prints `lines` from the gate's command, once it has made
 * its FIFO. With no FIFO by its last try it fails, and writes nothing: a
 * file left at the FIFO's path would make the command's `mkfifo` fail.
 */
export function gateFeed(
  gate: Gate,
  lines: readonly string[],
  tries = FIFO_TRIES,
): string {
  const f = quoted(gate.fifo)
  return `i=0; while [ ! -p ${f} ] && [ $i -lt ${tries} ]; do sleep 0.05; i=$((i+1)); done; [ -p ${f} ] && printf '%s\\n' ${lines.map(quoted).join(" ")} > ${f}`
}

/** The script that ends the gate's command. */
export const gateClose = (gate: Gate): string => gateFeed(gate, [END])
