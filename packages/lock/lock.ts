// lock/lock — a lock held through a child process, which Node cannot take
// itself: it has no `flock`. The child says `waiting` while another holds
// the lock and it waits, `held` once the kernel gave it the lock, and holds
// it until its stdin ends, so the lock is freed when its holder ends it,
// dies, or loses its own input.

import { spawn } from "node:child_process"
import { readFile, rm, writeFile } from "node:fs/promises"

/** Whether a hold waits for a lock another holds, or is refused at once. */
export type LockMode = "try" | "wait"

/**
 * Linux's: the shell opens the file, `flock` locks that open file, and the
 * `cat` it becomes keeps it. A missing `flock` exits 127, not 1, so it is
 * never read as a lock another holds.
 */
const LINUX_SCRIPT = `exec 9>>"$2" || exit 2
flock -n 9; r=$?
if [ "$r" = 1 ]; then
  [ "$1" = wait ] || exit 1
  echo waiting
  flock 9 || exit 2
elif [ "$r" != 0 ]; then exit "$r"; fi
echo held
exec cat`

/** macOS's own perl, with Linux's protocol. A failure exits 2: `die` would exit with errno, which may be 1. */
const PERL_SCRIPT = `open my $h, ">>", $ARGV[1] or do { print STDERR "$!\\n"; exit 2 };
$| = 1;
unless (flock($h, LOCK_EX | LOCK_NB)) {
  $!{EWOULDBLOCK} or do { print STDERR "$!\\n"; exit 2 };
  exit 1 unless $ARGV[0] eq "wait";
  print "waiting\\n";
  flock($h, LOCK_EX) or do { print STDERR "$!\\n"; exit 2 };
}
print "held\\n";
while (<STDIN>) {}`

/**
 * The child that holds `file`'s lock, by platform: it says `waiting` (only
 * when `mode` waits) and `held`, and holds the lock until its stdin ends.
 * Null on an OS with neither `flock` nor macOS's perl.
 */
export function lockCommand(
  platform: NodeJS.Platform,
  file: string,
  mode: LockMode,
): readonly string[] | null {
  switch (platform) {
    case "linux":
      return ["sh", "-c", LINUX_SCRIPT, "sh", mode, file]
    case "darwin":
      return ["/usr/bin/perl", "-MFcntl=:flock", "-e", PERL_SCRIPT, mode, file]
    default:
      return null
  }
}

declare const saidPid: unique symbol
/**
 * A pid a holder wrote into its lock's file: for words only. Nothing that
 * decides takes one, since the process may be gone and its pid reused.
 */
export type SaidPid = number & { readonly [saidPid]: true }

export interface HeldLock {
  readonly kind: "held"
  readonly file: string
  /** Ends the child, and settles once the lock is freed. */
  release(): Promise<void>
  /** Settles if the child exits unasked: the lock is gone, and its holder must stop. */
  readonly lockLost: Promise<void>
}

export interface LockFailed {
  readonly kind: "failed"
  readonly detail: string
}

export type LockAttempt =
  | HeldLock
  | { readonly kind: "held-by-another" }
  | LockFailed

export interface LockOptions {
  /** `process.platform`, or the platform the lock's file lives under. */
  readonly platform: NodeJS.Platform
  /**
   * What the lock lasts for: the caller's own input, or until it is
   * released. With an input, a process whose input ends never stays alive
   * holding the lock, which its child's open stdin would make it do. The
   * input is never read here, its data being the caller's: it ends only
   * once the caller reads it to its end, as a server's channel does.
   */
  readonly heldWhile: NodeJS.ReadableStream | "until-released"
  /** Write this process's pid into the file once held, for a waiter's words. */
  readonly writePid?: boolean
  /** Stands in for `lockCommand`, in tests. */
  readonly command?: readonly string[]
}

/**
 * What the child said, and how it ended (null while it runs): `held` once
 * it says so; `waiting` while it says only that; an exit 1 having said
 * nothing is another's lock; any other end failed.
 */
export function holdOutcome(heard: {
  readonly said: string
  readonly exit: number | null
}): LockAttempt["kind"] | "waiting" | "undecided" {
  const lines = heard.said.split("\n").slice(0, -1)
  if (lines.includes("held")) return "held"
  if (heard.exit === null)
    return lines.includes("waiting") ? "waiting" : "undecided"
  return heard.exit === 1 && heard.said === "" ? "held-by-another" : "failed"
}

/** The pid the lock's holder wrote into `file`, for words; null when there is none. */
export async function holderPid(file: string): Promise<SaidPid | null> {
  const text = await readFile(file, "utf8").catch(() => "")
  const pid = Number.parseInt(text, 10)
  return Number.isInteger(pid) && pid > 0 ? (pid as SaidPid) : null
}

/**
 * Remove the lock's file, then let the lock go. Only a holder removes one:
 * a file removed is a free lock, the next taker opening a new file beside
 * any held one.
 */
export async function removeLockFile(held: HeldLock): Promise<void> {
  await rm(held.file, { force: true })
  await held.release()
}

/** `file`'s lock now, or `held-by-another`. */
export function tryLock(
  file: string,
  options: LockOptions,
): Promise<LockAttempt> {
  return holdChild(file, "try", options, () => {})
}

/**
 * `file`'s lock, waiting for whoever holds it: `onWaiting` is called once,
 * with the pid its holder wrote, if it must wait. No timeout: a holder that
 * never lets go is named to whoever waits.
 */
export async function awaitLock(
  file: string,
  options: LockOptions & {
    readonly onWaiting: (holder: SaidPid | null) => void
  },
): Promise<HeldLock | LockFailed> {
  const attempt = await holdChild(file, "wait", options, () => {
    void holderPid(file).then(options.onWaiting)
  })
  // A waiting child never exits 1 for a held lock: it says `waiting`.
  return attempt.kind === "held-by-another"
    ? { kind: "failed", detail: "refused while waiting" }
    : attempt
}

/** `work` run holding `file`'s lock, waited for, and released after it, also when it throws. */
export async function withLock<T>(
  file: string,
  options: Omit<LockOptions, "heldWhile"> & {
    readonly onWaiting: (holder: SaidPid | null) => void
  },
  work: (held: HeldLock) => Promise<T>,
): Promise<{ readonly kind: "done"; readonly value: T } | LockFailed> {
  const held = await awaitLock(file, {
    ...options,
    heldWhile: "until-released",
  })
  if (held.kind === "failed") return held
  try {
    return { kind: "done", value: await work(held) }
  } finally {
    await held.release()
  }
}

function holdChild(
  file: string,
  mode: LockMode,
  options: LockOptions,
  onWaiting: () => void,
): Promise<LockAttempt> {
  const command = options.command ?? lockCommand(options.platform, file, mode)
  if (command === null)
    return Promise.resolve({
      kind: "failed",
      detail: `no lock can be held on ${options.platform}: it has neither flock nor macOS's perl`,
    })
  const [program = "", ...args] = command
  // A process group of its own: a terminal's Ctrl-C signals its host's
  // group, and would end the child, and the lock, while the host lives.
  const child = spawn(program, args, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  })
  let said = ""
  let errors = ""
  let asked = false
  let waited = false
  const exited = new Promise<void>(resolve => child.once("close", resolve))
  // A child gone already has no stdin to end: its pipe's EPIPE is no news.
  child.stdin.on("error", () => {})
  const end = () => {
    asked = true
    child.stdin.end()
  }
  if (options.heldWhile !== "until-released") {
    options.heldWhile.once("end", end)
    options.heldWhile.once("close", end)
  }
  const held: HeldLock = {
    kind: "held",
    file,
    release: async () => {
      end()
      await exited
    },
    lockLost: exited.then(() =>
      asked ? new Promise<void>(() => {}) : Promise.resolve(),
    ),
  }
  return new Promise<LockAttempt>(resolve => {
    let settled = false
    const settle = (exit: number | null) => {
      if (settled) return
      const kind = holdOutcome({ said, exit })
      if (kind === "undecided") return
      if (kind === "waiting") {
        if (!waited) onWaiting()
        waited = true
        return
      }
      settled = true
      if (kind === "held") {
        const written = options.writePid
          ? writeFile(file, `${process.pid}\n`).catch(() => {})
          : Promise.resolve()
        void written.then(() => resolve(held))
        return
      }
      resolve(
        kind === "held-by-another"
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
