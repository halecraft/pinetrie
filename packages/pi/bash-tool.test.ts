// pine·trie's `bash` tool against pi's: the same tool to the model, and the
// same result text on the same commands. A deliberate change to either
// shows here, for us to decide.

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  BACKGROUND_CONTEXT,
  createBashTool,
} from "@earendil-works/pi-agent-core"
import { withAbortSignal } from "@earendil-works/pi-agent-core/harness/context"
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import {
  type OutputEvent,
  type Settled,
  statementIndex,
  threadIdFor,
} from "@pinetrie/core"
import type { BashOutputRecord } from "@pinetrie/rules"
import { afterAll, beforeAll, expect, test } from "vitest"
import { bashResult, bashTool, callFlush } from "./bash-tool.ts"
import {
  type LaneChannel,
  laneShell,
  type ShellObservation,
} from "./lane-env.ts"
import { runShell } from "./lane-shell.ts"
import type { ToolContext } from "./lanes.ts"
import { BASH_LIMITS, captureStart, captureView } from "./shell-capture.ts"
import { threadContext } from "./thread-context.ts"

let dir = ""
let env: NodeExecutionEnv
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "bash-tool-"))
  env = new NodeExecutionEnv({ cwd: dir })
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A lane's shell, its helper's side run in this process. */
const localShell = (
  observation: ShellObservation | null = null,
  mkfifo = "mkfifo",
) =>
  laneShell(
    { bash: "bash", mkfifo },
    dir,
    async () => ({
      observation,
      channel: {
        shell: (request, signal, onUpdate) =>
          runShell(request, {
            startRun: () => "1",
            runEnv: run => ({ ...process.env, PINETRIE_RUN: run }),
            spillFile: async () => {
              const made = await env.createTempFile(
                { prefix: "pi-output-", suffix: ".log" },
                BACKGROUND_CONTEXT,
              )
              if (!made.ok) throw made.error
              return made.value
            },
            signal: signal ?? new AbortController().signal,
            update: onUpdate,
          }),
      } as Pick<LaneChannel, "shell"> as LaneChannel,
    }),
    () => () => {},
  )

test("the model meets pi's bash tool: its name, description and parameters", () => {
  const ours = bashTool()
  const pis = createBashTool()
  expect(ours.name).toBe(pis.name)
  expect(ours.label).toBe(pis.label)
  expect(ours.description).toBe(pis.description)
  expect(JSON.stringify(ours.parameters)).toBe(JSON.stringify(pis.parameters))
})

/** A command's result through a tool: its text, or its error's message. */
async function resultOf(
  tool: { readonly execute: unknown },
  toolContext: unknown,
  params: { command: string; timeout?: number },
  abortAfterMs?: number,
  lane?: ReturnType<typeof threadIdFor>,
): Promise<string> {
  const abort = new AbortController()
  if (abortAfterMs !== undefined) setTimeout(() => abort.abort(), abortAfterMs)
  const context = withAbortSignal(abort.signal, BACKGROUND_CONTEXT)
  const execute = tool.execute as unknown as (
    ...a: unknown[]
  ) => Promise<{ content: readonly { text?: string }[] }>
  try {
    const r = await execute(
      "call",
      params,
      () => {},
      toolContext,
      {},
      lane === undefined ? context : threadContext(lane, context),
    )
    return r.content.map(c => c.text ?? "").join("")
  } catch (e) {
    return `threw: ${(e as Error).message}`
  }
}

/** A spilled file's name differs run to run; its place in the text does not. */
const named = (text: string) =>
  text.replace(/Full output: \S+\]/g, "Full output: <file>]")

const CASES: readonly {
  readonly name: string
  readonly command: string
  readonly timeout?: number
  readonly abortAfterMs?: number
}[] = [
  { name: "no output", command: "true" },
  { name: "short", command: "echo hello; echo world" },
  { name: "no final newline", command: "printf 'a\\nb'" },
  { name: "long by lines", command: "seq 1 5000" },
  {
    name: "long by bytes",
    command: "head -c 200000 /dev/zero | tr '\\0' a | fold -w 100",
  },
  { name: "one long line", command: "head -c 100000 /dev/zero | tr '\\0' x" },
  {
    name: "a partial last line",
    command: "seq 1 3000; head -c 80000 /dev/zero | tr '\\0' y",
  },
  {
    name: "control bytes",
    command: "printf '\\x00\\x01\\x1b[31mred\\x7f\\r\\n'",
  },
  { name: "invalid UTF-8", command: "printf '\\xff\\xfe abc \\xc3\\x28\\n'" },
  {
    name: "a character split across writes",
    command: "printf '\\xc3'; sleep 0.1; printf '\\xa9\\n'",
  },
  { name: "stderr alone", command: "echo err >&2" },
  {
    name: "both pipes, in turn",
    command: "echo a; sleep 0.05; echo b >&2; sleep 0.05; echo c",
  },
  { name: "exit 3", command: "echo x; exit 3" },
  { name: "killed by a signal", command: "echo x; kill -9 $$" },
  { name: "timeout", command: "echo before; sleep 5", timeout: 1 },
  { name: "abort", command: "echo before; sleep 5", abortAfterMs: 300 },
  {
    name: "a background job holds the pipes",
    command: "(sleep 2; echo late) & echo now",
  },
]

test.each(CASES)("its result is pi's bash tool's: $name", async c => {
  const params = {
    command: c.command,
    ...(c.timeout === undefined ? {} : { timeout: c.timeout }),
  }
  const pis = await resultOf(createBashTool(), { env }, params, c.abortAfterMs)
  const ours = await resultOf(
    bashTool(),
    { shell: localShell() } satisfies Pick<ToolContext, "shell">,
    params,
    c.abortAfterMs,
  )
  expect(named(ours)).toBe(named(pis))
})

const cut = (totalLines: number, outputLines: number) => {
  const view = captureView(captureStart(BASH_LIMITS))
  return {
    ...view,
    text: "tail",
    truncation: {
      ...view.truncation,
      truncated: true,
      truncatedBy: "lines" as const,
      totalLines,
      outputLines,
    },
  }
}

test("bashResult: a cut view names the lines it shows and the full output's file", () => {
  expect(
    bashResult(
      cut(5000, 2000),
      { kind: "exited", code: 0, spill: "/tmp/f" },
      undefined,
    ).text,
  ).toBe("tail\n\n[Showing lines 3001-5000 of 5000. Full output: /tmp/f]")
})

test("bashResult: a timeout, an abort and an exit code are failures, worded as pi's", () => {
  const view = captureView(captureStart(BASH_LIMITS))
  expect(bashResult(view, { kind: "timeout", spill: null }, 4)).toEqual({
    ok: false,
    text: "Command timed out after 4 seconds",
    details: undefined,
  })
  expect(
    bashResult(view, { kind: "aborted", spill: null }, undefined).text,
  ).toBe("Command aborted")
  expect(
    bashResult(view, { kind: "exited", code: 2, spill: null }, undefined).text,
  ).toBe("Command exited with code 2")
  expect(
    bashResult(view, { kind: "exited", code: 0, spill: null }, undefined),
  ).toEqual({ ok: true, text: "(no output)", details: undefined })
})

test("a call the observer attributes is stored by statement, its output claimed and let go", async () => {
  const at = (n: number) => {
    const i = statementIndex(n)
    if (i === null) throw new Error(`no statement ${n}`)
    return i
  }
  const claimed: string[] = []
  const released: string[] = []
  const observation: ShellObservation = {
    attribution: { on: true },
    output: (run, onEvent) => {
      claimed.push(run)
      const events: OutputEvent[] = [
        { kind: "statement", at: 0, statement: at(1), line: 1 },
        { kind: "output", fd: "stdout", statement: at(1), bytes: 2 },
        { kind: "statement", at: 0, statement: at(2), line: 1 },
        { kind: "output", fd: "stderr", statement: at(2), bytes: 3 },
      ]
      for (const e of events) onEvent(e)
      return () => released.push(run)
    },
    settle: async () => ({}) as Settled,
  }
  const stored: BashOutputRecord[] = []
  const tool = bashTool({
    stream: () => {},
    store: async (_lane, record) => {
      stored.push(record)
    },
  })
  const text = await resultOf(
    tool,
    { shell: localShell(observation) } satisfies Pick<ToolContext, "shell">,
    { command: "echo a; echo bb >&2" },
    undefined,
    threadIdFor("lane"),
  )
  expect(text).toBe("a\nbb\n")
  expect([claimed, released]).toEqual([["1"], ["1"]])
  expect(
    stored.map(r =>
      r.verdict.kind === "split" ? r.verdict.statements.map(x => x.text) : [],
    ),
  ).toEqual([["a\n", "bb\n"]])
  expect(stored[0]?.stderr.map(r => text.slice(r.from, r.to))).toEqual(["bb\n"])
})

/** A tool that keeps every record it is asked to store. */
function storingTool() {
  const stored: BashOutputRecord[] = []
  const tool = bashTool({
    stream: () => {},
    store: async (_lane, record) => {
      stored.push(record)
    },
  })
  return { tool, stored }
}

const attributing: ShellObservation = {
  attribution: { on: true },
  output: () => () => {},
  settle: async () => ({}) as Settled,
}

test("a call whose output pipes cannot be made is stored undivided, saying so", async () => {
  const { tool, stored } = storingTool()
  await resultOf(
    tool,
    {
      shell: localShell(attributing, "/no/such/mkfifo"),
    } satisfies Pick<ToolContext, "shell">,
    { command: "echo a; echo b" },
    undefined,
    threadIdFor("lane"),
  )
  expect(stored.map(r => r.verdict)).toEqual([
    { kind: "undivided", why: "no-pipes" },
  ])
})

test("a call that never started stores no record", async () => {
  const { tool, stored } = storingTool()
  const shell: ToolContext["shell"] = () => ({
    started: new Promise(() => {}),
    attribution: Promise.resolve({ on: true }),
    events: (async function* () {})(),
    end: Promise.resolve({ kind: "aborted", spill: null }),
    settled: Promise.resolve({ kind: "not-started" }),
  })
  await resultOf(
    tool,
    { shell } satisfies Pick<ToolContext, "shell">,
    { command: "echo a; echo b" },
    undefined,
    threadIdFor("lane"),
  )
  expect(stored).toEqual([])
})

test("a call that never started has no flush to fold, and any other its own", () => {
  expect(callFlush({ kind: "not-started" })).toBe(null)
  expect(callFlush({ kind: "no-observer" })).toEqual({ kind: "no-observer" })
})

test("bashResult: a result's text begins with its view's, so the view's ranges index it", () => {
  const view = { ...captureView(captureStart(BASH_LIMITS)), text: "out\n" }
  for (const end of [
    { kind: "exited", code: 0, spill: null },
    { kind: "exited", code: 3, spill: null },
    { kind: "timeout", spill: null },
  ] as const)
    expect(bashResult(view, end, 1).text.startsWith(view.text)).toBe(true)
  expect(
    bashResult(
      cut(5000, 2000),
      { kind: "exited", code: 1, spill: "/f" },
      1,
    ).text.startsWith("tail"),
  ).toBe(true)
})
