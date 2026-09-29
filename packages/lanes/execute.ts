// lanes/execute — carrying out a list of `LaneStep`s, in order.

import { writeFile } from "node:fs/promises"
import type { LaneStep } from "./plan.ts"
import {
  type BytesRunner,
  describeFailure,
  hostRunner,
  type Ran,
  type Runner,
} from "./run.ts"

/** Where steps run: the host, and the lane's helper channel. */
export interface Runners {
  readonly host: Runner
  readonly lane: Runner
  readonly laneBytes: BytesRunner
}

export type Executed =
  | { readonly ok: true }
  | { readonly ok: false; readonly step: LaneStep; readonly ran: Ran<unknown> }

/**
 * Run `steps` in order, each on the host or in the lane, and stop at the
 * first that fails. A lane step with `stdoutTo` writes its stdout, as bytes,
 * to that host file.
 */
export async function execute(
  steps: readonly LaneStep[],
  runners: Runners,
): Promise<Executed> {
  for (const step of steps) {
    let ran: Ran<unknown>
    if (step.in === "host") ran = await runners.host(step.argv)
    else if (step.stdoutTo === undefined) ran = await runners.lane(step.argv)
    else {
      const bytes = await runners.laneBytes(step.argv)
      if (bytes.ok) await writeFile(step.stdoutTo, bytes.stdout)
      ran = bytes
    }
    if (!ran.ok) return { ok: false, step, ran }
  }
  return { ok: true }
}

/** `execute`, throwing the first failure as an error naming its command. */
export async function executeOrThrow(
  steps: readonly LaneStep[],
  runners: Runners,
): Promise<void> {
  const done = await execute(steps, runners)
  if (!done.ok)
    throw new Error(
      describeFailure(`${done.step.in}: ${done.step.argv.join(" ")}`, done.ran),
    )
}

const noLane: Runner = async argv => ({
  ok: false,
  code: -1,
  stdout: "",
  stderr: `a host-only plan has a lane step: ${argv.join(" ")}`,
})

/** `executeOrThrow` for a plan of host steps only: your repo, never a lane. */
export const executeOnHost = (steps: readonly LaneStep[]): Promise<void> =>
  executeOrThrow(steps, {
    host: hostRunner(),
    lane: noLane,
    laneBytes: async argv => ({
      ...(await noLane(argv)),
      stdout: new Uint8Array(),
    }),
  })
