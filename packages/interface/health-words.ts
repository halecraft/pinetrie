// interface/health-words — the Health page's every word, from its view
// (`health-page.ts`), for the page and the host's diagnostics alike: the
// diagnostics are joined from the words the page draws (`diagnosticLines`),
// so no fact is worded twice.

import {
  type ActingBound,
  agentAsk,
  assertNever,
  type BoundAction,
  type ContainmentControl,
  type EventMeasured,
  type LaneTreatment,
  type MachineCause,
  type MachineKind,
  type MachineLately,
  type MachineState,
  PRODUCT_NAME,
  type RepairStep,
  type ThreadId,
  type ThreadName,
} from "@pinetrie/core"
import { CANVAS_BUSY_REASON } from "@pinetrie/rules"
import type { Prefill } from "./columns.ts"
import { ago, whenWords } from "./counts.ts"
import type {
  BarView,
  HappenedRow,
  HappenedTone,
  HealthPageView,
  LaneTrouble,
  SeriesView,
  ServiceRow,
  ThreadRow,
  VitalName,
  VitalStatus,
  VitalView,
} from "./health-page.ts"
import type { Intent } from "./intent.ts"
import {
  causeWords,
  limitSubjectWords,
  percentWords,
  serviceWords,
  sizeWords,
  treatmentWords,
} from "./machine.ts"
import { pageWords } from "./page.ts"
import { dropsWords } from "./sidebar-view.ts"

const WAITING_FOR_READING = "waiting for its first reading"
const DAY_MS = 24 * 60 * 60 * 1000

/** A thread as people read it: its name, never its id. */
const threadWords = (name: ThreadName | null | undefined): string =>
  name ?? "a thread not named yet"

export interface VitalText {
  readonly name: VitalName
  readonly label: string
  /** The reading, large: "10 GB", "0.5%"; a dash where it was not read. */
  readonly number: string
  /** What it is out of: "free of 12 GB". */
  readonly of: string
  readonly status: {
    readonly kind: VitalStatus["kind"]
    readonly word: string
  }
  /** What happens at the mark, how far it is, or why it was not read. */
  readonly note: string
  readonly bar: BarView | null
  /** The bar as words, for a screen reader. */
  readonly barText: string
  readonly series: SeriesView | null
  /** The graph as words, for a screen reader; null with no graph. */
  readonly seriesText: string | null
}

type ThreadTone = "running" | "held" | "trouble"

interface ThreadText {
  readonly key: string
  readonly lane: ThreadId
  readonly name: string
  /** "326 MB of 4 GB", or why its memory was not read. */
  readonly memory: string
  readonly cache: string | null
  readonly unreadable: boolean
  readonly bar: BarView | null
  readonly barText: string
  readonly series: SeriesView | null
  readonly seriesText: string | null
  readonly snapshots: string
  readonly state: {
    readonly label: string
    /** The column's own sentence, or a cause's, where the label needs it. */
    readonly title: string | null
    readonly tone: ThreadTone
  }
  /** Its Archive button, and what its confirmation says; null where none is offered. */
  readonly archive: {
    readonly label: string
    readonly confirm: string
    /** Why it cannot be archived now; the button is disabled. */
    readonly refused: string | null
    readonly intent: Intent
  } | null
  /** The row as one line, for the diagnostics. */
  readonly line: string
}

interface HappenedText {
  readonly key: string
  readonly at: number
  /** "5 min ago" within a day, a date beyond it. */
  readonly when: string
  readonly text: string
  readonly tone: HappenedTone
}

interface ServiceText {
  readonly key: string
  readonly label: string
  readonly text: string
  readonly bar: BarView | null
  readonly atLimit: boolean
  readonly unreadable: boolean
}

/** A safeguard: in effect, set and not read back, missing, or something outside pine·trie. */
interface SafeguardText {
  readonly key: string
  readonly text: string
  readonly mark: "in-effect" | "set" | "missing" | "outside"
}

interface SettingText {
  readonly key: string
  readonly label: string
  readonly value: string
  /** The setting that changes it; null for one no setting does. */
  readonly setting: string | null
}

interface VerdictText {
  readonly state: MachineState
  readonly title: string
  readonly sentence: string | null
  /** What pine·trie does about it, a whole clause. */
  readonly doing: string | null
  readonly youCan: string | null
  /** The causes after the worst. */
  readonly more: readonly {
    readonly key: string
    readonly title: string
    readonly sentence: string
  }[]
  /** Nothing is wrong: the page's actions are quiet. */
  readonly quiet: boolean
}

/** Every word the Health page draws, from its view. */
export type HealthPageText =
  | {
      readonly kind: "no-machine"
      readonly title: string
      readonly noMachine: string
    }
  | {
      readonly kind: "machine"
      readonly title: string
      /** What the machine is, and its size. */
      readonly machineLine: string
      readonly live: string
      readonly verdict: VerdictText
      readonly vitals: {
        readonly heading: string
        readonly note: string
        readonly items: readonly VitalText[]
      }
      readonly threads: {
        readonly heading: string
        readonly summary: string
        readonly columns: {
          readonly thread: string
          readonly memory: string
          readonly hour: string
          readonly snapshots: string
          readonly state: string
        }
        readonly rows: readonly ThreadText[]
        readonly empty: string
      }
      readonly happened: {
        readonly heading: string
        readonly span: string
        readonly strip: Extract<HealthPageView, { kind: "machine" }>["strip"]
        readonly stripLabel: string
        readonly rows: readonly HappenedText[]
        readonly empty: string
      }
      readonly details: {
        readonly heading: string
        readonly services: {
          readonly heading: string
          readonly summary: string
          readonly rows: readonly ServiceText[]
        }
        readonly safeguards: {
          readonly heading: string
          readonly summary: string
          readonly items: readonly SafeguardText[]
        }
        readonly settings: {
          readonly heading: string
          readonly summary: string
          readonly items: readonly SettingText[]
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

/** The page's header while the last refresh failed: the facts shown are the last read. */
export const notRefreshedWords = (why: string): string =>
  `not refreshed: ${why}`

/** What pine·trie does about a cause, a predicate after its name, or null where it does nothing more than say it. */
function causeDoingWords(cause: MachineCause): string | null {
  switch (cause.kind) {
    case "room-low":
      return cause.grows
        ? "grows the disk when the lane VM next starts"
        : "deletes old turns' snapshots, least recently used first"
    case "room-spent":
    case "metadata-full":
    case "freeing-room":
      return "deletes old turns' snapshots, least recently used first"
    case "room-unrecoverable":
      return cause.isRepaired
        ? "repairs the lane VM's disk, offline, once the disk is full"
        : null
    case "filesystem-low":
      return "grows the lanes' disk no further"
    case "memory-short":
      return !cause.isHolding
        ? "does nothing: this host only watches the machine (`lanes.manage`)"
        : cause.rung >= 3
          ? "pauses the threads that matter least at their next tool call"
          : "holds new runs' starts until there is room"
    case "disk-being-repaired":
      return "holds every thread while the lane VM is stopped and its disk repaired"
    case "unsampled":
      return cause.reason === "stopped"
        ? null
        : "reads the machine again at its next sample"
    case "disk-repair-failed":
    case "lane-oom-killed":
    case "service-oom-killed":
    case "cgroup-at-limit":
    case "host-stalls":
    case "snapshot-skipped":
      return null
    default:
      return assertNever(cause)
  }
}

const ASK_IF_AGAIN =
  "ask an agent about it with the diagnostics, if it keeps happening"

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
    case "cgroup-at-limit":
      return cause.subject.kind === "lane"
        ? "read what its thread is running, and run less of it at once"
        : ASK_IF_AGAIN
    case "service-oom-killed":
    case "host-stalls":
      return ASK_IF_AGAIN
    case "disk-being-repaired":
    case "snapshot-skipped":
    case "unsampled":
      return null
    default:
      return assertNever(cause)
  }
}

/** Memory's rung, as a clause after "memory": every rung the ladder has. */
const RUNG_WORDS: readonly string[] = [
  "calm",
  "tight: nothing is held yet",
  "short: new runs wait for room",
  "short: only the threads that matter most make tool calls",
  "very short: the threads that matter least would be frozen, which is measured, never done",
  "very short: a command would be stopped, which is measured, never done",
]

const rungWords = (rung: number) => RUNG_WORDS[rung] ?? `rung ${rung}`

/** What pine·trie does past a bound, as the subject and verb of a clause. */
const BOUND_ACTION_WORDS: Readonly<Record<BoundAction, string>> = {
  "hold-starts": "new runs wait",
  "pause-threads": "threads pause",
  "delete-snapshots": `${PRODUCT_NAME} deletes old snapshots`,
  "writes-may-fail": "writes in lanes may fail",
  "stop-growing": "the lanes' disk stops growing",
}

/** Where a bound is, and, near it, how far: "new runs wait below 1.2 GB: 300 MB away". */
function boundWords(
  bound: ActingBound,
  amount: (n: number) => string,
  value: number | null,
): string {
  const where = `${BOUND_ACTION_WORDS[bound.does]} ${bound.worse} ${amount(bound.acts)}`
  return value === null
    ? where
    : `${where}: ${amount(Math.abs(value - bound.acts))} away`
}

function vitalLabel(name: VitalName, kind: MachineKind): string {
  switch (name) {
    case "memory":
      return kind === "own-cgroup" ? "This lane's memory" : "Memory"
    case "pressure":
      return "Memory pressure"
    case "store":
      return "Lanes' disk"
    case "filesystem":
      return kind === "lane-vm" ? "Your Mac's disk" : "Your disk"
    default:
      return assertNever(name)
  }
}

/** What a cause in force makes of its vital, in a word. */
function actingWord(name: VitalName, cause: MachineCause): string {
  switch (name) {
    case "memory":
      return "Short"
    case "pressure":
      return "High"
    case "filesystem":
      return "Low"
    case "store":
      return cause.kind === "room-spent" || cause.kind === "metadata-full"
        ? "Full"
        : cause.kind === "disk-being-repaired"
          ? "Repairing"
          : cause.kind === "disk-repair-failed"
            ? "Repair failed"
            : "Low"
    default:
      return assertNever(name)
  }
}

function statusWord(name: VitalName, status: VitalStatus): string {
  switch (status.kind) {
    case "normal":
      return "Normal"
    case "near":
      return "Near limit"
    case "acting":
      return actingWord(name, status.cause)
    case "contained":
      return "A thread's own"
    case "not-read":
      return status.why === WAITING_FOR_READING ? "Waiting" : "Not read"
    default:
      return assertNever(status)
  }
}

/** A vital's reading as a size or a percentage. */
const amountWords = (name: VitalName) =>
  name === "pressure" ? percentWords : sizeWords

function vitalNote(v: VitalView, nameOf: (lane: ThreadId) => string): string {
  const { status } = v
  const amount = amountWords(v.name)
  switch (status.kind) {
    case "not-read":
      return status.why
    case "contained":
      return "a thread is stalled at its own memory limit; the machine is not short"
    case "acting": {
      const doing = causeDoingWords(status.cause)
      return doing === null
        ? causeWords(status.cause, nameOf, 0).sentence
        : `${PRODUCT_NAME} ${doing}`
    }
    case "near":
      return boundWords(status.bound, amount, v.reading?.value ?? null)
    case "normal": {
      const first = v.bounds[0]
      return first === undefined ? "" : boundWords(first, amount, null)
    }
    default:
      return assertNever(status)
  }
}

function vitalText(
  v: VitalView,
  kind: MachineKind,
  nameOf: (lane: ThreadId) => string,
): VitalText {
  const label = vitalLabel(v.name, kind)
  const { reading } = v
  const number = reading === null ? "—" : amountWords(v.name)(reading.value)
  const of =
    reading === null
      ? ""
      : v.name === "pressure"
        ? "of the time stalled"
        : `free of ${sizeWords(reading.total)}`
  const used =
    reading === null || v.name === "pressure"
      ? null
      : sizeWords(Math.max(0, reading.total - reading.value))
  const range = v.series?.range ?? null
  const amount = amountWords(v.name)
  return {
    name: v.name,
    label,
    number,
    of,
    status: { kind: v.status.kind, word: statusWord(v.name, v.status) },
    note: vitalNote(v, nameOf),
    bar: v.bar,
    barText:
      used === null || reading === null
        ? number
        : `${used} used of ${sizeWords(reading.total)}`,
    series: v.series,
    seriesText:
      v.series === null
        ? null
        : range === null
          ? `${label}: nothing read in the last hour yet`
          : v.name === "memory"
            ? `memory in use over the last hour: least ${amount(range.least)}, most ${amount(range.most)}, now ${amount(range.now)}`
            : `the machine's stalls over the last hour: most ${amount(range.most)}, now ${amount(range.now)}`,
  }
}

const THREAD_TROUBLE_LABEL: Readonly<Record<LaneTrouble["kind"], string>> = {
  "lane-oom-killed": "killed for memory",
  "cgroup-at-limit": "at its memory limit",
}

function threadText(
  row: ThreadRow,
  nameOf: (lane: ThreadId) => string,
): ThreadText {
  const who = threadWords(row.name)
  const { memory } = row
  const snapshots =
    row.snapshots.count === 0
      ? "none"
      : `${row.snapshots.count} · ${sizeWords(row.snapshots.bytes)}`
  const held = treatmentWords({ kind: row.treatment })
  const { trouble } = row
  const state =
    trouble !== null
      ? {
          label: THREAD_TROUBLE_LABEL[trouble.kind],
          title: causeWords(trouble, nameOf, 0).sentence,
          tone: "trouble" as const,
        }
      : held !== null
        ? { label: held.label, title: held.sentence, tone: "held" as const }
        : { label: "running", title: null, tone: "running" as const }
  const memoryText =
    memory.kind === "unreadable"
      ? `not read: ${memory.why}`
      : `${sizeWords(memory.currentBytes)}${memory.limitBytes === null ? "" : ` of ${sizeWords(memory.limitBytes)}`}`
  const cache =
    memory.kind === "read" ? `${sizeWords(memory.fileBytes)} cache` : null
  const range = row.series?.range ?? null
  const { archive } = row
  const drops = archive === null ? null : dropsWords(archive.drops)
  return {
    key: row.lane,
    lane: row.lane,
    name: who,
    memory: memoryText,
    cache,
    unreadable: memory.kind === "unreadable",
    bar: row.bar,
    barText:
      memory.kind === "read"
        ? `${memoryText}, ${sizeWords(memory.fileBytes)} of it cache`
        : memoryText,
    series: row.series,
    seriesText:
      row.series === null
        ? null
        : range === null
          ? `${who}'s memory: nothing read in the last hour yet`
          : `${who}'s memory over the last hour: most ${sizeWords(range.most)}, now ${sizeWords(range.now)}`,
    snapshots,
    state,
    archive:
      archive === null
        ? null
        : {
            label: "Archive…",
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
    line: [
      `${who}: ${
        memory.kind === "unreadable"
          ? `memory not read: ${memory.why}`
          : `${memoryText} (its own ${sizeWords(memory.anonBytes)}, cache ${sizeWords(memory.fileBytes)})`
      }`,
      row.snapshots.count === 0
        ? "no snapshots"
        : `${row.snapshots.count} snapshot${row.snapshots.count === 1 ? "" : "s"}, about ${sizeWords(row.snapshots.bytes)}`,
      ...(held === null ? [] : [held.sentence]),
      ...(state.tone === "trouble" && state.title !== null
        ? [state.title]
        : []),
    ].join("; "),
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

const timesWords = (n: number) => `${n} time${n === 1 ? "" : "s"}`

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
      return `\`${commandWords(event)}\` took ${event.ms} ms`
    case "cgroup-at-limit": {
      const met = [
        event.maxHits === 0
          ? null
          : `its memory limit ${timesWords(event.maxHits)}`,
        event.highHits === 0
          ? null
          : `its memory's high mark ${timesWords(event.highHits)}`,
      ].filter(m => m !== null)
      return `${limitSubjectWords(event.subject, nameOf)} met ${met.join(" and ")}`
    }
    default:
      return assertNever(event)
  }
}

const commandWords = (e: Extract<EventMeasured, { kind: "slow-command" }>) =>
  e.subcommand === null ? e.program : `${e.program} ${e.subcommand}`

/** A run of one event folded: its count, and its longest time where it has one. */
function foldedEventWords(
  event: EventMeasured,
  count: number,
  nameOf: (lane: ThreadId) => string,
): string {
  if (count === 1) return eventWords(event, nameOf)
  switch (event.kind) {
    case "host-stalled":
      return `the host stalled ${timesWords(count)}, the longest for ${(event.ms / 1000).toFixed(1)} seconds`
    case "slow-step":
      return `a step of ${event.where ?? "the host's documents"} was slow ${timesWords(count)}, the longest ${event.ms} ms`
    case "slow-command":
      return `\`${commandWords(event)}\` was slow ${timesWords(count)}, the longest ${event.ms} ms`
    case "snapshots-deleted":
    case "cgroup-at-limit":
      return eventWords(event, nameOf)
    case "lane-oom-killed":
    case "service-oom-killed":
    case "repair-asked-again":
      return `${eventWords(event, nameOf)}, ${timesWords(count)}`
    default:
      return assertNever(event)
  }
}

function treatmentChangeWords(who: string, to: LaneTreatment["kind"]): string {
  const held = treatmentWords({ kind: to })
  return held === null ? `${who} runs again` : `${who} ${held.sentence}`
}

function happenedWords(
  row: HappenedRow,
  nameOf: (lane: ThreadId) => string,
): string {
  const l: MachineLately = row.lately
  switch (l.kind) {
    case "event":
      return foldedEventWords(l.event, row.count, nameOf)
    case "treatment":
      return treatmentChangeWords(nameOf(l.lane), l.to)
    case "repair":
      return REPAIR_MOVE_WORDS[l.to]
    case "rung":
      return l.to > l.from
        ? `memory grew short: ${rungWords(l.to)}`
        : `memory eased: ${rungWords(l.to)}`
    default:
      return assertNever(l)
  }
}

/** A control that did not take, as the subject of a clause. */
const CONTROL_WORDS: Readonly<Record<ContainmentControl, string>> = {
  processes: "a container's process limit",
  "cpu-weight": "a service's CPU share",
  "services-floor": "the services' memory floor",
}

/** What took effect of the containers' controls, each a line; the OOM priority is said as set, never read back. */
function safeguards(view: Extract<HealthPageView, { kind: "machine" }>): {
  readonly summary: string
  readonly items: readonly SafeguardText[]
} {
  const { servicesFloorBytes, isOomdManagingLanes } = view
  const containment = view.sampled?.containment ?? null
  const oomd: readonly SafeguardText[] = isOomdManagingLanes
    ? [
        {
          key: "oomd",
          text: `systemd-oomd may stop these lanes under memory pressure, outside ${PRODUCT_NAME}`,
          mark: "outside",
        },
      ]
    : []
  if (containment === null)
    return {
      summary: WAITING_FOR_READING,
      items: [{ key: "waiting", text: WAITING_FOR_READING, mark: "set" }],
    }
  switch (containment.kind) {
    case "contained":
      return {
        summary: isOomdManagingLanes
          ? `in effect; systemd-oomd may stop lanes outside ${PRODUCT_NAME}`
          : "all in effect",
        items: [
          {
            key: "processes",
            text: "each lane is held to its process limit",
            mark: "in-effect",
          },
          {
            key: "services",
            text: "the services are held to theirs, and to their CPU share",
            mark: "in-effect",
          },
          servicesFloorBytes === null
            ? {
                key: "floor",
                text: `the services' memory has no floor here, where the cgroups are not ${PRODUCT_NAME}'s`,
                mark: "outside",
              }
            : {
                key: "floor",
                text: `the services are protected up to ${sizeWords(servicesFloorBytes)} of memory`,
                mark: "in-effect",
              },
          {
            key: "oom",
            text: "the kernel is set to stop a lane before a service when memory runs out (set, not read back)",
            mark: "set",
          },
          ...oomd,
        ],
      }
    case "not-contained":
      switch (containment.why) {
        case "no-cgroup-driver":
          return {
            summary: "nothing is contained here",
            items: [
              {
                key: "containment",
                text: "this lane's Docker has no cgroup controllers: nothing is contained here",
                mark: "missing",
              },
              ...oomd,
            ],
          }
        case "not-read-back":
          return {
            summary: "not every limit took",
            items: [
              {
                key: "containment",
                text: `not every limit took: ${containment.missing.map(c => CONTROL_WORDS[c]).join(", ")} did not read back as set`,
                mark: "missing",
              },
              ...oomd,
            ],
          }
        default:
          return assertNever(containment.why)
      }
    default:
      return assertNever(containment)
  }
}

function serviceText(s: ServiceRow): ServiceText {
  const { memory } = s
  return {
    key: s.service,
    label: serviceWords(s.service),
    text:
      memory.kind === "unreadable"
        ? `not read: ${memory.why}`
        : memory.limitBytes === null
          ? `${sizeWords(memory.currentBytes)}, with no limit`
          : `${sizeWords(memory.currentBytes)} of ${sizeWords(memory.limitBytes)}`,
    bar: s.bar,
    atLimit: s.atLimit,
    unreadable: memory.kind === "unreadable",
  }
}

function servicesSummary(rows: readonly ServiceText[]): string {
  const atLimit = rows.filter(r => r.atLimit)
  if (atLimit.length > 0)
    return `${atLimit.map(r => r.label).join(", ")} met ${atLimit.length === 1 ? "its limit" : "their limits"}`
  const unread = rows.filter(r => r.unreadable).length
  if (rows.length === 0) return WAITING_FOR_READING
  return unread === 0
    ? "all within their limits"
    : `${unread} not read here; the rest within their limits`
}

const MACHINE_KIND_WORDS: Readonly<Record<MachineKind, string>> = {
  "lane-vm": "The lane VM on your Mac, where your threads' commands run",
  "linux-host": "This computer, where your threads' commands run",
  "own-cgroup": `This lane's share of its machine: ${PRODUCT_NAME} runs inside a lane here`,
}

function settingItems(
  view: Extract<HealthPageView, { kind: "machine" }>,
): readonly SettingText[] {
  const store = view.sampled?.store
  const filesystem = view.sampled?.filesystem
  const kept = store?.kind === "read" ? store.bounds[0] : undefined
  const leaveFree =
    filesystem?.kind === "read" ? filesystem.bounds[0] : undefined
  return [
    ...(view.vmMemoryCeilingBytes === null
      ? []
      : [
          {
            key: "vm-memory",
            label: "Lane VM memory",
            value: `up to ${sizeWords(view.vmMemoryCeilingBytes)} of your Mac's`,
            setting: null,
          },
        ]),
    ...(store?.kind === "read"
      ? [
          {
            key: "store-max",
            label: "Lanes' disk, largest",
            value:
              store.maxBytes === null ? "no limit" : sizeWords(store.maxBytes),
            setting: "lanes.store.max",
          },
        ]
      : []),
    ...(kept === undefined
      ? []
      : [
          {
            key: "store-kept",
            label: "Lanes' disk, kept free",
            value: `${sizeWords(kept.acts)} at least`,
            setting: null,
          },
        ]),
    ...(leaveFree === undefined
      ? []
      : [
          {
            key: "leave-free",
            label: `${vitalLabel("filesystem", view.machineKind)}, left free`,
            value: sizeWords(leaveFree.acts),
            setting: "lanes.store.leaveFree",
          },
        ]),
  ]
}

function verdictText(
  view: Extract<HealthPageView, { kind: "machine" }>,
  nameOf: (lane: ThreadId) => string,
): VerdictText {
  const [worst, ...rest] = view.causes
  if (worst === undefined)
    return {
      state: view.state,
      title: "Everything keeps up",
      sentence: "nothing waits, and nothing is short",
      doing: null,
      youCan: null,
      more: [],
      quiet: true,
    }
  const words = causeWords(worst, nameOf, view.heldForMemory)
  const doing = causeDoingWords(worst)
  return {
    state: view.state,
    title: words.title,
    sentence: words.sentence,
    doing: doing === null ? null : `${PRODUCT_NAME} ${doing}`,
    youCan: causeYouCanWords(worst),
    more: rest.map((c, i) => ({
      key: `${c.kind}:${i}`,
      ...causeWords(c, nameOf, view.heldForMemory),
    })),
    quiet: view.state === "neutral",
  }
}

/** The page's every word, from its view. */
export function healthPageWords(view: HealthPageView): HealthPageText {
  const title = pageWords("health").title
  if (view.kind === "no-machine")
    return {
      kind: "no-machine",
      title,
      noMachine: `This host runs no lanes, so ${PRODUCT_NAME} reads no machine here.`,
    }
  const nameOf = (lane: ThreadId) => threadWords(view.names.get(lane))
  const { sampled } = view
  const sizes =
    sampled === null
      ? ""
      : [
          ` · ${sizeWords(sampled.memory.totalBytes)} memory`,
          sampled.store.kind === "read"
            ? ` · ${sizeWords(sampled.store.sizeBytes)} disk`
            : "",
        ].join("")
  const vitals = (["memory", "pressure", "store", "filesystem"] as const).map(
    name => vitalText(view.vitals[name], view.machineKind, nameOf),
  )
  const threads = view.threads.map(r => threadText(r, nameOf))
  const together = view.threads.reduce(
    (sum, t) => sum + (t.memory.kind === "read" ? t.memory.currentBytes : 0),
    0,
  )
  const services = view.services.map(serviceText)
  const guards = safeguards(view)
  const settings = settingItems(view)
  return {
    kind: "machine",
    title,
    machineLine: `${MACHINE_KIND_WORDS[view.machineKind]}${sizes}`,
    live: "live",
    verdict: verdictText(view, nameOf),
    vitals: {
      heading: "Vitals",
      note: `the marks are where ${PRODUCT_NAME} acts`,
      items: vitals,
    },
    threads: {
      heading: "Threads",
      summary:
        threads.length === 0
          ? ""
          : `${threads.length} running · ${sizeWords(together)} together`,
      columns: {
        thread: "Thread",
        memory: "Memory",
        hour: "Last hour",
        snapshots: "Snapshots",
        state: "State",
      },
      rows: threads,
      empty:
        sampled === null ? WAITING_FOR_READING : "no thread's lane is running",
    },
    happened: {
      heading: "What happened",
      span: view.strip.isCapped
        ? `since ${whenWords(view.strip.from)}`
        : "the last 24 hours",
      strip: view.strip,
      stripLabel: `${view.strip.marks.length} happened since ${whenWords(view.strip.from)}`,
      rows: view.happened.map((row): HappenedText => {
        const text = happenedWords(row, nameOf)
        const { at } = row.lately
        return {
          key: `${at}:${row.lately.kind}:${text}`,
          at,
          when: at >= view.now - DAY_MS ? ago(at, view.now) : whenWords(at),
          text,
          tone: row.tone,
        }
      }),
      empty: "nothing has happened since the measurements were kept",
    },
    details: {
      heading: "Details",
      services: {
        heading: `${PRODUCT_NAME}'s own services`,
        summary: servicesSummary(services),
        rows: services,
      },
      safeguards: {
        heading: "Safeguards",
        summary: guards.summary,
        items: guards.items,
      },
      settings: {
        heading: "Settings",
        summary: "what the bounds above come from",
        items: settings,
      },
    },
    repairAgain:
      view.repairAgain === null
        ? null
        : {
            label: "Repair again",
            confirm: `Repair the lane VM's disk again? Every running thread on every host waits while the lane VM is stopped and its disk repaired. The last repair failed: ${view.repairAgain.why}`,
          },
    copy: {
      label: "Copy diagnostics",
      copied: "Copied the diagnostics",
      failed: "The diagnostics could not be copied",
    },
    ask: {
      label: "Ask an agent",
      title: "a new canvas, the diagnostics in its composer, not sent",
    },
    confirm: "Confirm",
    cancel: "Cancel",
  }
}

/** The page's words as plain text, section by section: the diagnostics' head. */
export function diagnosticLines(text: HealthPageText): readonly string[] {
  if (text.kind === "no-machine") return [text.noMachine]
  const { verdict, vitals, threads, happened, details } = text
  const causes = [
    {
      title: verdict.title,
      sentence: verdict.sentence,
      doing: verdict.doing,
      youCan: verdict.youCan,
    },
    ...verdict.more.map(m => ({ ...m, doing: null, youCan: null })),
  ]
  return [
    "Now:",
    `  ${text.machineLine}`,
    ...causes.flatMap(c => [
      `  ${c.title}${c.sentence === null ? "" : `: ${c.sentence}`}`,
      ...(c.doing === null ? [] : [`    ${c.doing}`]),
      ...(c.youCan === null ? [] : [`    you can ${c.youCan}`]),
    ]),
    "Vitals:",
    ...vitals.items.map(
      v =>
        `  ${v.label}: ${v.number}${v.of === "" ? "" : ` ${v.of}`}; ${v.status.word}; ${v.note}`,
    ),
    "Threads:",
    ...(threads.rows.length === 0
      ? [`  ${threads.empty}`]
      : threads.rows.map(r => `  ${r.line}`)),
    "Services:",
    ...details.services.rows.map(r => `  ${r.label}: ${r.text}`),
    "Safeguards:",
    ...details.safeguards.items.map(i => `  ${i.text}`),
    "Settings:",
    ...details.settings.items.map(
      i =>
        `  ${i.label}: ${i.value}${i.setting === null ? "" : ` (\`${i.setting}\`)`}`,
    ),
    "Happened:",
    ...(happened.rows.length === 0
      ? [`  ${happened.empty}`]
      : happened.rows.map(r => `  ${new Date(r.at).toISOString()} ${r.text}`)),
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
