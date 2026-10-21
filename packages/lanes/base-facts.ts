// lanes/base-facts — what the base disk says it is (`base.json`): accepted
// work's states and the format of the steps that made it, and whether a
// base is current or may be copied.

import { type PointId, pointId, shellWord } from "@pinetrie/core"
import { LANE_CONFIG_DIR } from "./spec.ts"
import { type LaneStep, laneShell } from "./steps.ts"

/**
 * The version of the steps a base is made with: a base made by other steps
 * is not copied, and the next one starts empty.
 */
export const BASE_FORMAT = 3

/** The files of pine·trie's own a disk holds about itself, under `.pinetrie-lane/`. */
export const BASE_FILE = "base.json"

/** What the base disk is: accepted work's states, made by `format`'s steps. */
interface BaseFacts {
  readonly points: readonly PointId[]
  readonly format: number
}

/** `base.json` read; null when absent or not one. A base from before formats reads as format 0. */
export function parseBaseFacts(text: string | null): BaseFacts | null {
  if (text === null) return null
  try {
    const raw = JSON.parse(text) as { commits?: unknown; format?: unknown }
    if (
      !Array.isArray(raw.commits) ||
      !raw.commits.every(c => typeof c === "string")
    )
      return null
    return {
      points: raw.commits.map(c => pointId(String(c))),
      format: typeof raw.format === "number" ? raw.format : 0,
    }
  } catch {
    return null
  }
}

/** A JSON value written to `.pinetrie-lane/<file>` on the lane's disk. */
const writeLaneFile = (file: string, value: unknown): LaneStep =>
  laneShell(
    `mkdir -p ${LANE_CONFIG_DIR} && printf %s ${shellWord(JSON.stringify(value))} > ${LANE_CONFIG_DIR}/${file}`,
  )

/** The disk's registry of derived files, under `.pinetrie-lane/`. */
export const REGISTRY_FILE = "recipes.json"

/**
 * The base's facts at `points`, written on its disk before it is
 * snapshotted. The file's field stays `commits`: a disk's file is read by
 * its format, and the strings are the same.
 */
export const planBaseFacts = (points: readonly PointId[]): LaneStep =>
  writeLaneFile(BASE_FILE, { commits: points, format: BASE_FORMAT })

/** Whether the base disk holds `accepted`, made the way it is now: then a refresh does nothing. */
export const isBaseCurrent = (
  base: BaseFacts | null,
  accepted: readonly PointId[],
): boolean =>
  isCopyableBase(base) &&
  base.points.length === accepted.length &&
  base.points.every((p, i) => p === accepted[i])

/**
 * Whether a base is one the next is copied from. One made by other steps
 * may hold what nothing records: a base from before was made on a
 * dependency layer, whose outputs no registry names.
 */
export const isCopyableBase = (base: BaseFacts | null): base is BaseFacts =>
  base !== null && base.format === BASE_FORMAT
