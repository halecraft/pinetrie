// lanes/execute — carrying out a list of steps, in order.

import { writeFile } from "node:fs/promises"
import type { ThreadId } from "@pinetrie/core"
import type { ForkSteps, LaneStep, Step } from "./plan.ts"
import {
  type BytesRunner,
  describeFailure,
  type Ran,
  type Runner,
} from "./run.ts"
import type { LaneRuntime } from "./runtime-port.ts"

/** Where lane steps run: the lane's helper channel. */
export interface LaneRunners {
  readonly lane: Runner
  readonly laneBytes: BytesRunner
}

/** Where every step runs: the lane's channel, and the runtime that keeps it. */
export interface Runners extends LaneRunners {
  readonly runtime: LaneRuntime
}

/** The overloads' union: a list of lane steps needs no runtime. */
type SomeRunners = LaneRunners & { readonly runtime?: LaneRuntime }

export type Executed =
  | { readonly ok: true }
  | { readonly ok: false; readonly step: LaneStep; readonly ran: Ran<unknown> }

/**
 * Run `steps` in order and stop at the first lane step that fails; a runtime
 * operation that fails throws. A lane step with `stdoutTo` writes its stdout,
 * as bytes, to that host file.
 */
export function execute(
  steps: readonly LaneStep[],
  runners: LaneRunners,
): Promise<Executed>
export function execute(
  steps: readonly Step[],
  runners: Runners,
): Promise<Executed>
export function execute(
  steps: readonly Step[],
  runners: SomeRunners,
): Promise<Executed> {
  return runSteps(steps, runners)
}

async function runSteps(
  steps: readonly Step[],
  runners: SomeRunners,
): Promise<Executed> {
  for (const step of steps) {
    if (step.in === "runtime") {
      const { runtime } = runners
      if (runtime === undefined)
        throw new Error("a runtime step with no runtime to run it")
      if (step.op.kind === "run") await runtime.run(step.op.shape)
      else if (step.op.kind === "remove")
        await runtime.remove(step.op.container)
      else await runtime.disk(step.op)
      continue
    }
    let ran: Ran<unknown>
    if (step.stdoutTo === undefined) ran = await runners.lane(step.argv)
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
  runners: LaneRunners,
): Promise<void>
export async function executeOrThrow(
  steps: readonly Step[],
  runners: Runners,
): Promise<void>
export async function executeOrThrow(
  steps: readonly Step[],
  runners: SomeRunners,
): Promise<void> {
  const done = await runSteps(steps, runners)
  if (!done.ok)
    throw new Error(
      describeFailure(`lane: ${done.step.argv.join(" ")}`, done.ran),
    )
}

declare const forkedBrand: unique symbol
/** Proof that a fork's steps ran, its clearing first; only `executeFork` makes one. */
export interface Forked {
  readonly lane: ThreadId
  readonly [forkedBrand]: true
}

/** A fork's steps (`planFork`) run in order, throwing the first failure. */
export async function executeFork(
  fork: ForkSteps,
  runners: Runners,
): Promise<Forked> {
  await executeOrThrow(fork.steps, runners)
  return { lane: fork.lane } as Forked
}
