// pi/bash-tool — pine·trie's `bash` tool, in pi's shape: pi's name,
// parameters and description, and pi's result (the output's tail, a note
// naming the full output's file when it is cut, the exit status), so the
// model meets the tool it knows. Its command runs in pine·trie's bash in the
// lane (`ToolContext.shell`), which hands back every chunk with its pipe;
// one capture (`shell-capture.ts`) makes what the model reads from them.
// Its join (`statement-join.ts`) splits the same chunks by the statement
// that wrote them, for the call's row, never for the model. pi's own `exec`
// keeps serving the other tools.

import { type Context, formatSize } from "@earendil-works/pi-agent-core"
import type { ThreadId } from "@pinetrie/core"
import type { OutputSplitRecord } from "@pinetrie/rules"
import { BASH_TOOL, type StreamEvent } from "@pinetrie/threads"
import { Type } from "typebox"
import type { ShellEnd } from "./lane-protocol.ts"
import type { ToolContext } from "./lanes.ts"
import {
  BASH_LIMITS,
  type CaptureState,
  type CaptureTruncation,
  type CaptureView,
  captureChunk,
  captureFinish,
  captureStart,
  captureView,
} from "./shell-capture.ts"
import { statementJoin } from "./statement-join.ts"
import { threadOfContext } from "./thread-context.ts"

/** pi's ceiling on a timeout: what a `setTimeout` can wait, in seconds. */
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000
/** How often a running call's output is published, at most. */
const PUBLISH_MS = 100
/** How often a running call's output is checkpointed, as pi's bash tool does. */
const CHECKPOINT_MS = 2_000
/**
 * Bytes of a call's output that cross from the lane, after which only its
 * end does: the channel's bound, a value chosen, not measured.
 */
export const OUTPUT_CAP = 8 * 1024 * 1024

/** What the model is told when a call's output is cut, and the details pi's tool gives. */
export interface BashDetails {
  readonly truncation: CaptureTruncation
  readonly fullOutputPath: string | undefined
}

/** What the model reads of a call, worded as pi's bash tool words it. */
export interface BashResult {
  /** Whether the call succeeded: a failed one is thrown, as pi's tool throws it. */
  readonly ok: boolean
  readonly text: string
  readonly details: BashDetails | undefined
}

/**
 * A call's result from its final view and how it ended, worded as pi's
 * bash tool words it: the tail, a note when it was cut, then the status of
 * a call that did not succeed.
 */
export function bashResult(
  view: CaptureView,
  end: ShellEnd,
  timeout: number | undefined,
): BashResult {
  const spill = end.kind === "failed" ? null : end.spill
  let text = view.text
  const t = view.truncation
  let details: BashDetails | undefined
  if (t.truncated) {
    const path = spill ?? undefined
    details = { truncation: t, fullOutputPath: path }
    const first = t.totalLines - t.outputLines + 1
    const last = t.totalLines
    text += t.lastLinePartial
      ? `\n\n[Showing last ${formatSize(t.outputBytes)} of line ${last} (line is ${formatSize(view.lastLineBytes ?? t.outputBytes)}). Full output: ${path}]`
      : t.truncatedBy === "lines"
        ? `\n\n[Showing lines ${first}-${last} of ${t.totalLines}. Full output: ${path}]`
        : `\n\n[Showing lines ${first}-${last} of ${t.totalLines} (${formatSize(BASH_LIMITS.maxBytes)} limit). Full output: ${path}]`
  }
  const status =
    end.kind === "timeout"
      ? `Command timed out after ${timeout} seconds`
      : end.kind === "aborted"
        ? "Command aborted"
        : end.kind === "failed"
          ? end.message
          : end.code === 0
            ? null
            : `Command exited with code ${end.code}`
  if (status !== null)
    return {
      ok: false,
      text: text ? `${text}\n\n${status}` : status,
      details,
    }
  return { ok: true, text: text || "(no output)", details }
}

/** pi's checks of a timeout, worded as pi words them. */
function checkedTimeout(timeout: number | undefined): void {
  if (timeout === undefined) return
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new Error("Invalid timeout: must be a finite number of seconds")
  if (timeout > MAX_TIMEOUT_SECONDS)
    throw new Error(
      `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`,
    )
}

/** A running call's update, as pi's bash tool sends it. */
const updateOf = (view: CaptureView) => ({
  content: [{ type: "text" as const, text: view.text }],
  details: {
    truncation: view.truncation.truncated ? view.truncation : undefined,
    fullOutputPath: undefined,
  },
})

type Update = (
  update: ReturnType<typeof updateOf> | { content: []; details: undefined },
  options?: { checkpoint: true },
) => void

/** Where a call's output by statement goes: never to the model. */
export interface StatementSinks {
  /** A statement's live output, or its call's turn to undivided. */
  readonly stream: (event: StreamEvent) => void
  /** Stores a call's verified split in its lane's root. */
  readonly store: (lane: ThreadId, record: OutputSplitRecord) => Promise<void>
}

/** pi's `bash` tool, made pine·trie's: see the module's header. */
export function bashTool(sinks: StatementSinks | null = null) {
  return {
    name: BASH_TOOL,
    label: BASH_TOOL,
    description: `Execute a bash command in the current working directory. Returns combined stdout and stderr. Output is truncated to last ${BASH_LIMITS.maxLines} lines or ${BASH_LIMITS.maxBytes / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({
          description: "Timeout in seconds (optional, no default timeout)",
        }),
      ),
    }),
    async execute(
      toolCallId: string,
      { command, timeout }: { command: string; timeout?: number },
      onUpdate: Update,
      toolContext: ToolContext,
      _invocation: unknown,
      context: Context,
    ) {
      checkedTimeout(timeout)
      onUpdate({ content: [], details: undefined })
      const run = toolContext.shell(
        command,
        { timeout: timeout ?? null, spill: BASH_LIMITS, cap: OUTPUT_CAP },
        context.abortSignal,
      )
      const lane = threadOfContext(context)
      const join =
        sinks === null || lane === undefined
          ? null
          : statementJoin(command, await run.attribution, {
              statement: (statement, text) =>
                sinks.stream({
                  kind: "tool-output",
                  lane,
                  callId: toolCallId,
                  statement,
                  text,
                }),
              undivided: () =>
                sinks.stream({
                  kind: "tool-undivided",
                  lane,
                  callId: toolCallId,
                }),
            })
      let state: CaptureState = captureStart(BASH_LIMITS)
      const publisher = published(() => captureView(state), onUpdate)
      for await (const event of run.events) {
        if (event === "over-cap") join?.overCap()
        else if ("notice" in event) join?.notice(event.notice)
        else {
          state = captureChunk(state, event)
          publisher.changed()
          join?.chunk(event.fd, event.bytes)
        }
      }
      const end = await run.end
      state = captureFinish(state)
      publisher.stop()
      const settled = await run.settled
      const record =
        join === null || settled === null
          ? null
          : join.done(toolCallId, settled)
      // A split that fails to store leaves the row its whole output.
      if (record !== null && lane !== undefined && sinks !== null)
        await sinks.store(lane, record).catch(() => {})
      const view = captureView(state)
      const result = bashResult(view, end, timeout)
      if (!result.ok) throw new Error(result.text)
      return {
        content: [{ type: "text" as const, text: result.text }],
        details: result.details,
      }
    },
  }
}

/**
 * Publishes a running call's view at most every `PUBLISH_MS`, only when it
 * changed, and marks one a checkpoint every `CHECKPOINT_MS`, as pi's bash
 * tool does, so a host that stops mid-call keeps its output so far.
 */
function published(view: () => CaptureView, onUpdate: Update) {
  let last = 0
  let lastCheckpoint = Date.now()
  let lastSent = ""
  let timer: ReturnType<typeof setTimeout> | undefined
  const publish = () => {
    timer = undefined
    last = Date.now()
    const update = updateOf(view())
    const encoded = JSON.stringify(update)
    if (encoded === lastSent) return
    lastSent = encoded
    const checkpoint = last - lastCheckpoint >= CHECKPOINT_MS
    if (checkpoint) lastCheckpoint = last
    onUpdate(update, checkpoint ? { checkpoint: true } : undefined)
  }
  return {
    changed: () => {
      if (timer !== undefined) return
      const wait = PUBLISH_MS - (Date.now() - last)
      if (wait <= 0) publish()
      else timer = setTimeout(publish, wait)
    },
    stop: () => {
      if (timer !== undefined) clearTimeout(timer)
      publish()
    },
  }
}
