// e2e/observer/kernel — the observer's kernel side and its loader on the
// lane VM's own kernel, in a QEMU guest: each case of the guest's `init`
// (`packages/lanehost/observer/suite/init`) is a numbered run begun in a
// lane's cgroup, as a helper's tool call is, and its events are read with
// lanehost's codec of the loader's lines, whose events are core's.

import type { CallOp, PathKind, RunEvent } from "@pinetrie/core"
import type { LoaderLine } from "@pinetrie/lanehost"
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

export const scenario: Scenario = {
  needs: guestProblem,
  async run({ check }: Checks) {
    const guest = await bootGuest(line => console.log(`  ${line}`))
    const events = eventsOf(guest.events)
    const said = (key: string, ...rest: string[]) =>
      guest.expect.find(
        e => e[0] === key && rest.every((r, i) => e[i + 1] === r),
      )
    const laneOf = (name: string): string | undefined => {
      const pid = said("lane", name)?.[2]
      const r = guest.events.find(
        l => l.kind === "registered" && String(l.pid) === pid,
      )
      return r?.kind === "registered" ? r.lane : undefined
    }
    const laneA = laneOf("a")
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
      "an exec in a cgroup no host registered begins no run",
      events.every(e => e.run !== "19") &&
        !r13.some(
          e => e.event.kind === "call" && e.event.path === "/w/r13/free.txt",
        ),
      JSON.stringify(r13),
    )
    check(
      "a tagged task's exec with another run's number stays in its run",
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
        e.event.path === "/w/remote/b.txt",
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
