// The helper's side of a `bash` call, run as the helper runs it, against
// real processes; and through a real helper, its run recorded for drains.

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { type LaneChannel, openChannel } from "./lane-env.ts"
import type { ShellEnd, ShellRequest, ShellUpdate } from "./lane-protocol.ts"
import { runShell } from "./lane-shell.ts"

let dir = ""
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "lane-shell-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const BIG = { maxBytes: 1 << 30, maxLines: 1 << 30 }

/** One call through `runShell`, its updates kept. */
async function shell(
  command: string,
  over: Partial<ShellRequest> = {},
  signal = new AbortController().signal,
) {
  const updates: ShellUpdate[] = []
  const started: string[] = []
  let spills = 0
  const end: ShellEnd = await runShell(
    {
      shell: { bash: "bash", mkfifo: "mkfifo" },
      command,
      cwd: dir,
      timeout: null,
      spill: BIG,
      cap: 1 << 30,
      ...over,
    },
    {
      startRun: c => {
        started.push(c)
        return "7"
      },
      runEnv: run => ({ ...process.env, PINETRIE_RUN: run }),
      spillFile: async () => {
        spills++
        return path.join(dir, `spill-${spills}.log`)
      },
      signal,
      update: u => updates.push(u),
    },
  )
  const piped = (fd: "stdout" | "stderr") =>
    Buffer.concat(
      updates.flatMap(u => ("fd" in u && u.fd === fd ? [u.bytes] : [])),
    )
  return { end, updates, started, piped }
}

test("each pipe's chunks join to exactly the bytes written to it", async () => {
  const out = Buffer.from(
    Array.from({ length: 70_000 }, (_, i) =>
      i % 97 === 0 ? 10 : (i * 37) % 256,
    ),
  )
  const err = Buffer.from(
    Array.from({ length: 30_000 }, (_, i) =>
      i % 61 === 0 ? 10 : (i * 13 + 7) % 256,
    ),
  )
  await writeFile(path.join(dir, "out.bin"), out)
  await writeFile(path.join(dir, "err.bin"), err)
  const r = await shell("cat out.bin; cat err.bin >&2")
  expect(r.end).toEqual({ kind: "exited", code: 0, spill: null })
  expect(r.piped("stdout").equals(out)).toBe(true)
  expect(r.piped("stderr").equals(err)).toBe(true)
})

test("a call's stdout and stderr are pipes", async () => {
  const r = await shell(
    "[ -p /dev/stdout ] && echo out-pipe; [ -p /dev/stderr ] && echo err-pipe >&2",
  )
  expect(r.piped("stdout").toString()).toBe("out-pipe\n")
  expect(r.piped("stderr").toString()).toBe("err-pipe\n")
})

test("where its pipes cannot be made, a call runs on sockets, its output whole", async () => {
  const r = await shell("[ -p /dev/stdout ] || echo not-a-pipe; echo err >&2", {
    shell: { bash: "bash", mkfifo: path.join(dir, "no-such-mkfifo") },
  })
  expect(r.end).toEqual({ kind: "exited", code: 0, spill: null })
  expect(r.piped("stdout").toString()).toBe("not-a-pipe\n")
  expect(r.piped("stderr").toString()).toBe("err\n")
})

test("a call leaves no descriptor of its pipes open in the helper", async () => {
  const open = async () => (await readdir("/proc/self/fd")).length
  await shell("true")
  const before = await open()
  await shell("echo out; echo err >&2")
  await shell("exit 3")
  expect(await open()).toBe(before)
})

test("the run is started once, with its command, and named first", async () => {
  const r = await shell("echo $PINETRIE_RUN")
  expect(r.started).toEqual(["echo $PINETRIE_RUN"])
  expect(r.updates[0]).toEqual({ started: "7" })
  expect(r.piped("stdout").toString()).toBe("7\n")
})

test("a background job holding the pipes does not hold the call", async () => {
  const r = await shell("(sleep 3; echo late) & echo now")
  expect(r.end).toEqual({ kind: "exited", code: 0, spill: null })
  expect(r.piped("stdout").toString()).toBe("now\n")
})

test("past the spill's limits, every byte from the start goes to its file", async () => {
  const r = await shell("seq 1 1000", {
    spill: { maxBytes: 100, maxLines: 10 },
  })
  if (r.end.kind !== "exited" || r.end.spill === null)
    throw new Error(`no spill: ${JSON.stringify(r.end)}`)
  expect(await readFile(r.end.spill, "utf8")).toBe(r.piped("stdout").toString())
})

test("a timeout and an abort each end the call, killing the shell", async () => {
  expect((await shell("echo before; sleep 5", { timeout: 0.3 })).end.kind).toBe(
    "timeout",
  )
  const abort = new AbortController()
  setTimeout(() => abort.abort(), 300)
  const aborted = await shell("echo before; sleep 5", {}, abort.signal)
  expect(aborted.end.kind).toBe("aborted")
  expect(aborted.piped("stdout").toString()).toBe("before\n")
})

test("past the cap, one over-cap and no more chunks", async () => {
  const r = await shell("head -c 5000 /dev/zero", { cap: 1000 })
  const sent = r.piped("stdout").length
  expect(sent).toBeLessThanOrEqual(1000)
  expect(r.updates.filter(u => "overCap" in u)).toHaveLength(1)
})

test("an exit code, and a signal's 128 and its number", async () => {
  expect((await shell("exit 3")).end).toEqual({
    kind: "exited",
    code: 3,
    spill: null,
  })
  expect((await shell("kill -9 $$")).end).toEqual({
    kind: "exited",
    code: 137,
    spill: null,
  })
})

test("through the helper, a bash call's run is in the next drain, with its command", async () => {
  const channel: LaneChannel = openChannel([
    "env",
    `PINETRIE_WORKSPACE_ROOT=${dir}`,
    process.execPath,
    path.join(import.meta.dirname, "lane-helper.ts"),
  ])
  try {
    await channel.ready
    const end = await channel.shell(
      {
        shell: { bash: "bash", mkfifo: "mkfifo" },
        command: "echo hi",
        cwd: dir,
        timeout: null,
        spill: BIG,
        cap: 1 << 20,
      },
      undefined,
      () => {},
    )
    expect(end.kind).toBe("exited")
    const drain = await channel.runs()
    expect(drain.launched.map(l => l.command)).toEqual(["echo hi"])
  } finally {
    channel.close()
    await channel.closed
  }
})
