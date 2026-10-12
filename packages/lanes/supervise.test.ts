// The supervisor (`image/supervise.c`) itself, on Linux: the binary on the
// PATH (the lane runtime's, in a lane), else one built here with `cc`.
// Elsewhere it skips, saying why.

import { execFileSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

const SOURCE = path.join(import.meta.dirname, "image", "supervise.c")

const onPath = (program: string): string | null => {
  try {
    return execFileSync("sh", ["-c", `command -v ${program}`], {
      encoding: "utf8",
    }).trim()
  } catch {
    return null
  }
}

const scratch = await realpath(await mkdtemp(path.join(tmpdir(), "supervise-")))

/** The binary to test, or why there is none. */
function supervisor(): { bin: string } | { why: string } {
  if (process.platform !== "linux") return { why: "not on Linux" }
  if (process.arch !== "arm64") return { why: "not on aarch64" }
  const found = onPath("supervise")
  if (found !== null) return { bin: found }
  const cc = onPath("cc")
  if (cc === null) return { why: "no supervise on the PATH and no cc" }
  const bin = path.join(scratch, "supervise")
  execFileSync(cc, ["-O2", "-pthread", "-o", bin, SOURCE])
  return { bin }
}
const found = supervisor()
const bin = "bin" in found ? found.bin : ""

const root = path.join(scratch, "w")
const socketPath = path.join(scratch, "s.sock")
const lines = new Map<string, string[]>()
let server: net.Server | null = null

beforeAll(async () => {
  await mkdir(path.join(root, "shared"), { recursive: true })
  server = net.createServer(socket => {
    let id: string | null = null
    let buffer = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      buffer += chunk
      const complete = buffer.split("\n")
      buffer = complete.pop() ?? ""
      for (const line of complete) {
        if (id === null) id = line.split("\t")[1] ?? "?"
        else lines.set(id, [...(lines.get(id) ?? []), line])
      }
    })
  })
  const listening = server
  await new Promise<void>(resolve => listening.listen(socketPath, resolve))
})
afterAll(async () => {
  server?.close()
  await rm(scratch, { recursive: true, force: true })
})

let count = 0

/**
 * Run `command` under the supervisor as pi's `exec` does: in a session of
 * its own. Settles with the front's exit and the run's id.
 */
function supervise(
  command: string,
  options: { readonly socket?: string; readonly abortAfter?: number } = {},
): Promise<{ code: number | null; signal: string | null; id: string }> {
  const id = `t${count++}`
  const child = spawn(
    bin,
    [
      "--root",
      root,
      "--shared",
      path.join(root, "shared"),
      options.socket ?? socketPath,
      id,
      "--",
      "/bin/sh",
      "-c",
      command,
    ],
    { cwd: root, detached: true, stdio: "ignore" },
  )
  if (options.abortAfter !== undefined)
    setTimeout(() => {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL")
    }, options.abortAfter)
  return new Promise(resolve =>
    child.on("exit", (code, signal) => resolve({ code, signal, id })),
  )
}

/** The run's lines once it has ended: every process gone. */
async function ended(id: string, timeoutMs = 5000): Promise<string[]> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const got = lines.get(id) ?? []
    if (got.some(l => l.startsWith("end\t"))) return got
    if (Date.now() > until)
      throw new Error(`run ${id} did not end: ${got.join("\n")}`)
    await new Promise(r => setTimeout(r, 20))
  }
}

/** Each call's op and path, relative to the root. */
const calls = (got: readonly string[]) =>
  got
    .map(l => l.split("\t"))
    .filter(f => f.length === 9)
    .map(f => `${f[0]} ${path.relative(root, f[5] ?? "")}`)

describe.skipIf(!("bin" in found))(
  `the supervisor${"why" in found ? ` (skipped: ${found.why})` : ""}`,
  () => {
    test("its exit is the command's, and every write is reported", async () => {
      const run = await supervise(
        "echo a > a.txt; mkdir -p d; mv a.txt d/b; exit 3",
      )
      expect(run.code).toBe(3)
      const got = await ended(run.id)
      expect(calls(got)).toEqual(
        expect.arrayContaining(["open a.txt", "mkdir d", "rename a.txt"]),
      )
      expect(got.find(l => l.startsWith("exit\t"))?.split("\t")[2]).toBe("3")
    })

    test("a setsid daemon's write after its call returned", async () => {
      const run = await supervise(
        'setsid sh -c "sleep 0.5; echo late > late.txt" </dev/null >/dev/null 2>&1 &',
      )
      expect(run.code).toBe(0)
      expect(calls(lines.get(run.id) ?? [])).not.toContain("open late.txt")
      expect(calls(await ended(run.id))).toContain("open late.txt")
    })

    test("a static binary's writes: the supervisor itself, writing its log", async () => {
      const run = await supervise(
        `${bin} --root ${root} /nonexistent.sock inner -- /bin/sh -c true`,
      )
      expect(calls(await ended(run.id))).toContain(
        "open .pinetrie-lane/runs/inner.log",
      )
    })

    test("a command under env -i", async () => {
      const run = await supervise("env -i /bin/sh -c 'echo x > clean.txt'")
      expect(calls(await ended(run.id))).toContain("open clean.txt")
    })

    test("a write through mmap changes the stamp a release reports", async () => {
      await writeFile(path.join(root, "shared", "m.bin"), "aaaa")
      const run = await supervise(
        `python3 -c "import mmap; f=open('shared/m.bin','r+b'); m=mmap.mmap(f.fileno(),0); m[0:1]=b'b'; m.flush(); m.close(); f.close()"`,
      )
      const got = await ended(run.id)
      const opened = got.find(
        l => l.startsWith("open\t") && l.includes("m.bin"),
      )
      const released = got.findLast(
        l => l.startsWith("release\t") && l.includes("m.bin"),
      )
      expect(released).toBeDefined()
      expect(released?.split("\t")[8]).not.toBe(opened?.split("\t")[8])
    })

    test("a shell's redirection into a shared file is released, with its final stamp", async () => {
      const run = await supervise("{ echo one; echo two; } > shared/q.md")
      const got = await ended(run.id)
      const released = got.findLast(
        l => l.startsWith("release\t") && l.includes("q.md"),
      )
      expect(released?.split("\t")[8]).toMatch(/^8:\d+$/)
    })

    test("its listener survives a caller killed mid-call, and serves the rest", async () => {
      const run = await supervise(
        "(while :; do cat /dev/null shared/q.md >/dev/null; done) & p=$!; sleep 0.2; kill -9 $p; echo done > after.txt",
      )
      expect(run.code).toBe(0)
      expect(calls(await ended(run.id))).toContain("open after.txt")
    })

    test("an abort's signal to the caller's group ends the command, not a daemon it left", async () => {
      const run = await supervise(
        'setsid sh -c "sleep 0.5; echo kept > kept.txt" </dev/null >/dev/null 2>&1 & sleep 30',
        { abortAfter: 200 },
      )
      expect(run.signal).toBe("SIGKILL")
      const got = await ended(run.id)
      expect(got.find(l => l.startsWith("exit\t"))?.split("\t")[2]).toBe("137")
      expect(calls(got)).toContain("open kept.txt")
      expect(await readFile(path.join(root, "kept.txt"), "utf8")).toBe("kept\n")
    })

    test("with no socket, its lines go to the run's log", async () => {
      const run = await supervise("echo x > logged.txt", {
        socket: path.join(scratch, "none.sock"),
      })
      expect(run.code).toBe(0)
      const log = path.join(root, ".pinetrie-lane", "runs", `${run.id}.log`)
      expect(existsSync(log)).toBe(true)
      expect(await readFile(log, "utf8")).toContain(`${root}/logged.txt`)
    })
  },
)
