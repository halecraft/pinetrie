// host/machine/diagnostics — the Machine page's Copy diagnostics: one text
// of the page's words, the measurements' last rows under the export's own
// heading, and, on the Mac, the tails of the lane VM's logs. The host keeps
// no log of its own: its terminal holds it.

import { readFile } from "node:fs/promises"
import path from "node:path"
import type { MachinePageFacts } from "@pinetrie/core"
import {
  type MachinePageView,
  machinePageLines,
  machinePageView,
  machinePageWords,
} from "@pinetrie/interface"
import { readVmLogTail, type VmLog } from "@pinetrie/vm"
import {
  type HostMeasurements,
  type MeasuredOn,
  measurementsHeading,
} from "./measurements.ts"

/** How many of the measurements' rows the diagnostics hold, the newest. */
export const DIAGNOSTIC_ROWS = 200
/** How many lines of each of the VM's logs they hold. */
export const LOG_TAIL_LINES = 100

/** One log's tail, or null where it is not there. */
export interface LogTail {
  readonly file: string
  readonly lines: readonly string[] | null
}

/** The newest `count` of the export's rows, by each row's `at`, oldest first: the export lists them table by table. */
export function newestRows(
  rows: readonly string[],
  count: number,
): readonly string[] {
  const at = (row: string): number => {
    try {
      const { at } = JSON.parse(row) as { at?: unknown }
      return typeof at === "number" ? at : 0
    } catch {
      return 0
    }
  }
  return rows
    .map(row => ({ row, at: at(row) }))
    .sort((a, b) => a.at - b.at)
    .slice(-count)
    .map(r => r.row)
}

export function diagnosticsText(
  view: MachinePageView,
  measured: {
    /** The export's heading line: what was measured on, the host's version among it. */
    readonly heading: string
    /** Every row of the export, oldest first within each table. */
    readonly rows: readonly string[]
  },
  logTails: readonly LogTail[],
): string {
  return [
    ...machinePageLines(machinePageWords(view)),
    "",
    "Measurements:",
    measured.heading,
    ...newestRows(measured.rows, DIAGNOSTIC_ROWS),
    ...logTails.flatMap(t => [
      "",
      `${t.file}:`,
      ...(t.lines === null ? ["  not there"] : t.lines),
    ]),
    "",
  ].join("\n")
}

/** The install's version, from its `package.json`; null where it cannot be read. */
export async function hostVersion(root: string): Promise<string | null> {
  try {
    const { version } = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as { version?: unknown }
    return typeof version === "string" ? version : null
  } catch {
    return null
  }
}

const VM_LOGS: readonly VmLog[] = ["console.log", "launcher.log"]

/** The diagnostics now: the page's facts as words, a day of measurements, and on the Mac the VM's logs. */
export async function gatherDiagnostics(deps: {
  readonly facts: () => MachinePageFacts | null
  readonly measurements: Pick<HostMeasurements, "exportRows">
  readonly measuredOn: MeasuredOn
  /** The lane VM's state directory, where its logs are; null where lanes run on no VM. */
  readonly vmStateDir: string | null
}): Promise<string> {
  const { vmStateDir } = deps
  const logTails =
    vmStateDir === null
      ? []
      : await Promise.all(
          VM_LOGS.map(async file => ({
            file,
            lines: await readVmLogTail(vmStateDir, file, LOG_TAIL_LINES),
          })),
        )
  return diagnosticsText(
    machinePageView(deps.facts(), () => null),
    {
      heading: measurementsHeading(deps.measuredOn, 1),
      rows: deps.measurements.exportRows(1),
    },
    logTails,
  )
}
