// host/start-terminal — a start's checklist on its way out: drawn and redrawn
// in place on a terminal, else a line per step. Both fold the same
// events into the same `Checklist`; only the drawing differs, and only the
// terminal's makes escape codes (`redrawText`).

import { errorText } from "@pinetrie/core"
import {
  type Checklist,
  checklistAfter,
  type LaneMachine,
  type StartEvent,
  type StartProgress,
  type StartStep,
  type StartTimes,
  startChecklist,
  timesAfter,
} from "./start-checklist.ts"
import {
  buildingLine,
  checklistLines,
  endedLine,
  failedLine,
} from "./startup-lines.ts"

export interface ProgressOptions {
  readonly steps: readonly StartStep[]
  readonly machine: LaneMachine
  /** What earlier starts took (`decodeStartTimes`). */
  readonly times: StartTimes
  /**
   * Called once, when the start has ended or failed, with the times to
   * keep. Synchronous: a refused start's process exits right after.
   */
  readonly save?: (times: StartTimes) => void
  /** In ms; `performance.now` unless given. */
  readonly clock?: () => number
}

/** What a progress draws with: each event folded, then shown. */
interface Shown {
  /** After `event`, given the list before and after it. */
  shown(before: Checklist, after: Checklist, event: StartEvent): void
  /** A build announced with no step running. */
  loose(line: string): void
  log(line: string): void
  /** The start is over: draw a last time and let go of the terminal. */
  done(list: Checklist): void
}

function progressOver(options: ProgressOptions, show: Shown): StartProgress {
  const clock = options.clock ?? (() => performance.now())
  let list = startChecklist(options.steps, options.times)
  let over = false
  const fold = (event: StartEvent) => {
    const before = list
    list = checklistAfter(list, event)
    show.shown(before, list, event)
  }
  const finish = () => {
    if (over) return
    over = true
    show.done(list)
    try {
      options.save?.(timesAfter(list))
    } catch {
      // Only the next start's estimates are lost.
    }
  }
  return {
    begin: step => fold({ kind: "begin", step, at: clock() }),
    building(build) {
      if (list.now?.kind === "running") fold({ kind: "building", build })
      else show.loose(buildingLine(build, null, list.times))
    },
    end() {
      fold({ kind: "end", at: clock() })
      finish()
    },
    fail(error) {
      fold({ kind: "fail", why: errorText(error) })
      finish()
    },
    log: line => show.log(line),
  }
}

/** The line form: each step's end, each build's start, and a failure, as lines of `log`. */
export function lineProgress(
  log: (line: string) => void,
  options: ProgressOptions,
): StartProgress {
  const { machine } = options
  return progressOver(options, {
    shown(before, after, event) {
      for (const e of after.ended.slice(before.ended.length))
        log(endedLine(e, machine))
      if (event.kind === "building" && after.now?.kind === "running")
        log(buildingLine(event.build, after.now.step, after.times))
      if (after.now?.kind === "failed" && before.now?.kind !== "failed")
        log(failedLine(after.now.step, after.now.why, machine))
    },
    loose: log,
    log,
    done: () => {},
  })
}

/** Erase the `height` lines drawn last, then draw `lines`, each cut to `columns`. */
export function redrawText(
  height: number,
  lines: readonly string[],
  columns: number,
): string {
  const up = height > 0 ? `\x1b[${height}F` : ""
  const cut = (l: string) =>
    columns > 1 && l.length >= columns ? l.slice(0, columns - 1) : l
  return `${up}\x1b[0J${lines.map(l => `${cut(l)}\n`).join("")}`
}

/** A stream's `write`, whichever of its overloads a caller uses. */
type Write = (chunk: string | Uint8Array, ...rest: never[]) => boolean

/** What the terminal form writes to: a terminal's stdout and stderr. */
export interface TerminalStreams {
  readonly out: Pick<NodeJS.WriteStream, "write" | "columns">
  readonly err: Pick<NodeJS.WriteStream, "write">
}

/**
 * The terminal form. While it draws, it owns both streams' `write`: anything
 * written, by anyone, erases the checklist, goes through, and the checklist
 * is drawn again below it. The checklist is drawn through the original
 * `out.write`, and each write through its own stream's original.
 */
export function terminalProgress(
  streams: TerminalStreams,
  options: ProgressOptions,
): StartProgress {
  const { out, err } = streams
  const clock = options.clock ?? (() => performance.now())
  const restore = { out: out.write, err: err.write }
  const outWrite = out.write.bind(out) as Write
  const errWrite = err.write.bind(err) as Write
  let height = 0
  let list: Checklist | null = null
  const draw = () => {
    if (list === null) return
    const lines = checklistLines(list, options.machine, clock())
    outWrite(redrawText(height, lines, out.columns ?? 0))
    height = lines.length
  }
  const through =
    (write: Write): Write =>
    (...args) => {
      outWrite(redrawText(height, [], 0))
      height = 0
      const wrote = write(...args)
      draw()
      return wrote
    }
  out.write = through(outWrite) as typeof out.write
  err.write = through(errWrite) as typeof err.write
  const tick = setInterval(draw, 1000)
  tick.unref?.()
  const log = (line: string) => {
    out.write(`${line}\n`)
  }
  const progress = progressOver(options, {
    shown(_before, after) {
      list = after
      draw()
    },
    loose: log,
    log,
    done(last) {
      clearInterval(tick)
      list = last
      draw()
      // The last drawing stays: what follows prints below it.
      height = 0
      list = null
      out.write = restore.out
      err.write = restore.err
    },
  })
  list = startChecklist(options.steps, options.times)
  draw()
  return progress
}

/** The terminal form on a TTY, else the line form over `out`. */
export function startProgress(
  streams: TerminalStreams & { readonly isTTY: boolean },
  options: ProgressOptions,
): StartProgress {
  if (streams.isTTY) return terminalProgress(streams, options)
  return lineProgress(line => {
    streams.out.write(`${line}\n`)
  }, options)
}
