// host/start-checklist — a host's start as a list of steps, every one known
// before any runs. One step runs at a time, so the list is a
// cursor: the steps ended, the one running or failed, the ones waiting. Time
// arrives on the events; nothing here reads a clock. The words are
// `startup-lines.ts`'.

import type { ImageBuild } from "@pinetrie/lanes"

export type StartStep =
  /** The lane VM on the Mac (its launcher or image built if missing, booted, a slot); Docker on Linux. */
  | "lane-machine"
  /** The store opened and migrated, the session's documents loaded. */
  | "store"
  /** The project opened and its config settled. */
  | "project"
  /** pi's setup: the model, packages, skills and prompts. */
  | "model"
  /** The roots the last host left a run open in, opened. */
  | "roots"
  /** Lanes' configs, shared directories and ssh. */
  | "lane-work"
  | "lane-images"
  | "lane-runtime"
  /** The slot served: lanehost's roles, the shares and grants. */
  | "lanehost"
  | "observer"
  | "base-snapshot"
  /** The rest of lane work, the agent, interrupted runs resumed, the sweeps. */
  | "agent"
  /** The HTTP server, listening. */
  | "listening"

/** Where lanes run: the machine the `lane-machine` step readies. */
export type LaneMachine = "lane-vm" | "docker"

/** The lane VM on the Mac, Docker elsewhere, as `planRuntime` decides. */
export const laneMachine = (platform: NodeJS.Platform): LaneMachine =>
  platform === "darwin" ? "lane-vm" : "docker"

/** A start's steps, in the order a start runs them. */
export const planStartSteps = (input: {
  readonly tools: boolean
}): readonly StartStep[] =>
  input.tools
    ? [
        "lane-machine",
        "store",
        "project",
        "model",
        "roots",
        "lane-work",
        "lane-images",
        "lane-runtime",
        "lanehost",
        "observer",
        "base-snapshot",
        "agent",
        "listening",
      ]
    : ["store", "project", "model", "roots", "lane-work", "agent", "listening"]

/** What a step builds, announced before the build. */
export type Build =
  | { readonly kind: "vm-launcher" }
  | {
      readonly kind: "vm-image"
      /** Its builder compiled first. */
      readonly compile: boolean
      /** Alpine's kernel and root fetched first, once. */
      readonly fetch: boolean
    }
  | { readonly kind: "image"; readonly image: ImageBuild }
  | { readonly kind: "runtime" }
  | { readonly kind: "base-snapshot" }
  /** The lane VM's full disk repaired before it is leased, with the repair boot's last line. */
  | { readonly kind: "vm-disk-repair"; readonly progress: string | null }

/**
 * What the step running waits on, announced before it. Only a build marks
 * the step as built: its finished line says so, and its time is kept apart.
 */
export type StartWork =
  | { readonly kind: "build"; readonly build: Build }
  /** The containers the last host left bound into the slot, stopped before it is filled. */
  | { readonly kind: "stopping-left"; readonly count: number }

/** How a step that is no longer running came out. */
export type Ended =
  | {
      readonly kind: "done"
      readonly step: StartStep
      /** In ms. */
      readonly took: number
      /** The last build it announced; null when it built nothing. */
      readonly built: Build | null
    }
  /** A planned step the start went past: a bug in the start's order. */
  | { readonly kind: "never-ran"; readonly step: StartStep }

export type Now =
  | {
      readonly kind: "running"
      readonly step: StartStep
      readonly since: number
      /** The last build it announced; null when it built nothing. */
      readonly built: Build | null
      /** The last work it announced, which its line words. */
      readonly working: StartWork | null
    }
  | { readonly kind: "failed"; readonly step: StartStep; readonly why: string }

/** Each step's last duration in ms: when it built, and when it did not. */
export type StartTimes = Readonly<
  Partial<
    Record<StartStep, { readonly usual?: number; readonly built?: number }>
  >
>

export interface Checklist {
  readonly ended: readonly Ended[]
  readonly now: Now | null
  readonly waiting: readonly StartStep[]
  readonly times: StartTimes
}

export type StartEvent =
  | { readonly kind: "begin"; readonly step: StartStep; readonly at: number }
  | { readonly kind: "working"; readonly work: StartWork }
  | { readonly kind: "end"; readonly at: number }
  | { readonly kind: "fail"; readonly why: string }

export const startChecklist = (
  steps: readonly StartStep[],
  times: StartTimes,
): Checklist => ({ ended: [], now: null, waiting: steps, times })

const SECOND = 1000

/**
 * What a step takes when nothing remembers it, in ms, as measured on the
 * Mac's lane VM. `built` is null for a step that builds nothing. A
 * `Record`, so `tsc` refuses a step without one.
 */
export const START_DEFAULTS: Readonly<
  Record<StartStep, { readonly usual: number; readonly built: number | null }>
> = {
  "lane-machine": { usual: SECOND, built: 20 * SECOND },
  store: { usual: SECOND, built: null },
  project: { usual: SECOND, built: null },
  model: { usual: SECOND, built: null },
  roots: { usual: SECOND, built: null },
  "lane-work": { usual: SECOND, built: null },
  "lane-images": { usual: SECOND, built: 140 * SECOND },
  "lane-runtime": { usual: SECOND, built: 5 * SECOND },
  lanehost: { usual: 2 * SECOND, built: 30 * SECOND },
  observer: { usual: SECOND, built: 60 * SECOND },
  "base-snapshot": { usual: SECOND, built: 5 * SECOND },
  agent: { usual: SECOND, built: null },
  listening: { usual: SECOND, built: null },
}

/** Whether a step can build, and so says when it did not. */
export const canBuild = (step: StartStep): boolean =>
  START_DEFAULTS[step].built !== null

/** What `step` is expected to take, in ms: the last time remembered, else its default. */
export function stepEstimate(
  step: StartStep,
  building: boolean,
  times: StartTimes,
): number {
  const remembered = times[step]
  const defaults = START_DEFAULTS[step]
  if (building)
    return (
      remembered?.built ?? defaults.built ?? remembered?.usual ?? defaults.usual
    )
  return remembered?.usual ?? defaults.usual
}

/** The running step, ended at `at`. */
const endedAt = (
  now: Extract<Now, { kind: "running" }>,
  at: number,
): Ended => ({
  kind: "done",
  step: now.step,
  took: at - now.since,
  built: now.built,
})

export function checklistAfter(list: Checklist, event: StartEvent): Checklist {
  const { now } = list
  if (now?.kind === "failed") return list
  switch (event.kind) {
    case "begin": {
      const before = now === null ? [] : [endedAt(now, event.at)]
      const at = list.waiting.indexOf(event.step)
      const skipped: Ended[] = (at < 0 ? [] : list.waiting.slice(0, at)).map(
        step => ({ kind: "never-ran", step }),
      )
      return {
        ...list,
        ended: [...list.ended, ...before, ...skipped],
        now: {
          kind: "running",
          step: event.step,
          since: event.at,
          built: null,
          working: null,
        },
        waiting: at < 0 ? list.waiting : list.waiting.slice(at + 1),
      }
    }
    case "working":
      return now === null
        ? list
        : {
            ...list,
            now: {
              ...now,
              working: event.work,
              built: event.work.kind === "build" ? event.work.build : now.built,
            },
          }
    case "end":
      return now === null
        ? list
        : { ...list, ended: [...list.ended, endedAt(now, event.at)], now: null }
    case "fail":
      return now === null
        ? list
        : { ...list, now: { kind: "failed", step: now.step, why: event.why } }
  }
}

/** The times to remember after `list`: each step that ended done, by whether it built. */
export function timesAfter(list: Checklist): StartTimes {
  const next: Partial<Record<StartStep, { usual?: number; built?: number }>> = {
    ...list.times,
  }
  for (const e of list.ended) {
    if (e.kind !== "done") continue
    next[e.step] = {
      ...next[e.step],
      ...(e.built === null
        ? { usual: Math.round(e.took) }
        : { built: Math.round(e.took) }),
    }
  }
  return next
}

/**
 * The port a start reports through. A start is one sequence, so each
 * `begin` ends the step before it: no step is ended by hand but the last,
 * and none can run beside another.
 */
export interface StartProgress {
  /** `step` begins; the step running, if any, has ended. */
  begin(step: StartStep): void
  /** What the step running waits on; with none running, a line of its own. */
  working(work: StartWork): void
  /** The step running ends, and with it the start. */
  end(): void
  /** The step running failed, and with it the start. */
  fail(error: unknown): void
  log(line: string): void
}

const isDuration = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0

/**
 * The remembered times as the session's file holds them: `{}` for a file
 * that is missing, not JSON, or not times, so a broken file costs only
 * the estimates. A step this host does not know is dropped.
 */
export function decodeStartTimes(text: string | null): StartTimes {
  if (text === null) return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {}
  }
  if (typeof value !== "object" || value === null) return {}
  const times: Partial<Record<StartStep, { usual?: number; built?: number }>> =
    {}
  for (const step of Object.keys(START_DEFAULTS) as StartStep[]) {
    const entry: unknown = (value as Record<string, unknown>)[step]
    if (typeof entry !== "object" || entry === null) continue
    const { usual, built } = entry as Record<string, unknown>
    times[step] = {
      ...(isDuration(usual) ? { usual } : {}),
      ...(isDuration(built) ? { built } : {}),
    }
  }
  return times
}

export const encodeStartTimes = (times: StartTimes): string =>
  `${JSON.stringify(times, null, 2)}\n`
