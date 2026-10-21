// e2e/observer/kernel — the observer's kernel side and its loader on the
// lane VM's own kernel, in a QEMU guest: each case of the guest's `init`
// (`packages/lanehost/observer/suite/init`) is a numbered run begun in a
// lane's PID namespace, as a helper's tool call is, and its events are read
// with lanehost's codec of the loader's lines, whose events are core's.
// Which candidate a registration takes, and whether it may, is the machine
// role's policy: its unit tests prove it, not this suite.

import type {
  CallOp,
  OutputEvent,
  OutputFd,
  PathKind,
  RunEvent,
} from "@pinetrie/core"
import { type LoaderLine, planAttribution } from "@pinetrie/lanehost"
import { commandStatements, FORGED_SIGNALS } from "@pinetrie/shell/fixtures"
import type { Checks } from "../checks.ts"
import type { Scenario } from "../scenario.ts"
import { bootGuest, guestProblem } from "./support.ts"

type Event = Extract<LoaderLine, { kind: "event" }>
type Call = Extract<RunEvent, { kind: "call" }>

const eventsOf = (lines: readonly LoaderLine[]): readonly Event[] =>
  lines.filter((l): l is Event => l.kind === "event")

const callsOf = (events: readonly Event[], run: string): readonly Call[] =>
  events.flatMap(e =>
    e.run === run && e.event.kind === "call" ? [e.event] : [],
  )

const hasCall = (
  calls: readonly Call[],
  op: CallOp,
  before: PathKind,
  path: string,
  target?: { readonly before: PathKind; readonly path: string },
): boolean =>
  calls.some(
    c =>
      c.op === op &&
      c.before === before &&
      c.path === path &&
      (target === undefined ||
        (c.before2 === target.before && c.path2 === target.path)),
  )

const O_CREAT = 0o100

const outputsOf = (
  lines: readonly LoaderLine[],
  run: string,
): readonly OutputEvent[] =>
  lines.flatMap(l => (l.kind === "output" && l.run === run ? [l.output] : []))

/** Each byte of a run's pipe `fd`, by the statement its output events give it, in order. */
const byteTags = (
  outputs: readonly OutputEvent[],
  fd: OutputFd,
): readonly (number | null)[] =>
  outputs.flatMap(e =>
    e.kind === "output" && e.fd === fd
      ? Array<number | null>(e.bytes).fill(e.statement)
      : [],
  )

/** A pipe's lines, each with the statements its bytes were attributed to. */
const taggedLines = (
  bytes: Buffer,
  tags: readonly (number | null)[],
): readonly {
  readonly text: string
  readonly tags: ReadonlySet<number | null>
}[] => {
  const out: { text: string; tags: Set<number | null> }[] = []
  let at = 0
  while (at < bytes.length) {
    const nl = bytes.indexOf(0x0a, at)
    const end = nl < 0 ? bytes.length : nl + 1
    out.push({
      text: bytes.subarray(at, end).toString("latin1"),
      tags: new Set(tags.slice(at, end)),
    })
    at = end
  }
  return out
}

export const scenario: Scenario = {
  needs: guestProblem,
  async run({ check }: Checks) {
    const guest = await bootGuest(line => console.log(`  ${line}`))
    const events = eventsOf(guest.events)
    const said = (key: string, ...rest: string[]) =>
      guest.expect.find(
        e => e[0] === key && rest.every((r, i) => e[i + 1] === r),
      )
    const laneOf = (token: string): string | undefined => {
      const r = guest.events.find(
        l => l.kind === "registered" && l.token === token,
      )
      return r?.kind === "registered" ? r.lane : undefined
    }
    const laneA = laneOf("a")
    const laneB = laneOf("b")
    const failed = said("loader-failed")
    const ready =
      guest.events.some(l => l.kind === "ready") && laneA !== undefined

    check(
      "the loader loads, attaches and is ready on the lane VM's kernel",
      ready,
      ready
        ? undefined
        : (failed?.slice(1).join(" ") ?? guest.console.slice(-2000)),
    )

    const r1 = callsOf(events, "1")
    check(
      "each call of a run is reported, with what was at its paths before it",
      calls1Ok(r1),
      JSON.stringify(r1.filter(c => !c.path.startsWith("/bin/"))),
    )
    check(
      "an open that finds nothing is reported, its path joined to the caller's directory",
      r1.some(
        c =>
          c.op === "open" &&
          c.before === "missing" &&
          c.path === "/w/r1/missing.txt" &&
          (c.flags & O_CREAT) === 0,
      ),
    )

    const releaseStamp = (run: string, path: string) =>
      callsOf(events, run).find(c => c.op === "release" && c.path === path)
        ?.stamp
    const stamped = (path: string) => said("stamp", path)?.[2]
    check(
      "a written file's release carries the stamp a stat reads after, through a mapping written after close too",
      releaseStamp("1", "/w/r1/final.txt") === stamped("/w/r1/final.txt") &&
        releaseStamp("7", "/w/r7/m.bin") === stamped("/w/r7/m.bin") &&
        stamped("/w/r7/m.bin") !== undefined,
      JSON.stringify({
        final: [
          releaseStamp("1", "/w/r1/final.txt"),
          stamped("/w/r1/final.txt"),
        ],
        mmap: [releaseStamp("7", "/w/r7/m.bin"), stamped("/w/r7/m.bin")],
      }),
    )

    const exitOf = (run: string) =>
      events.find(e => e.run === run && e.event.kind === "exit")?.event
    const exits = [exitOf("1"), exitOf("18")].map(e =>
      e?.kind === "exit" ? e.status : null,
    )
    check(
      "a run's exit is its command's status, 128 and the signal for one killed",
      exits[0] === 3 && exits[1] === 137,
      JSON.stringify(exits),
    )

    const r2 = events.filter(e => e.run === "2")
    const daemonAt = r2.findIndex(
      e =>
        e.event.kind === "call" &&
        e.event.op === "open" &&
        e.event.path === "/w/r2/daemon.txt",
    )
    const exitAt = r2.findIndex(e => e.event.kind === "exit")
    const endAt = r2.findIndex(e => e.event.kind === "end")
    check(
      "a daemon's write after its command returned is its run's, and the run ends after it",
      exitAt >= 0 && daemonAt > exitAt && endAt > daemonAt,
      JSON.stringify({ exitAt, daemonAt, endAt }),
    )

    const created = (run: string, prefix: string) =>
      callsOf(events, run).filter(
        c => c.op === "open" && c.path.startsWith(prefix),
      ).length
    const crossed =
      created("3", "/w/r34/p4-") +
      created("4", "/w/r34/p3-") +
      events.filter(
        e =>
          e.run !== "3" &&
          e.run !== "4" &&
          e.event.kind === "call" &&
          e.event.path.startsWith("/w/r34/"),
      ).length
    check(
      "two runs at once are each given only their own writes",
      created("3", "/w/r34/p3-") === 200 &&
        created("4", "/w/r34/p4-") === 200 &&
        crossed === 0,
      JSON.stringify({
        three: created("3", "/w/r34/p3-"),
        four: created("4", "/w/r34/p4-"),
        crossed,
      }),
    )
    check(
      "every thread's write is its run's, through env -i, a static binary, and a user and pid namespace of its own",
      created("5", "/w/r5/t") === 16 &&
        created("6", "/w/r6/t") === 2 &&
        created("11", "/w/r11/ns.txt") === 1 &&
        said("exit", "11")?.[2] === "0",
      JSON.stringify({
        five: created("5", "/w/r5/t"),
        six: created("6", "/w/r6/t"),
        eleven: created("11", "/w/r11/ns.txt"),
      }),
    )
    check(
      "io_uring's workers' calls are their run's",
      created("10", "/w/r10/u.txt") === 1 && said("exit", "10")?.[2] === "0",
      JSON.stringify({
        calls: callsOf(events, "10"),
        exit: said("exit", "10"),
      }),
    )
    const r13 = events.filter(
      e => e.event.kind === "call" && e.event.path.startsWith("/w/r13/"),
    )
    check(
      "a process in no run is reported nowhere",
      !r13.some(
        e => e.event.kind === "call" && e.event.path === "/w/r13/untagged.txt",
      ),
      JSON.stringify(r13),
    )
    check(
      "an exec in a PID namespace no host registered begins no run",
      events.every(e => e.run !== "19") &&
        !r13.some(
          e => e.event.kind === "call" && e.event.path === "/w/r13/free.txt",
        ),
      JSON.stringify(r13),
    )
    check(
      "a tagged canvas's exec with another run's number stays in its run",
      created("14", "/w/r14/n.txt") === 1 && events.every(e => e.run !== "15"),
      JSON.stringify(events.filter(e => e.run === "14" || e.run === "15")),
    )
    const moved = events.filter(
      e => e.event.kind === "call" && e.event.path === "/w/r16/m.txt",
    )
    check(
      "a run's events go to the lane it began in after its process moves to another cgroup",
      moved.length > 0 && moved.every(e => e.lane === laneA && e.run === "16"),
      JSON.stringify({ laneA, moved }),
    )
    const nested = events.filter(
      e => e.event.kind === "call" && e.event.path === "/w/r11/ns.txt",
    )
    check(
      "a run's events go to the lane it began in after its process enters a PID namespace of its own",
      nested.length > 0 && nested.every(e => e.lane === laneA),
      JSON.stringify({ laneA, nested }),
    )
    const laneOfRun = (run: string) =>
      new Set(events.filter(e => e.run === run).map(e => e.lane))
    check(
      "each lane is its first process's PID namespace, apart from a sibling's in the same cgroup",
      laneA === said("lane", "a")?.[3] &&
        laneB === said("lane", "b")?.[3] &&
        laneA !== laneB &&
        [...laneOfRun("1")].join() === laneA &&
        [...laneOfRun("21")].join() === laneB,
      JSON.stringify({
        laneA,
        laneB,
        said: [said("lane", "a"), said("lane", "b")],
        one: [...laneOfRun("1")],
        twentyOne: [...laneOfRun("21")],
      }),
    )
    const [, pinned, after, reused] = said("pin") ?? []
    check(
      "a namespace held registered keeps its number after its processes exit, and gives it up once let go",
      pinned !== undefined &&
        after !== pinned &&
        reused === pinned &&
        laneOf("p") === pinned,
      JSON.stringify({ pinned, after, reused, registered: laneOf("p") }),
    )
    const [, innerPid, innerNspid, innerNs, outerNs, rootNs] =
      said("inner") ?? []
    const found = guest.events.find(
      l =>
        l.kind === "candidate" && l.token === "n" && String(l.pid) === innerPid,
    )
    check(
      "a lookup at a lane's level finds a process below it by its pid there, with its NSpid and each parent by NS_GET_PARENT",
      found?.kind === "candidate" &&
        found.nspid.join() === innerNspid &&
        found.namespaces.join() === [innerNs, outerNs, rootNs].join() &&
        outerNs === laneA,
      JSON.stringify({ found, inner: said("inner") }),
    )
    check(
      "a lane registered below another begins its own runs, apart from its parent's",
      laneOf("n") === innerNs &&
        [...laneOfRun("23")].join() === innerNs &&
        [...laneOfRun("24")].join() === laneA &&
        created("23", "/w/r23/i.txt") === 1,
      JSON.stringify({
        registered: laneOf("n"),
        innerNs,
        inner: [...laneOfRun("23")],
        outer: [...laneOfRun("24")],
      }),
    )
    const r20 = events.filter(e => e.run === "20" && e.event.kind === "call")
    const remoteRelease = r20.find(
      e =>
        e.event.kind === "call" &&
        e.event.op === "release" &&
        e.event.path === "/w/remote/r.txt",
    )
    const remoteRead = r20.find(
      e =>
        e.event.kind === "call" &&
        e.event.op === "open" &&
        e.event.before === "file" &&
        e.event.path === "/w/remote/r.txt",
    )
    const remote = said("stamp", "/w/remote/r.txt")
    const otherLane = events.find(
      e =>
        e.run === "21" &&
        e.event.kind === "call" &&
        e.event.op === "release" &&
        e.event.path === "/w/r21-b.txt",
    )
    check(
      "a remote directory's release carries the loader's lstat, then the kernel's stamp, and its read the lstat's; another lane's carries neither",
      remoteRelease?.event.kind === "call" &&
        remoteRelease.event.stamp === remote?.[2] &&
        remoteRelease.event.raced === remote?.[2] &&
        remoteRelease.inodes?.kernel === Number(remote?.[3]) &&
        remoteRelease.inodes?.lstat === Number(remote?.[3]) &&
        remoteRead?.event.kind === "call" &&
        remoteRead.event.stamp === remote?.[2] &&
        otherLane?.event.kind === "call" &&
        otherLane.inodes === null &&
        otherLane.event.raced === null,
      JSON.stringify({ remoteRelease, remoteRead, remote, otherLane }),
    )

    const flushedAt = guest.events.findIndex(
      l => l.kind === "flushed" && l.token === "t17",
    )
    const r17 = guest.events.flatMap((l, i) =>
      l.kind === "event" && l.run === "17" ? [i] : [],
    )
    const r17opens = callsOf(events, "17").filter(
      c => c.op === "open" && c.path.startsWith("/w/r17/f"),
    ).length
    check(
      "a flush is answered after every event its lane's runs made before it",
      flushedAt >= 0 &&
        r17opens === 100 &&
        r17.every(i => i < flushedAt) &&
        events.some(e => e.run === "17" && e.event.kind === "end"),
      JSON.stringify({ flushedAt, last: r17.at(-1), r17opens }),
    )
    check(
      "an unregistered lane begins no new run",
      guest.events.some(l => l.kind === "unregistered") &&
        events.every(e => e.run !== "22"),
      JSON.stringify(events.filter(e => e.run === "22")),
    )

    const hooks = guest.events.flatMap(l => (l.kind === "hook" ? [l] : []))
    check(
      "every attribution hook attaches on the lane VM's kernel",
      planAttribution(hooks).on,
      JSON.stringify(hooks),
    )

    const pipeBytes = (run: string, fd: string) =>
      Buffer.from(said("bytes", run, fd)?.[3] ?? "", "hex")
    const out30 = outputsOf(guest.events, "30")
    const out31 = outputsOf(guest.events, "31")
    check(
      "a run's pipes are learned at its first signal, and a run that never signals has none",
      out30.some(e => e.kind === "output") && out31.length === 0,
      JSON.stringify({ thirty: out30.length, thirtyOne: out31 }),
    )
    const pipes = (["stdout", "stderr"] as const).map(fd => {
      const bytes = pipeBytes("30", fd === "stdout" ? "1" : "2")
      const tags = byteTags(out30, fd)
      const lines = taggedLines(bytes, tags)
      const wrong = lines.filter(l => {
        const token = /S(\d+)/.exec(l.text)?.[1]
        return (
          token !== undefined &&
          (l.tags.size !== 1 || !l.tags.has(Number(token)))
        )
      })
      return {
        fd,
        received: bytes.length,
        attributed: tags.length,
        lines,
        wrong,
      }
    })
    const unplaced = out30.filter(
      e =>
        (e.kind === "output" && e.statement === null) ||
        e.kind === "output-lost",
    )
    check(
      "every byte of a call's stdout and stderr is attributed to the statement that wrote it",
      pipes.every(
        p =>
          p.received > 0 && p.received === p.attributed && p.wrong.length === 0,
      ) && unplaced.length === 0,
      JSON.stringify({
        pipes: pipes.map(p => ({
          fd: p.fd,
          received: p.received,
          attributed: p.attributed,
          wrong: p.wrong.map(l => [l.text, [...l.tags]]),
        })),
        unplaced,
      }),
    )
    const spans = commandStatements()
    const signals = out30.flatMap(e => (e.kind === "statement" ? [e] : []))
    const refusals = guest.events.find(
      l => l.kind === "refusals" && l.lane === laneA && l.run === "30",
    )
    check(
      "a signal forged by a program or a nested bash is refused and counted, and each statement's own is taken once, within its lines",
      refusals?.kind === "refusals" &&
        refusals.count === FORGED_SIGNALS &&
        signals.length === spans.length &&
        signals.every((s, i) => {
          const span = spans[i]
          return (
            span !== undefined &&
            s.statement === span.statement &&
            s.line >= span.first &&
            s.line <= span.last
          )
        }),
      JSON.stringify({ refusals, signals, spans: spans.length }),
    )
    const redirections = pipes
      .flatMap(p => p.lines)
      .filter(l => l.text.includes("/nonexistent/d/"))
    check(
      "a compound command's failed redirection is tagged with its own statement",
      redirections.length === 4 &&
        redirections.every(l => {
          const token = /\/nonexistent\/d\/S(\d+)/.exec(l.text)?.[1]
          return l.tags.size === 1 && l.tags.has(Number(token))
        }),
      JSON.stringify(redirections.map(l => [l.text, [...l.tags]])),
    )
    const settledAt = guest.events.findIndex(
      l => l.kind === "flushed" && l.token === "t32",
    )
    const r32 = guest.events.flatMap((l, i) =>
      l.kind === "output" && l.run === "32" ? [i] : [],
    )
    const out32 = outputsOf(guest.events, "32")
    const bytes32 = ["1", "2"].map(fd => pipeBytes("32", fd).length)
    check(
      "output written just before a call returns is in the flush that follows it",
      settledAt >= 0 &&
        r32.length > 0 &&
        r32.every(i => i < settledAt) &&
        byteTags(out32, "stdout").length === bytes32[0] &&
        byteTags(out32, "stderr").length === bytes32[1] &&
        bytes32.every(n => n > 0),
      JSON.stringify({ settledAt, r32, out32, bytes32 }),
    )

    const oflood = eventsOf(guest.outputFlood)
    const ofOpens = callsOf(oflood, "40").filter(
      c => c.op === "open" && c.path.startsWith("/w/oflood/f"),
    ).length
    const ofLostFiles = oflood.filter(
      e => e.run === "40" && e.event.kind === "lost",
    )
    const ofLostOutput = outputsOf(guest.outputFlood, "40").filter(
      e => e.kind === "output-lost",
    )
    check(
      "an output flood past its ring loses output, counted against its run, and no file event",
      ofOpens === 50 && ofLostFiles.length === 0 && ofLostOutput.length > 0,
      JSON.stringify({ ofOpens, ofLostFiles, ofLostOutput }),
    )

    const flood = eventsOf(guest.flood)
    const n = Number(said("flood")?.[1])
    const counts = ["101", "102", "103", "104"].map(run => {
      const mine = flood.filter(e => e.run === run)
      const opens = mine.filter(
        e =>
          e.event.kind === "call" &&
          e.event.op === "open" &&
          e.event.path === "/w/flood/f",
      ).length
      const exits = mine.filter(e => e.event.kind === "exit").length
      const lost = mine.reduce(
        (sum, e) => sum + (e.event.kind === "lost" ? e.event.count : 0),
        0,
      )
      const ended = mine.some(e => e.event.kind === "end")
      return { run, opens, exits, lost, ended }
    })
    check(
      "a ring with no room counts each event it loses against its run, and every run still ends",
      n > 0 &&
        counts.some(c => c.lost > 0) &&
        counts.every(c => c.ended && c.opens + c.exits + c.lost === n + 1),
      JSON.stringify(counts),
    )
  },
}

/** Run 1's calls: each kind, with the kind of what was at its paths before. */
const calls1Ok = (calls: readonly Call[]): boolean =>
  calls.some(
    c =>
      c.op === "open" &&
      c.before === "missing" &&
      c.path === "/w/r1/a.txt" &&
      (c.flags & O_CREAT) !== 0,
  ) &&
  hasCall(calls, "mkdir", "missing", "/w/r1/d") &&
  hasCall(calls, "rename", "file", "/w/r1/a.txt", {
    before: "missing",
    path: "/w/r1/d/b",
  }) &&
  hasCall(calls, "symlink", "missing", "/w/r1/s") &&
  hasCall(calls, "link", "file", "/w/r1/d/b", {
    before: "missing",
    path: "/w/r1/hard",
  }) &&
  hasCall(calls, "unlink", "file", "/w/r1/hard") &&
  hasCall(calls, "unlink", "file", "/w/r1/d/b") &&
  hasCall(calls, "unlink", "dir", "/w/r1/d") &&
  hasCall(calls, "release", "file", "/w/r1/final.txt")
