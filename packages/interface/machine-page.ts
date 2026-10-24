// interface/machine-page — the Machine page, decided and worded: what the
// footer's glyph opens. `machinePageView` decides what shows from the host's
// facts (`GET /machine`) and the board's archive moves; `machinePageWords`
// words it, once, for the page and the host's diagnostics alike.

import {
  agentAsk,
  assertNever,
  type EventMeasured,
  type LaneTreatment,
  type MachineCause,
  type MachineLately,
  type MachinePageFacts,
  type MachinePageLane,
  type MachinePageSampled,
  type MachineState,
  type Measured,
  PRODUCT_NAME,
  type RepairStep,
  type ServiceReading,
  type ThreadId,
  type ThreadName,
} from "@pinetrie/core"
import { CANVAS_BUSY_REASON } from "@pinetrie/rules"
import type { Prefill } from "./columns.ts"
import type { Intent } from "./intent.ts"
import {
  causeWords,
  serviceWords,
  sizeWords,
  treatmentWords,
} from "./machine.ts"
import { pageWords } from "./page.ts"
import { dropsWords } from "./sidebar-view.ts"
import type { ThreadMove } from "./thread-card.ts"

/** A thread's row: its lane's facts, and its canvas's archive where this host may archive. */
interface MachineThreadRow extends MachinePageLane {
  /** The board's move of its canvas to the archive; null where none is offered. */
  readonly archive: Pick<ThreadMove, "busy" | "drops" | "intent"> | null
}

export type MachinePageView =
  /** The host runs no lanes, and reads no machine. */
  | { readonly kind: "no-machine" }
  | {
      readonly kind: "machine"
      readonly state: MachineState
      /** Worst first: the page's Now. */
      readonly now: readonly MachineCause[]
      /** How many lanes are held for memory: what a memory-short cause's words count. */
      readonly heldForMemory: number
      /** Null before the first sample: Threads, Machine and Host say so. */
      readonly sampled: Omit<MachinePageSampled, "lanes"> | null
      /** Held first, then by name. */
      readonly threads: readonly MachineThreadRow[]
      readonly vmMemoryCeilingBytes: number | null
      readonly lately: readonly MachineLately[]
      readonly names: ReadonlyMap<ThreadId, ThreadName>
      /** Offered only where the facts carry it: this host holds the repair's controls, and it failed. */
      readonly repairAgain: { readonly why: string } | null
    }

/** The page, from the host's facts (null: no machine), and the board's archive move for each lane's canvas. */
export function machinePageView(
  facts: MachinePageFacts | null,
  archiveMove: (lane: ThreadId) => ThreadMove | null,
): MachinePageView {
  if (facts === null) return { kind: "no-machine" }
  const archives = facts.actions.some(a => a.kind === "archive")
  const repair = facts.actions.find(a => a.kind === "repair-again")
  const sampled = facts.reading.kind === "sampled" ? facts.reading : null
  const names = new Map(facts.names.map(n => [n.lane, n.name]))
  for (const l of sampled?.lanes ?? [])
    if (l.name !== null) names.set(l.lane, l.name)
  const threads = (sampled?.lanes ?? [])
    .map((l): MachineThreadRow => {
      const move = archives ? archiveMove(l.lane) : null
      return { ...l, archive: move?.closes === true ? move : null }
    })
    .sort(
      (a, b) =>
        Number(b.treatment !== "normal") - Number(a.treatment !== "normal") ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    )
  return {
    kind: "machine",
    state: facts.health.state,
    now: facts.health.causes,
    heldForMemory: facts.health.treatments.filter(
      t => t.treatment.kind !== "waiting-for-repair",
    ).length,
    sampled:
      sampled === null
        ? null
        : {
            kind: "sampled",
            memory: sampled.memory,
            store: sampled.store,
            filesystem: sampled.filesystem,
            services: sampled.services,
          },
    threads,
    vmMemoryCeilingBytes: facts.vmMemoryCeilingBytes,
    lately: facts.lately,
    names,
    repairAgain: repair === undefined ? null : { why: repair.why },
  }
}

/** A line of a section; `key` is stable across refreshes. */
export interface MachineLine {
  readonly key: string
  readonly text: string
  /** A reading that could not be taken: drawn apart, never as a 0. */
  readonly unreadable: boolean
}

/** A cause in Now: what it is, what pine·trie does, and what you can do. */
interface MachineNowLine extends MachineLine {
  readonly doing: string | null
  readonly youCan: string | null
}

export interface MachineThreadLine extends MachineLine {
  readonly lane: ThreadId
  /** Its Archive button, and what its confirmation says; null where none is offered. */
  readonly archive: {
    readonly label: string
    readonly confirm: string
    /** Why it cannot be archived now; the button is disabled. */
    readonly refused: string | null
    readonly intent: Intent
  } | null
}

interface MachineLatelyLine extends MachineLine {
  readonly at: number
}

/** Every word the Machine page draws, from its view. */
interface MachinePageText {
  readonly title: string
  /** Null where the host reads a machine. */
  readonly noMachine: string | null
  readonly sections: {
    readonly now: {
      readonly heading: string
      readonly lines: readonly MachineNowLine[]
    }
    readonly threads: {
      readonly heading: string
      readonly lines: readonly MachineThreadLine[]
      readonly empty: string
    }
    readonly machine: {
      readonly heading: string
      readonly lines: readonly MachineLine[]
    }
    readonly host: {
      readonly heading: string
      readonly lines: readonly MachineLine[]
    }
    readonly lately: {
      readonly heading: string
      readonly lines: readonly MachineLatelyLine[]
      readonly empty: string
    }
  }
  readonly repairAgain: {
    readonly label: string
    readonly confirm: string
  } | null
  readonly copy: {
    readonly label: string
    readonly copied: string
    readonly failed: string
  }
  readonly ask: { readonly label: string; readonly title: string }
  readonly confirm: string
  readonly cancel: string
}

const WAITING_FOR_READING = "waiting for its first reading"

/** A thread as people read it: its name, never its id. */
const threadWords = (name: ThreadName | null | undefined): string =>
  name ?? "a thread not named yet"

const percent = (share: number) => `${share.toFixed(1).replace(/\.0$/, "")}%`

/** What pine·trie does about a cause, or null where it does nothing more than say it. */
function causeDoingWords(cause: MachineCause): string | null {
  switch (cause.kind) {
    case "room-low":
      return cause.grows
        ? "it grows the disk when the lane VM next starts"
        : "it deletes old turns' snapshots, least recently used first"
    case "room-spent":
    case "metadata-full":
    case "freeing-room":
      return "it deletes old turns' snapshots, least recently used first"
    case "room-unrecoverable":
      return cause.isRepaired
        ? "it repairs the lane VM's disk, offline, once the disk is full"
        : null
    case "filesystem-low":
      return "it grows the lanes' disk no further"
    case "memory-short":
      return !cause.isHolding
        ? "nothing: this host only watches the machine (`lanes.manage`)"
        : cause.rung >= 3
          ? "it pauses the threads that matter least at their next tool call"
          : "it holds new runs' starts until there is room"
    case "disk-being-repaired":
      return "it holds every thread while the lane VM is stopped and its disk repaired"
    case "unsampled":
      return cause.reason === "stopped"
        ? null
        : "it reads the machine again at its next sample"
    case "disk-repair-failed":
    case "lane-oom-killed":
    case "service-oom-killed":
    case "host-stalls":
    case "snapshot-skipped":
      return null
    default:
      return assertNever(cause)
  }
}

/** What you can do about a cause, or null where nothing is yours to do. */
function causeYouCanWords(cause: MachineCause): string | null {
  switch (cause.kind) {
    case "room-low":
    case "room-spent":
    case "metadata-full":
    case "freeing-room":
    case "room-unrecoverable":
      return "archive the canvases you are done with: their snapshots are deleted; or raise `lanes.store.max`"
    case "filesystem-low":
      return "free space on the disk holding the lanes, or lower `lanes.store.leaveFree`"
    case "memory-short":
      return "archive the canvases you are done with, or stop the runs you do not need now"
    case "disk-repair-failed":
      return "raise `lanes.store.max`, or free the Mac's disk, then repair it again"
    case "lane-oom-killed":
      return "read what the command was doing in its thread, and run less of it at once"
    case "service-oom-killed":
    case "host-stalls":
      return "copy the diagnostics, or ask an agent about this"
    case "disk-being-repaired":
    case "snapshot-skipped":
    case "unsampled":
      return null
    default:
      return assertNever(cause)
  }
}

/** A reading's words, or why it was not taken. */
const measuredLine = <T>(
  key: string,
  subject: string,
  m: Measured<T>,
  words: (read: T) => string,
): MachineLine =>
  m.kind === "unreadable"
    ? { key, text: `${subject}: not read: ${m.why}`, unreadable: true }
    : { key, text: `${subject}: ${words(m)}`, unreadable: false }

const RUNG_WORDS: readonly string[] = [
  "calm",
  "tight: nothing is held yet",
  "short: new runs wait for room",
  "short: only the threads that matter most make tool calls",
]

function machineLines(
  sampled: NonNullable<
    Extract<MachinePageView, { kind: "machine" }>["sampled"]
  >,
  vmMemoryCeilingBytes: number | null,
): readonly MachineLine[] {
  const { memory } = sampled
  const whose = memory.source === "own-cgroup" ? "this lane's memory" : "memory"
  return [
    {
      key: "memory",
      text: `${whose}: ${sizeWords(memory.availableBytes)} available of ${sizeWords(memory.totalBytes)}; ${RUNG_WORDS[memory.rung] ?? `rung ${memory.rung}`}`,
      unreadable: false,
    },
    measuredLine(
      "pressure",
      "memory pressure",
      memory.pressure,
      p =>
        `some tasks stalled ${percent(p.someAvg10)}, every task ${percent(p.fullAvg10)} of the last 10 seconds`,
    ),
    measuredLine(
      "store",
      "the lanes' disk",
      sampled.store,
      s =>
        `${sizeWords(s.unallocatedBytes)} unallocated of ${sizeWords(s.sizeBytes)}; ${PRODUCT_NAME} keeps ${sizeWords(s.minimumBytes)} at least; ${s.maxBytes === null ? "it may grow with no limit set (`lanes.store.max`)" : `it grows to ${sizeWords(s.maxBytes)} at most (\`lanes.store.max\`)`}`,
    ),
    measuredLine(
      "filesystem",
      "your disk",
      sampled.filesystem,
      f =>
        `${sizeWords(f.freeBytes)} free of ${sizeWords(f.sizeBytes)}; ${PRODUCT_NAME} leaves ${sizeWords(f.leaveFreeBytes)} of it free`,
    ),
    ...(vmMemoryCeilingBytes === null
      ? []
      : [
          {
            key: "vm-memory",
            text: `the lane VM may use up to ${sizeWords(vmMemoryCeilingBytes)} of your Mac's memory`,
            unreadable: false,
          },
        ]),
  ]
}

const serviceLine = (s: ServiceReading): MachineLine =>
  measuredLine(s.service, serviceWords(s.service), s.memory, m =>
    m.limitBytes === null
      ? `${sizeWords(m.currentBytes)}, with no limit`
      : `${sizeWords(m.currentBytes)} of ${sizeWords(m.limitBytes)}`,
  )

function threadLine(row: MachineThreadRow): MachineThreadLine {
  const who = threadWords(row.name)
  const snapshots =
    row.snapshots.count === 0
      ? "no snapshots"
      : `${row.snapshots.count} snapshot${row.snapshots.count === 1 ? "" : "s"}, about ${sizeWords(row.snapshots.bytes)}`
  const held = treatmentWords({ kind: row.treatment })
  const memory =
    row.memory.kind === "unreadable"
      ? `memory not read: ${row.memory.why}`
      : `${sizeWords(row.memory.currentBytes)}${row.memory.limitBytes === null ? "" : ` of ${sizeWords(row.memory.limitBytes)}`} (its own ${sizeWords(row.memory.anonBytes)}, cache ${sizeWords(row.memory.fileBytes)})`
  const { archive } = row
  const drops = archive === null ? null : dropsWords(archive.drops)
  return {
    key: row.lane,
    lane: row.lane,
    text: [
      `${who}: ${memory}; ${snapshots}`,
      ...(held === null ? [] : [held]),
    ].join("; "),
    unreadable: row.memory.kind === "unreadable",
    archive:
      archive === null
        ? null
        : {
            label: "Archive",
            confirm: [
              `Archive ${who}'s canvas? Its threads become read-only for everyone until moved out`,
              row.snapshots.count === 0
                ? null
                : `the upkeep then deletes ${who}'s snapshots, about ${sizeWords(row.snapshots.bytes)}`,
              drops,
            ]
              .filter(w => w !== null)
              .join("; "),
            refused:
              archive.busy === null ? null : CANVAS_BUSY_REASON[archive.busy],
            intent: archive.intent,
          },
  }
}

const REPAIR_MOVE_WORDS: Readonly<Record<RepairStep, string>> = {
  idle: "the lane VM's disk repair ended",
  detected: "a repair of the lane VM's disk began",
  "stopping-vm": "the lane VM stopped for its disk's repair",
  "booting-repair": "the lane VM's disk is being repaired",
  done: "the lane VM's disk was repaired",
  failed: "the lane VM's disk repair failed",
}

/** One event, as a clause; `nameOf` names a thread's lane. */
function eventWords(
  event: EventMeasured,
  nameOf: (lane: ThreadId) => string,
): string {
  switch (event.kind) {
    case "lane-oom-killed":
      return `a command in ${nameOf(event.lane)} was killed for using too much memory`
    case "service-oom-killed":
      return `${serviceWords(event.service)} was killed for using too much memory`
    case "snapshots-deleted":
      return `${event.count} old turn${event.count === 1 ? "'s snapshot was" : "s' snapshots were"} deleted, about ${sizeWords(event.bytes)}`
    case "host-stalled":
      return `the host stalled for ${(event.ms / 1000).toFixed(1)} seconds`
    case "repair-asked-again":
      return "you asked for the lane VM's disk to be repaired again"
    case "slow-step":
      return `a step of ${event.where ?? "the host's documents"} took ${event.ms} ms`
    case "slow-command":
      return `\`${event.subcommand === null ? event.program : `${event.program} ${event.subcommand}`}\` took ${event.ms} ms`
    default:
      return assertNever(event)
  }
}

function treatmentChangeWords(who: string, to: LaneTreatment["kind"]): string {
  const held = treatmentWords({ kind: to })
  return held === null ? `${who} runs again` : `${who} ${held}`
}

function latelyLine(
  l: MachineLately,
  nameOf: (lane: ThreadId) => string,
): MachineLatelyLine {
  const text = (() => {
    switch (l.kind) {
      case "event":
        return eventWords(l.event, nameOf)
      case "treatment":
        return treatmentChangeWords(nameOf(l.lane), l.to)
      case "repair":
        return REPAIR_MOVE_WORDS[l.to]
      case "rung":
        return l.to > l.from
          ? `memory grew short: ${RUNG_WORDS[l.to] ?? `rung ${l.to}`}`
          : `memory eased: ${RUNG_WORDS[l.to] ?? `rung ${l.to}`}`
      default:
        return assertNever(l)
    }
  })()
  return { key: `${l.at}:${l.kind}:${text}`, at: l.at, text, unreadable: false }
}

/** The page's every word, from its view. */
export function machinePageWords(view: MachinePageView): MachinePageText {
  const empty = { heading: "", lines: [] }
  const shared = {
    title: pageWords("machine").title,
    copy: {
      label: "Copy diagnostics",
      copied: "Copied the diagnostics",
      failed: "The diagnostics could not be copied",
    },
    ask: {
      label: "Ask an agent about this",
      title: "a new canvas, the diagnostics in its composer, not sent",
    },
    confirm: "Confirm",
    cancel: "Cancel",
  }
  if (view.kind === "no-machine")
    return {
      ...shared,
      noMachine: `This host runs no lanes, so ${PRODUCT_NAME} reads no machine here.`,
      sections: {
        now: empty,
        threads: { ...empty, empty: "" },
        machine: empty,
        host: empty,
        lately: { ...empty, empty: "" },
      },
      repairAgain: null,
    }
  const nameOf = (lane: ThreadId) => threadWords(view.names.get(lane))
  const waiting = (key: string): MachineLine => ({
    key,
    text: WAITING_FOR_READING,
    unreadable: true,
  })
  const now: MachineNowLine[] =
    view.now.length === 0
      ? [
          {
            key: "keeping-up",
            text: "the machine keeps up: nothing waits",
            unreadable: false,
            doing: null,
            youCan: null,
          },
        ]
      : view.now.map((c, i) => ({
          key: `${c.kind}:${i}`,
          text: causeWords(c, nameOf, view.heldForMemory),
          unreadable: c.kind === "unsampled",
          doing: causeDoingWords(c),
          youCan: causeYouCanWords(c),
        }))
  return {
    ...shared,
    noMachine: null,
    sections: {
      now: { heading: "Now", lines: now },
      threads: {
        heading: "Threads",
        lines: view.threads.map(threadLine),
        empty:
          view.sampled === null
            ? WAITING_FOR_READING
            : "no thread's lane is running",
      },
      machine: {
        heading: "Machine",
        lines:
          view.sampled === null
            ? [waiting("machine")]
            : machineLines(view.sampled, view.vmMemoryCeilingBytes),
      },
      host: {
        heading: "Host",
        lines:
          view.sampled === null
            ? [waiting("host")]
            : view.sampled.services.map(serviceLine),
      },
      lately: {
        heading: "Lately",
        lines: view.lately.map(l => latelyLine(l, nameOf)),
        empty: "nothing has happened since the measurements were kept",
      },
    },
    repairAgain:
      view.repairAgain === null
        ? null
        : {
            label: "Repair again",
            confirm: `Repair the lane VM's disk again? Every running thread on every host waits while the lane VM is stopped and its disk repaired. The last repair failed: ${view.repairAgain.why}`,
          },
  }
}

/** The page's words as plain text, section by section: the diagnostics' head. */
export function machinePageLines(text: MachinePageText): readonly string[] {
  if (text.noMachine !== null) return [text.noMachine]
  const { now, threads, machine, host, lately } = text.sections
  const list = (lines: readonly MachineLine[], none: string) =>
    lines.length === 0 ? [`  ${none}`] : lines.map(l => `  ${l.text}`)
  return [
    `${now.heading}:`,
    ...now.lines.flatMap(l => [
      `  ${l.text}`,
      ...(l.doing === null ? [] : [`    ${PRODUCT_NAME} ${l.doing}`]),
      ...(l.youCan === null ? [] : [`    you can ${l.youCan}`]),
    ]),
    `${threads.heading}:`,
    ...list(threads.lines, threads.empty),
    `${machine.heading}:`,
    ...list(machine.lines, ""),
    `${host.heading}:`,
    ...list(host.lines, ""),
    `${lately.heading}:`,
    ...(lately.lines.length === 0
      ? [`  ${lately.empty}`]
      : lately.lines.map(l => `  ${new Date(l.at).toISOString()} ${l.text}`)),
  ]
}

/**
 * Ask an agent about this: a new canvas's first thread, `@agent ` typed
 * and the diagnostics after it, a fenced block, for the person to send.
 */
export const machineAskPrefill = (diagnostics: string): Prefill => ({
  text: agentAsk(
    `what is wrong with the machine lanes run on, and what should I do?\n\n\`\`\`\n${diagnostics.trimEnd()}\n\`\`\`\n`,
  ),
  blank: false,
})
