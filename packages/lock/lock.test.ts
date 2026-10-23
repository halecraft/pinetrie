import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import { afterAll, describe, expect, test } from "vitest"
import { holdLock, holdOutcome, lockCommand } from "./lock.ts"

describe("holdOutcome", () => {
  test.each([
    ["held\n", null, "held"],
    ["held\n", 0, "held"],
    ["hel", null, "waiting"],
    ["", null, "waiting"],
    ["", 1, "held-by-another"],
    ["", 2, "failed"],
    ["", -1, "failed"],
    ["oops\n", 1, "failed"],
  ] as const)("%j, exit %s, is %s", (said, exit, kind) => {
    expect(holdOutcome({ said, exit })).toBe(kind)
  })
})

const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-lock-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const has = (program: string) =>
  spawnSync("sh", ["-c", `command -v ${program}`]).status === 0

/**
 * The commands to hold a lock with: the real one where it is, and macOS's
 * perl with its protocol (`held`, then exit 1 for a taken lock), so these
 * run on the Mac too.
 */
const BACKENDS: readonly (readonly [string, (file: string) => string[]])[] = [
  ...(has("flock")
    ? [["flock", (f: string) => [...lockCommand("linux", f)]] as const]
    : []),
  ...(has("perl")
    ? [
        [
          "perl",
          (f: string) => [
            "perl",
            "-MFcntl=:flock",
            "-e",
            'open my $h, ">>", $ARGV[0] or die "$!\\n"; flock($h, LOCK_EX|LOCK_NB) or exit 1; $|=1; print "held\\n"; while (<STDIN>) {}',
            f,
          ],
        ] as const,
      ]
    : []),
]

const LOCK = path.join(import.meta.dirname, "lock.ts")

/** Every holder started: a test that fails leaves none alive to hold the run open. */
const holders: ReturnType<typeof spawn>[] = []
afterAll(() => {
  for (const h of holders) h.kill("SIGKILL")
})

/** A process of its own holding `file` with `command`, until its stdin ends: it says its hold's kind. */
function holderProcess(command: readonly string[]) {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { holdLock } from ${JSON.stringify(LOCK)}
const h = await holdLock("", { platform: "linux", until: process.stdin, command: ${JSON.stringify(command)} })
console.log(h.kind)
// As a server's channel reads its input: a stream ends only for a reader.
process.stdin.resume()`,
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  )
  holders.push(child)
  const said = new Promise<string>(resolve =>
    child.stdout.once("data", d => resolve(String(d).trim())),
  )
  const exited = new Promise<void>(resolve => child.once("close", resolve))
  return { child, said, exited }
}

describe.skipIf(BACKENDS.length === 0).each(BACKENDS)(
  "holdLock, with %s",
  (_, command) => {
    let n = 0
    const fresh = () => path.join(dir, `${++n}-${process.pid}.lock`)
    const take = (file: string) =>
      holdLock(file, {
        platform: "linux",
        until: new PassThrough(),
        command: command(file),
      })

    test("a second taker of a held lock is held-by-another", async () => {
      const file = fresh()
      const first = await take(file)
      expect(first.kind).toBe("held")
      expect((await take(file)).kind).toBe("held-by-another")
      if (first.kind === "held") await first.release()
    })

    test("a lock released is taken by the next", async () => {
      const file = fresh()
      const first = await take(file)
      if (first.kind === "held") await first.release()
      const next = await take(file)
      expect(next.kind).toBe("held")
      if (next.kind === "held") await next.release()
    })

    test("a holder killed with SIGKILL frees the lock for the next", async () => {
      const file = fresh()
      const holder = holderProcess(command(file))
      expect(await holder.said).toBe("held")
      holder.child.kill("SIGKILL")
      await holder.exited
      const next = await take(file)
      expect(next.kind).toBe("held")
      if (next.kind === "held") await next.release()
    })

    test("a holder whose input ends exits, and frees the lock", async () => {
      const file = fresh()
      const holder = holderProcess(command(file))
      expect(await holder.said).toBe("held")
      holder.child.stdin.end()
      await holder.exited
      const next = await take(file)
      expect(next.kind).toBe("held")
      if (next.kind === "held") await next.release()
    })
  },
)

test("a child that ends without saying held has failed, with its words", async () => {
  const hold = await holdLock("", {
    platform: "linux",
    until: new PassThrough(),
    command: ["sh", "-c", "echo no lock here >&2; exit 3"],
  })
  expect(hold).toEqual({ kind: "failed", detail: "no lock here" })
})

test("a child that cannot start has failed", async () => {
  const hold = await holdLock("", {
    platform: "linux",
    until: new PassThrough(),
    command: ["/no/such/program"],
  })
  expect(hold.kind).toBe("failed")
})

test("a child that exits unasked after it held is the lock lost", async () => {
  const until = new PassThrough()
  const hold = await holdLock("", {
    platform: "linux",
    until,
    command: ["sh", "-c", "echo held; exit 0"],
  })
  expect(hold.kind).toBe("held")
  if (hold.kind === "held") await hold.lost
})
