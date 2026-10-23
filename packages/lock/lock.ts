// lock/lock — a lock held through a child process, which Node cannot take
// itself: it has no `flock`. The child prints `held` once the kernel gave it
// the lock, and holds it until its stdin ends, so the lock is freed when
// its holder ends it, dies, or loses its own input.

import { spawn } from "node:child_process"

/** Where the lock is taken: picks the command that holds it. */
export type LockPlatform = "linux"

/** The child that holds `file`'s lock: it prints `held` once it holds it, and holds it until its stdin ends. */
export const lockCommand = (
  platform: LockPlatform,
  file: string,
): readonly string[] => {
  switch (platform) {
    case "linux":
      return ["flock", "-n", file, "sh", "-c", "echo held; exec cat"]
  }
}

export interface Held {
  readonly kind: "held"
  /** Ends the child, and settles once the lock is freed. */
  release(): Promise<void>
  /** Settles if the child exits unasked: the lock is gone, and its holder must stop. */
  readonly lost: Promise<void>
}

export type Hold =
  | Held
  | { readonly kind: "held-by-another" }
  | { readonly kind: "failed"; readonly detail: string }

/**
 * What the child said, and how it ended (null while it runs), as a hold:
 * `held` as its first line is held; an exit 1 without it is another's lock
 * (`flock -n`'s); anything else failed.
 */
export function holdOutcome(heard: {
  readonly said: string
  readonly exit: number | null
}): Hold["kind"] | "waiting" {
  if (heard.said.split("\n")[0] === "held" && heard.said.includes("\n"))
    return "held"
  if (heard.exit === null) return "waiting"
  return heard.exit === 1 && heard.said === "" ? "held-by-another" : "failed"
}

/**
 * `file`'s lock, without waiting. Released by `release`, or when `until`
 * ends: the caller's own input, so a process whose input ends never stays
 * alive holding it (its child's open stdin would keep Node's event loop
 * running). It never reads `until`, whose data is the caller's: `until`
 * ends only once the caller reads it to its end, as a server's channel does.
 */
export function holdLock(
  file: string,
  options: {
    readonly platform: LockPlatform
    readonly until: NodeJS.ReadableStream
    /** Stands in for `lockCommand` where no `flock` is, in tests. */
    readonly command?: readonly string[]
  },
): Promise<Hold> {
  const [program = "", ...args] =
    options.command ?? lockCommand(options.platform, file)
  const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"] })
  let said = ""
  let errors = ""
  let asked = false
  const exited = new Promise<void>(resolve => child.once("close", resolve))
  // A child gone already has no stdin to end: its pipe's EPIPE is no news.
  child.stdin.on("error", () => {})
  const end = () => {
    asked = true
    child.stdin.end()
  }
  options.until.once("end", end)
  options.until.once("close", end)
  const held: Held = {
    kind: "held",
    release: async () => {
      end()
      await exited
    },
    lost: exited.then(() =>
      asked ? new Promise<void>(() => {}) : Promise.resolve(),
    ),
  }
  return new Promise<Hold>(resolve => {
    let settled = false
    const settle = (exit: number | null) => {
      if (settled) return
      const kind = holdOutcome({ said, exit })
      if (kind === "waiting") return
      settled = true
      resolve(
        kind === "held"
          ? held
          : kind === "held-by-another"
            ? { kind }
            : {
                kind,
                detail:
                  errors.trim() ||
                  `${program} exited ${exit ?? "by a signal"}${said === "" ? "" : `, saying ${JSON.stringify(said)}`}`,
              },
      )
    }
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (d: string) => {
      said += d
      settle(null)
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (d: string) => {
      errors += d
    })
    // A child that cannot start emits `error`, and may never close.
    child.once("error", error => {
      errors += error.message
      settle(-1)
    })
    child.once("close", code => settle(code))
  })
}
