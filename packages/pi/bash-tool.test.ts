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
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import { afterAll, beforeAll, expect, test } from "vitest"
import { bashResult, bashTool } from "./bash-tool.ts"
import { type LaneChannel, laneShell } from "./lane-env.ts"
import { runShell } from "./lane-shell.ts"
import type { ToolContext } from "./lanes.ts"
import { BASH_LIMITS, captureStart, captureView } from "./shell-capture.ts"

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
const localShell = () =>
  laneShell(
    "bash",
    dir,
    async () =>
      ({
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
      }) as Pick<LaneChannel, "shell"> as LaneChannel,
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
): Promise<string> {
  const abort = new AbortController()
  if (abortAfterMs !== undefined) setTimeout(() => abort.abort(), abortAfterMs)
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
      {
        abortSignal: abort.signal,
      },
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
