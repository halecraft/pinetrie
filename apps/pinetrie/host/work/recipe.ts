// host/work/recipe — a lane's recipe run again when its inputs change: before a
// turn's snapshot and an update's, in one queued step with it
// (`snapshotOnQueue`), and when a lane's container is made anew. Its outputs
// are removed before it runs, so nothing it once wrote outlives the inputs it
// was made from.

import type { SnapshotId, ThreadId } from "@pinetrie/core"
import {
  DERIVED_FILE,
  executeOrThrow,
  isRecipeTouched,
  LANE_CONFIG_DIR,
  type LaneHandle,
  parseDerivedFacts,
  planRecipeCheck,
  planSnapshot,
  type Runner,
  runRecipe,
} from "@pinetrie/lanes"
import type { LaneChannel } from "@pinetrie/pi"
import { type Basics, failed } from "../basics.ts"
import type { Setup } from "./setup.ts"

/** What a recipe's check came to: not run, run, or run and failed. */
export type RecipeOutcome = "ran" | "failed" | null

/** A disk's end of a turn or an update: whether its snapshot was taken, and the recipe before it. */
export interface Ended {
  readonly snapped: boolean
  readonly outcome: RecipeOutcome
  readonly outputs: readonly string[]
}

export interface Recipes {
  /**
   * One step on the lane's queue: the recipe if `touched` calls for it
   * (`onQueue`), then the snapshot `snapshot`. Queued, so the next tool call
   * waits for both. A recipe that throws is reported and the snapshot taken
   * all the same; a snapshot that fails is reported, and `snapped` false.
   */
  snapshotOnQueue(
    lane: ThreadId,
    handle: LaneHandle<LaneChannel>,
    jj: Runner,
    touched: readonly string[] | "all",
    snapshot: SnapshotId,
  ): Promise<Ended>
  /**
   * On the lane's queue, inside a step already queued: the recipe run when
   * a path it reads changed (`touched`, or `all` when unknown) and the
   * disk's outputs were made from another key. Then the recipe's outputs:
   * those the disk recorded, and those a run removed and made.
   */
  onQueue(
    lane: ThreadId,
    handle: LaneHandle<LaneChannel>,
    jj: Runner,
    touched: readonly string[] | "all",
  ): Promise<{
    readonly outcome: RecipeOutcome
    readonly outputs: readonly string[]
  }>
}

export function createRecipes(deps: {
  readonly basics: Basics
  readonly setup: Pick<Setup, "lanes" | "ready" | "keyAt">
}): Recipes {
  const recipes: Recipes = {
    snapshotOnQueue: (lane, handle, jj, touched, snapshot) =>
      handle.queue
        .enqueue(async () => {
          const recipe = await recipes
            .onQueue(lane, handle, jj, touched)
            .catch(error => {
              failed(deps.basics, "the recipe", lane)(error)
              return { outcome: null, outputs: [] as readonly string[] }
            })
          await executeOrThrow(planSnapshot({ lane, snapshot }), handle.runners)
          return { snapped: true, ...recipe }
        })
        .catch(error => {
          failed(deps.basics, "the snapshot", lane)(error)
          return { snapped: false, outcome: null, outputs: [] }
        }),
    async onQueue(lane, handle, jj, touched) {
      const { recipe } = deps.setup.lanes.config
      const read = await handle.runners.lane([
        "cat",
        `${LANE_CONFIG_DIR}/${DERIVED_FILE}`,
      ])
      const derived = parseDerivedFacts(read.ok ? read.stdout : null)
      if (recipe === null || !isRecipeTouched(recipe, touched))
        return { outcome: null, outputs: derived.outputs }
      const key = await deps.setup.keyAt(jj, "@", await deps.setup.ready)
      if (planRecipeCheck(derived, key) === "none")
        return { outcome: null, outputs: derived.outputs }
      const made = await runRecipe({
        runners: handle.runners,
        lane,
        recipe,
        key,
        outputs: derived.outputs,
        previous: derived.key,
      })
      return {
        outcome: made.failed === null ? "ran" : "failed",
        // The outputs it removed are the recipe's too, as are those it made.
        outputs: [...new Set([...derived.outputs, ...made.outputs])],
      }
    },
  }
  return recipes
}
