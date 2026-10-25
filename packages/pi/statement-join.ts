// pi/statement-join — the shell of a `bash` call's join (`statement-output.ts`
// in `@pinetrie/rules`, the fold): it holds the bytes the observer has not yet
// attributed, moves each range the fold attributes into its statement's
// capture and drops it, and publishes each statement's view while the split
// verifies. Only bytes in flight between the lane's chunks and the
// observer's events are held.

import type {
  Attribution,
  OutputEvent,
  OutputFd,
  StatementIndex,
  TextRange,
} from "@pinetrie/core"
import {
  type Attributed,
  type BashOutputRecord,
  bashOutputRecord,
  type CallFlush,
  endedVerdict,
  type JoinEvent,
  joinStart,
  joinStep,
  joinVerdict,
  planVerdictChange,
  type Verdict,
  type VerifiedSplit,
} from "@pinetrie/rules"
import { parseStatements } from "@pinetrie/shell"
import {
  BASH_LIMITS,
  type CaptureState,
  captureChunk,
  captureFinish,
  captureStart,
  captureView,
} from "./shell-capture.ts"

/** Where a call's join sends what it shows. */
export interface JoinSinks {
  /** A statement's output so far, sent only while `split` verifies. */
  readonly statement: (
    statement: StatementIndex,
    text: string,
    split: VerifiedSplit,
  ) => void
  /** The split stopped verifying after statements were shown: close them. */
  readonly undivided: () => void
}

/** How often a statement's view is published, at most: the call's own rate. */
export const STATEMENT_PUBLISH_MS = 100

/** One running call's join. */
export interface StatementJoin {
  chunk(fd: OutputFd, bytes: Uint8Array): void
  notice(event: OutputEvent): void
  overCap(): void
  /** The shell's output is not pipes the observer reads. */
  noPipes(): void
  /**
   * The call returned, and how its flush went: the record of how its output
   * reads, with `stderr`, the whole output's. Takes nothing after.
   */
  done(
    call: string,
    flush: CallFlush,
    stderr: readonly TextRange[],
  ): BashOutputRecord
}

export function statementJoin(
  command: string,
  attribution: Attribution | null,
  sinks: JoinSinks,
  publishMs = STATEMENT_PUBLISH_MS,
): StatementJoin {
  let state = joinStart(parseStatements(command), attribution)
  let verdict: Verdict = joinVerdict(state)
  const held: Record<OutputFd, HeldBytes> = {
    stdout: heldBytes(),
    stderr: heldBytes(),
  }
  const captures = new Map<StatementIndex, CaptureState>()
  const dirty = new Set<StatementIndex>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = 0

  const publish = () => {
    timer = undefined
    last = Date.now()
    if (verdict.kind !== "split") return
    for (const statement of dirty) {
      const capture = captures.get(statement)
      if (capture !== undefined)
        sinks.statement(statement, captureView(capture).text, verdict.split)
    }
    dirty.clear()
  }
  const schedule = () => {
    if (timer !== undefined || dirty.size === 0) return
    const wait = publishMs - (Date.now() - last)
    if (wait <= 0) publish()
    else timer = setTimeout(publish, wait)
  }
  const stopPublishing = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    dirty.clear()
  }

  const place = (ranges: readonly Attributed[]) => {
    for (const r of ranges) {
      const bytes = held[r.fd].take(r.to - r.from)
      const capture = captures.get(r.statement) ?? captureStart(BASH_LIMITS)
      captures.set(r.statement, captureChunk(capture, { fd: r.fd, bytes }))
      dirty.add(r.statement)
    }
  }
  const step = (event: JoinEvent) => {
    const next = joinStep(state, event)
    state = next.state
    place(next.attributed)
    const after = joinVerdict(state)
    for (const s of planVerdictChange(verdict, after))
      if (s.kind === "close-statements") sinks.undivided()
    verdict = after
    if (verdict.kind === "undivided") {
      // Nothing of an undivided call is shown by statement again.
      stopPublishing()
      captures.clear()
      held.stdout.clear()
      held.stderr.clear()
      return
    }
    schedule()
  }

  return {
    chunk(fd, bytes) {
      if (verdict.kind === "undivided" || bytes.length === 0) return
      held[fd].push(bytes)
      step({ kind: "chunk", fd, bytes: bytes.length })
    },
    notice(event) {
      if (verdict.kind !== "undivided") step({ kind: "notice", event })
    },
    overCap() {
      step({ kind: "over-cap" })
    },
    noPipes() {
      step({ kind: "no-pipes" })
    },
    done(call, flush, stderr) {
      step({ kind: "done", flush })
      stopPublishing()
      const verdict = endedVerdict(state)
      // `done` was just folded, so the call has ended.
      if (verdict === null)
        throw new Error("a call's join ended without a verdict")
      return bashOutputRecord(
        call,
        verdict,
        statement => {
          const capture = captures.get(statement)
          const view = captureView(
            captureFinish(capture ?? captureStart(BASH_LIMITS)),
          )
          return {
            text: view.text,
            truncated: view.truncation.truncated,
            stderr: view.stderr,
          }
        },
        stderr,
        BASH_LIMITS,
      )
    },
  }
}

interface HeldBytes {
  push(bytes: Uint8Array): void
  /** The oldest `n` bytes held, which leave. */
  take(n: number): Uint8Array
  clear(): void
}

/** A pipe's bytes read but not yet attributed, oldest first. */
function heldBytes(): HeldBytes {
  let chunks: Uint8Array[] = []
  return {
    push: bytes => {
      chunks.push(bytes)
    },
    take(n) {
      const out = new Uint8Array(n)
      let filled = 0
      while (filled < n) {
        const first = chunks[0]
        // The fold hands out only bytes it was told were read.
        if (first === undefined) throw new Error("attributed bytes never held")
        const part = Math.min(first.length, n - filled)
        out.set(first.subarray(0, part), filled)
        filled += part
        if (part === first.length) chunks.shift()
        else chunks[0] = first.subarray(part)
      }
      return out
    },
    clear() {
      chunks = []
    },
  }
}
