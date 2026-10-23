// lock/testing — a lock held by another process, for tests that need one
// to kill or to wait on.

import { type ChildProcess, spawn } from "node:child_process"
import path from "node:path"

const LOCK = path.join(import.meta.dirname, "lock.ts")

export interface ChildHoldingLock {
  readonly child: ChildProcess
  /** What its attempt was: `held`, `held-by-another` or `failed`. */
  readonly said: Promise<string>
  /** A line once it heard `SIGINT`, which it ignores. */
  readonly heardInterrupt: Promise<void>
  readonly exited: Promise<void>
}

/**
 * A Node process of its own that tries `file`'s lock, writing its pid, and
 * holds it until its stdin ends or it is killed. It ignores `SIGINT`, as a
 * host shutting down does, and runs in a process group of its own, so a
 * test may signal that group as a terminal would. The caller kills it.
 */
export function childHoldingLock(
  file: string,
  options: { readonly command?: readonly string[] } = {},
): ChildHoldingLock {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { tryLock } from ${JSON.stringify(LOCK)}
process.on("SIGINT", () => console.log("interrupt"))
const h = await tryLock(${JSON.stringify(file)}, { platform: process.platform, heldWhile: process.stdin, writePid: true${options.command === undefined ? "" : `, command: ${JSON.stringify(options.command)}`} })
console.log(h.kind)
// As a server's channel reads its input: a stream ends only for a reader.
process.stdin.resume()`,
    ],
    { stdio: ["pipe", "pipe", "inherit"], detached: true },
  )
  const lines: string[] = []
  const waiters: {
    readonly want: (line: string) => boolean
    readonly done: (line: string) => void
  }[] = []
  let buffer = ""
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (d: string) => {
    buffer += d
    const parts = buffer.split("\n")
    buffer = parts.pop() ?? ""
    for (const line of parts) {
      lines.push(line)
      for (const w of waiters) if (w.want(line)) w.done(line)
    }
  })
  const heard = (want: (line: string) => boolean) =>
    new Promise<string>(done => {
      const found = lines.find(want)
      if (found === undefined) waiters.push({ want, done })
      else done(found)
    })
  return {
    child,
    said: heard(l => l !== "interrupt"),
    heardInterrupt: heard(l => l === "interrupt").then(() => {}),
    exited: new Promise<void>(resolve => child.once("close", () => resolve())),
  }
}
