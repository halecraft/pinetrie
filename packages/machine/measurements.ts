// machine/measurements — what the host keeps of the machine to tune the
// memory rungs by: its samples, each lane's memory and program, each `bash`
// call's duration, and every treatment changed or shadow decision, each row
// a value built here from what was planned; the host's store stamps its time.
// No command's arguments or output is kept: only its program.

import type {
  HeldLane,
  LaneTreatment,
  MemoryCounters,
  MemorySource,
  ThreadId,
} from "@pinetrie/core"
import type { ManageMode } from "./manager.ts"
import type { Rung } from "./rung.ts"
import type { LaneSample } from "./sample.ts"
import type { ShadowDecision } from "./treatments.ts"

/** Words a statement starts with that are not its program: `env X=1 time pnpm` runs `pnpm`. */
const PREFIXES = new Set(["env", "time", "exec", "nice", "nohup", "command"])
/** Statements that run no program worth naming. */
const NOT_PROGRAMS = new Set(["cd", "export", "pushd", "popd", "set"])

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * The program a shell command runs: the first word of its first statement
 * that is not `cd`, `export` or assignments alone, past `env`, `time` and
 * the like and their assignments and flags; its last path segment, so a
 * path names no directory. Never an argument. Null for none.
 */
export function commandProgram(command: string): string | null {
  for (const statement of command.split(/&&|\|\||[;|\n&]/)) {
    const words = statement
      .trim()
      .split(/\s+/)
      .map(w => w.replace(/^[({"']+|[)}"']+$/g, ""))
      .filter(w => w !== "")
    let afterPrefix = false
    const program = words.find(word => {
      if (PREFIXES.has(word)) afterPrefix = true
      return !(
        ASSIGNMENT.test(word) ||
        PREFIXES.has(word) ||
        (afterPrefix && word.startsWith("-"))
      )
    })
    if (
      program === undefined ||
      program.startsWith("-") ||
      NOT_PROGRAMS.has(program)
    )
      continue
    const name = program.split("/").at(-1)
    if (name !== undefined && name !== "") return name
  }
  return null
}

/** A sample as the measurements keep it. Sizes in bytes, stall time in µs. */
export interface SampleMeasured {
  readonly rung: Rung
  readonly someAvg10: number | null
  readonly fullAvg10: number | null
  readonly memoryTotal: number
  readonly memoryAvailable: number
  readonly source: MemorySource
  /** The kernel's counters' rise since the last sample read them; null for none to compare. */
  readonly since: MemoryCounters | null
  readonly lanesRunning: number
  readonly mode: ManageMode
}

/** A running lane's memory, in MiB so a lane is kept only when it moved by one, and the program it runs. */
export interface LaneMeasured {
  readonly lane: ThreadId
  readonly anonMiB: number
  readonly fileMiB: number
  readonly currentMiB: number
  readonly limitMiB: number | null
  readonly program: string | null
}

/** A treatment changed, or a shadow decision, with the pressure and memory it was made at. */
export type DecisionMeasured = {
  readonly fullAvg10: number | null
  readonly memoryAvailable: number
} & (
  | {
      readonly kind: "treatment"
      readonly lane: ThreadId
      readonly from: LaneTreatment["kind"]
      readonly to: LaneTreatment["kind"]
    }
  | { readonly kind: "shadow"; readonly decision: ShadowDecision }
)

/** The rise of each counter from `before` to `now`; null when either is missing or one fell, as at a reboot. */
export function counterRise(
  before: MemoryCounters | null,
  now: MemoryCounters | null,
): MemoryCounters | null {
  if (before === null || now === null) return null
  const rise = {
    refaultAnon: now.refaultAnon - before.refaultAnon,
    refaultFile: now.refaultFile - before.refaultFile,
    stallSomeUs: now.stallSomeUs - before.stallSomeUs,
    stallFullUs: now.stallFullUs - before.stallFullUs,
  }
  return Object.values(rise).some(v => v < 0) ? null : rise
}

const MiB = 1024 ** 2
const inMiB = (bytes: number) => Math.round(bytes / MiB)

/** Each running lane whose memory was read, as kept. */
export function lanesMeasured(
  lanes: readonly LaneSample[],
  programInFlight: (lane: ThreadId) => string | null,
): readonly LaneMeasured[] {
  return lanes.map(l => ({
    lane: l.lane,
    anonMiB: inMiB(l.anon),
    fileMiB: inMiB(l.file),
    currentMiB: inMiB(l.current),
    limitMiB: l.limit === null ? null : inMiB(l.limit),
    program: programInFlight(l.lane),
  }))
}

/** The lanes of `now` that differ from what `before` kept of each: the only ones stored. */
export const lanesChanged = (
  before: ReadonlyMap<ThreadId, LaneMeasured>,
  now: readonly LaneMeasured[],
): readonly LaneMeasured[] =>
  now.filter(l => {
    const was = before.get(l.lane)
    return (
      was === undefined ||
      was.anonMiB !== l.anonMiB ||
      was.fileMiB !== l.fileMiB ||
      was.currentMiB !== l.currentMiB ||
      was.limitMiB !== l.limitMiB ||
      was.program !== l.program
    )
  })

/** Each lane whose treatment differs between two plans' held lanes, from and to; a lane not held is `normal`. */
export function treatmentChanges(
  before: readonly HeldLane[],
  after: readonly HeldLane[],
): readonly {
  readonly lane: ThreadId
  readonly from: LaneTreatment["kind"]
  readonly to: LaneTreatment["kind"]
}[] {
  const kindIn = (held: readonly HeldLane[], lane: ThreadId) =>
    held.find(h => h.lane === lane)?.treatment.kind ?? "normal"
  const lanes = [...new Set([...before, ...after].map(h => h.lane))]
  return lanes.flatMap(lane => {
    const from = kindIn(before, lane)
    const to = kindIn(after, lane)
    return from === to ? [] : [{ lane, from, to }]
  })
}
