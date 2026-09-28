import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-agent-core"
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/pi-agent-core/harness/context"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  type LaneChannel,
  laneEnv,
  laneRunner,
  openChannel,
} from "./lane-env.ts"

// The helper as a local process, through the same channel code as a lane's
// `container exec -i`: no container needed.
const HELPER = path.join(import.meta.dirname, "lane-helper.ts")

let dir = ""
let channel: LaneChannel
const ready = () => Promise.resolve(channel)

beforeAll(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "pineta-lane-env-")))
  channel = openChannel([
    "env",
    `PINETA_LANE_DIR=${dir}`,
    process.execPath,
    HELPER,
  ])
  await channel.ready
})
afterAll(async () => {
  channel.close()
  await channel.closed
  await rm(dir, { recursive: true, force: true })
})

/** Processes whose command line holds `marker`, on this machine. */
const survivors = (marker: string): string[] => {
  try {
    return execFileSync("pgrep", ["-f", marker], { encoding: "utf8" })
      .split("\n")
      .filter(l => l.trim() !== "")
  } catch {
    return []
  }
}

type ToolResult = { content: { type: string; text?: string }[] }
const text = (r: ToolResult) => r.content.map(c => c.text ?? "").join("")

describe("laneEnv: pi's tools, answered by the helper", () => {
  test("write, read, edit and bash, with bash's output streamed", async () => {
    const env = laneEnv(dir, ready)
    const toolContext = { env, dir }
    const run = (
      tool: { execute: (...a: never[]) => Promise<unknown> },
      params: object,
      onUpdate: (u: unknown) => void = () => {},
    ) =>
      (tool.execute as (...a: unknown[]) => Promise<ToolResult>)(
        "call",
        params,
        onUpdate,
        toolContext,
        undefined,
        BACKGROUND_CONTEXT,
      )
    await run(createWriteTool(), { path: "a.txt", content: "one\ntwo\n" })
    expect(await readFile(path.join(dir, "a.txt"), "utf8")).toBe("one\ntwo\n")
    expect(text(await run(createReadTool(), { path: "a.txt" }))).toContain(
      "two",
    )
    await run(createEditTool(), {
      path: "a.txt",
      edits: [{ oldText: "two", newText: "three" }],
    })
    expect(await readFile(path.join(dir, "a.txt"), "utf8")).toBe("one\nthree\n")
    const updates: unknown[] = []
    const out = await run(
      createBashTool(),
      { command: "pwd; for i in 1 2 3; do echo line $i; sleep 0.05; done" },
      u => updates.push(u),
    )
    expect(text(out)).toContain(dir)
    expect(text(out)).toContain("line 3")
    expect(updates.length).toBeGreaterThan(2)
  })

  test("bytes cross whole", async () => {
    const env = laneEnv(dir, ready)
    const bytes = new Uint8Array([0, 255, 10, 13, 128])
    await env.writeFile("b.bin", bytes, BACKGROUND_CONTEXT)
    const read = await env.readBinaryFile("b.bin", BACKGROUND_CONTEXT)
    expect(read.ok && read.value).toEqual(bytes)
  })

  test("parallel calls are answered concurrently", async () => {
    const env = laneEnv(dir, ready)
    const started = Date.now()
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        env.exec(`sleep 0.3; echo ${i}`, undefined, BACKGROUND_CONTEXT),
      ),
    )
    expect(results.every(r => r.ok && r.value.exitCode === 0)).toBe(true)
    expect(Date.now() - started).toBeLessThan(1500)
  })

  test("an abort kills the command and its children", async () => {
    const env = laneEnv(dir, ready)
    const control = new AbortController()
    const marker = "sleep 41.37"
    const call = env.exec(
      `${marker} & ${marker}`,
      undefined,
      withAbortSignal(control.signal, BACKGROUND_CONTEXT),
    )
    await new Promise(r => setTimeout(r, 300))
    expect(survivors(marker).length).toBeGreaterThan(0)
    control.abort()
    const result = await call
    expect(result.ok ? "ran" : result.error.code).toBe("aborted")
    await new Promise(r => setTimeout(r, 200))
    expect(survivors(marker)).toEqual([])
  })

  test("a timeout kills a backgrounded grandchild", async () => {
    const env = laneEnv(dir, ready)
    const marker = "sleep 42.71"
    const result = await env.exec(
      `(${marker} &) ; ${marker}`,
      { timeout: 1 },
      BACKGROUND_CONTEXT,
    )
    expect(result.ok ? "ran" : result.error.code).toBe("timeout")
    await new Promise(r => setTimeout(r, 200))
    expect(survivors(marker)).toEqual([])
  })

  test("no call reaches the lane before its gate opens", async () => {
    let open: () => void = () => {}
    const opened = new Promise<void>(r => {
      open = r
    })
    const env = laneEnv(dir, async () => {
      await opened
      return channel
    })
    const write = env.writeFile("gated.txt", "x", BACKGROUND_CONTEXT)
    await new Promise(r => setTimeout(r, 150))
    expect(await stat(path.join(dir, "gated.txt")).catch(() => null)).toBeNull()
    open()
    await write
    expect(await readFile(path.join(dir, "gated.txt"), "utf8")).toBe("x")
  })

  test("a method whose result cannot cross is refused, not forwarded", async () => {
    const env = laneEnv(dir, ready)
    const r = await env.openTextLineReader("a.txt", BACKGROUND_CONTEXT)
    expect(r.ok ? "opened" : r.error.code).toBe("not_supported")
  })
})

describe("laneRunner: the host's own commands in the lane", () => {
  test("exit status, stdout and stderr apart, in the lane's directory", async () => {
    const { run } = laneRunner(channel)
    const r = await run(["sh", "-c", "pwd; echo warn >&2; exit 3"])
    expect(r).toEqual({
      ok: false,
      code: 3,
      stdout: `${dir}\n`,
      stderr: "warn\n",
    })
    expect((await run(["true"])).ok).toBe(true)
    expect((await run(["no-such-program-here"])).code).toBe(-1)
  })
  test("stdout as bytes", async () => {
    const { bytes } = laneRunner(channel)
    const r = await bytes(["printf", "\\000\\001\\377"])
    expect(r.stdout).toEqual(new Uint8Array([0, 1, 255]))
  })
})

test("a helper that exits fails its waiting calls, naming why", async () => {
  const broken = openChannel([process.execPath, "-e", "process.exit(3)"])
  await expect(broken.ready).rejects.toThrow("exited (code 3)")
  await expect(laneRunner(broken).run(["true"])).rejects.toThrow("exited")
})
