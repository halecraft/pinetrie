// machine/rung — how short of memory the machine is, as a rung of the
// ladder: 0 calm, 1 squeeze, 2 hold starts, 3 pause at the gate, 4 freeze,
// 5 kill one command. Of these only 2 and 3 are acted on; 1, 4 and 5 are
// planned and measured, never done. Each rung is a level with the
// hysteresis the health value's causes have.

import {
  type LevelReading,
  nextLevelState,
  type Tracked,
} from "./hysteresis.ts"
import type { MachineSample } from "./sample.ts"

export type Rung = 0 | 1 | 2 | 3 | 4 | 5
const RUNGS: readonly Rung[] = [0, 1, 2, 3, 4, 5]

/** The rungs a level enters, lowest first. */
const LEVELS = [1, 2, 3, 4, 5] as const
type LevelRung = (typeof LEVELS)[number]

/**
 * A rung's bounds: PSI's `avg10`s, over which it enters and under which it
 * clears, and the share of memory available, under which it enters and over
 * which it clears. A rung reads only the bounds it names.
 */
export interface RungBounds {
  readonly enter: {
    readonly someAvg10?: number
    readonly fullAvg10?: number
    readonly availableShareBelow?: number
  }
  readonly clear: {
    readonly someAvg10?: number
    readonly fullAvg10?: number
    readonly availableShareAbove?: number
  }
}

/**
 * Every rung's bounds, named once. The PSI numbers were measured on
 * synthetic loads; the available shares keep rungs 2 and 3 entering before
 * 4 and 5. Each is to be tuned from the measurements of real use.
 */
export const RUNG_BOUNDS = {
  1: { enter: { someAvg10: 5 }, clear: { someAvg10: 1 } },
  2: {
    enter: { fullAvg10: 5, availableShareBelow: 0.1 },
    clear: { fullAvg10: 1, availableShareAbove: 0.15 },
  },
  3: {
    enter: { fullAvg10: 10, availableShareBelow: 0.05 },
    clear: { fullAvg10: 2, availableShareAbove: 0.1 },
  },
  4: {
    enter: { fullAvg10: 20, availableShareBelow: 0.05 },
    clear: { fullAvg10: 5, availableShareAbove: 0.15 },
  },
  5: {
    enter: { availableShareBelow: 0.02 },
    clear: { availableShareAbove: 0.08 },
  },
} as const satisfies Record<LevelRung, RungBounds>

export interface RungPlanState {
  readonly rung: Rung
  /** Each rung's level, by the rung it enters. */
  readonly levels: ReadonlyMap<LevelRung, Tracked<LevelRung>>
}

export const FIRST_RUNG_STATE: RungPlanState = { rung: 0, levels: new Map() }

type BoundReading = "over" | "between" | "clear" | "unmeasured"

/** One bound read: `over` past `enter`, `clear` past `clear`, between them else. */
const boundReading = (
  value: number | null,
  enter: number | undefined,
  clear: number | undefined,
  rising: boolean,
): BoundReading => {
  if (value === null || enter === undefined || clear === undefined)
    return "unmeasured"
  if (rising ? value > enter : value < enter) return "over"
  if (rising ? value < clear : value > clear) return "clear"
  return "between"
}

/**
 * A rung's level as this sample reads it: over when any bound it names is
 * over, clear only when every bound it could read is clear.
 */
function rungReading(
  rung: LevelRung,
  machine: MachineSample["machine"],
): LevelReading<LevelRung> {
  const { enter, clear }: RungBounds = RUNG_BOUNDS[rung]
  const { pressure, memoryTotal, memoryAvailable } = machine
  const share = memoryTotal > 0 ? memoryAvailable / memoryTotal : null
  const readings = [
    boundReading(
      pressure?.someAvg10 ?? null,
      enter.someAvg10,
      clear.someAvg10,
      true,
    ),
    boundReading(
      pressure?.fullAvg10 ?? null,
      enter.fullAvg10,
      clear.fullAvg10,
      true,
    ),
    boundReading(
      share,
      enter.availableShareBelow,
      clear.availableShareAbove,
      false,
    ),
  ].filter(r => r !== "unmeasured")
  if (readings.length === 0) return { kind: "unmeasured" }
  if (readings.includes("over")) return { kind: "over", value: rung }
  if (readings.every(r => r === "clear")) return { kind: "clear" }
  return { kind: "between", value: rung }
}

/**
 * The rung after one sample: the highest active level, moved at most one
 * step from the last, so a release lets go one rung's holds at a time.
 */
export function planRung(
  state: RungPlanState,
  machine: MachineSample["machine"],
): { readonly rung: Rung; readonly state: RungPlanState } {
  const levels = new Map<LevelRung, Tracked<LevelRung>>()
  for (const level of LEVELS) {
    const next = nextLevelState(
      state.levels.get(level),
      rungReading(level, machine),
    )
    if (next !== null) levels.set(level, next)
  }
  const highest = LEVELS.filter(l => levels.get(l)?.active === true).at(-1)
  const step = Math.sign((highest ?? 0) - state.rung)
  const rung = RUNGS[state.rung + step] ?? state.rung
  return { rung, state: { rung, levels } }
}
