// pi/supervisor — the seccomp supervisor's side of a lane's
// observation (`packages/lanes/image/supervise.c`): how a command is launched
// under it, and its lines, gathered in the helper until the host's
// `RunSource` takes them (`take`).
//
// Its rules:
// - Each run's lines come on a connection of its own, which says
//   `hello <run>` first; then core's event lines (`decodeRunEvent`). The
//   shell's `exit` comes after every line of the command's own, so `exited`
//   waits for it.
// - A daemon's supervisor holds its connection for as long as the daemon
//   runs, so the socket never keeps the helper alive; once the helper is
//   gone, the supervisor writes to `<runs>/<run>.log` instead, read at each
//   take.

import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { decodeRunEvent, type RunNotice, shellWord } from "@pinetrie/core"

/**
 * The variable naming the supervisor's binary in a lane's container: set,
 * every `exec` runs under it; unset, as in tests of the helper on the host,
 * commands run bare and are no runs.
 */
export const SUPERVISE_ENV = "PINETRIE_SUPERVISE"

/** A lane's variables for the supervisor, which the runtime carries. */
export const supervisionEnv = (
  runtimeBin: string,
): Readonly<Record<string, string>> => ({
  [SUPERVISE_ENV]: `${runtimeBin}/supervise`,
})

/** How long an `exec` waits, after its shell exits, for the exit's line. */
const EXIT_WAIT_MS = 2000

/** Where and how a lane's helper runs a command under the supervisor. */
export interface Supervision {
  /** The supervisor's binary. */
  readonly supervise: string
  /** The helper's socket for the supervisor's lines. */
  readonly socket: string
  /** The lane's directory: only paths under it are reported. */
  readonly root: string
  /** Shared directories, absolute. */
  readonly shared: readonly string[]
  /** The shell pi would run the command with. */
  readonly shell: string
}

/**
 * The command pi's `exec` runs in place of `command`: its shell `exec`s the
 * supervisor, which runs `command` with the same shell. One shell word per
 * argument, so the command reaches the inner shell byte for byte.
 */
export const superviseCommand = (
  s: Supervision,
  id: string,
  command: string,
): string =>
  [
    "exec",
    s.supervise,
    "--root",
    s.root,
    ...s.shared.flatMap(d => ["--shared", d]),
    s.socket,
    id,
    "--",
    s.shell,
    "-c",
    command,
  ]
    .map(shellWord)
    .join(" ")

/** A run's supervisor's hello, or null for any other line. */
export const helloRun = (line: string): string | null => {
  const [word, run, ...rest] = line.split("\t")
  return word === "hello" &&
    run !== undefined &&
    run !== "" &&
    rest.length === 0
    ? run
    : null
}

/** A run's lines' complete events; the unfinished rest is returned. */
const linesFolded = (
  run: string,
  text: string,
  into: RunNotice[],
  exited: (run: string) => void,
): string => {
  const lines = text.split("\n")
  const rest = lines.pop() ?? ""
  for (const l of lines) {
    if (l.startsWith("exit\t")) exited(run)
    const event = decodeRunEvent(l)
    if (event !== null) into.push({ run, event })
  }
  return rest
}

export interface SupervisorObservation {
  /** What pi's `exec` runs for `command`, as run `run`. */
  launch(run: string, command: string): string
  /** Resolves once the run's shell's exit has arrived, or after a wait. */
  exited(run: string): Promise<void>
  /** Every event since the last take. */
  take(): RunNotice[]
}

/** The supervisor's side, listening on its socket; falls back to its logs. */
export async function startSupervision(input: {
  readonly supervise: string
  readonly root: string
  readonly shared: readonly string[]
  readonly shell: string
  /** Where a supervisor that lost the socket writes its lines. */
  readonly runsDir: string
}): Promise<SupervisorObservation> {
  const notices: RunNotice[] = []
  const exits = new Set<string>()
  const exitWaiters = new Map<string, () => void>()
  const exited = (run: string) => {
    exits.add(run)
    exitWaiters.get(run)?.()
  }
  const logs = new Map<string, { offset: number; rest: string }>()

  const server = net.createServer(socket => {
    let run: string | null = null
    let buffer = ""
    // Held, a daemon's connection would keep the helper from exiting when
    // the host closes the channel, and the host's stop would wait forever.
    socket.unref()
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      buffer += chunk
      if (run === null) {
        const end = buffer.indexOf("\n")
        if (end < 0) return
        run = helloRun(buffer.slice(0, end))
        if (run === null) return socket.destroy()
        buffer = buffer.slice(end + 1)
      }
      buffer = linesFolded(run, buffer, notices, exited)
    })
    // A line cut off by a supervisor that gave the socket up for its log is
    // dropped: the log has it whole.
    socket.on("close", () => {
      if (run !== null) exitWaiters.get(run)?.()
    })
    socket.on("error", () => {})
  })
  let socketPath: string | null = null
  for (const dir of ["/run/pinetrie", tmpdir()]) {
    const at = path.join(dir, `runs-${process.pid}.sock`)
    try {
      mkdirSync(dir, { recursive: true })
      rmSync(at, { force: true })
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(at, () => resolve())
      })
      server.unref()
      socketPath = at
      break
    } catch {}
  }
  const supervision: Supervision = {
    supervise: input.supervise,
    // With no socket, every line goes to the log.
    socket: socketPath ?? path.join(input.runsDir, "no-socket"),
    root: input.root,
    shared: input.shared,
    shell: input.shell,
  }

  /** Lines that supervisors wrote to their logs since the last read. */
  function readLogs() {
    let names: string[]
    try {
      names = readdirSync(input.runsDir).filter(n => n.endsWith(".log"))
    } catch {
      return
    }
    for (const name of names) {
      const run = name.slice(0, -".log".length)
      const seen = logs.get(name) ?? { offset: 0, rest: "" }
      let bytes: Buffer
      try {
        bytes = readFileSync(path.join(input.runsDir, name))
      } catch {
        continue
      }
      const fresh = bytes.subarray(seen.offset).toString("utf8")
      const rest = linesFolded(run, seen.rest + fresh, notices, exited)
      logs.set(name, { offset: bytes.length, rest })
    }
  }

  return {
    launch: (run, command) => superviseCommand(supervision, run, command),
    exited: run =>
      exits.has(run)
        ? Promise.resolve()
        : new Promise(resolve => {
            const timer = setTimeout(done, EXIT_WAIT_MS)
            function done() {
              clearTimeout(timer)
              exitWaiters.delete(run)
              resolve()
            }
            exitWaiters.set(run, done)
          }),
    take() {
      readLogs()
      const taken = notices.splice(0)
      // A log whose run has ended is read for the last time.
      for (const n of taken)
        if (n.event.kind === "end" && logs.delete(`${n.run}.log`))
          rmSync(path.join(input.runsDir, `${n.run}.log`), { force: true })
      for (const n of taken) if (n.event.kind === "end") exits.delete(n.run)
      return taken
    },
  }
}
