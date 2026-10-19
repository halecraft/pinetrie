// host/basics — what nearly every module of the host's shell takes, and how
// it reports a failure.

import { errorText, type RootId, type ThreadId } from "@pinetrie/core"
import type { StepSplit } from "@pinetrie/jj"
import { type Keeper, KeeperClosed, type SlowStep } from "@pinetrie/keeper"
import { readThreadName } from "@pinetrie/reads"
import type {
  LiveDocHandle,
  PlacesDocHandle,
  SessionDocHandle,
} from "@pinetrie/schema"
import type { HostDocuments } from "./docs.ts"
import type { Leases, StepDocs } from "./roots.ts"

export interface Basics {
  /** The session's records, the directory of roots among them. */
  readonly session: SessionDocHandle
  /** What is streaming now: which lanes run, and their streams. */
  readonly live: LiveDocHandle
  /** The documents always held (`docs.ts`); a root's is reached through `roots`. */
  readonly docs: HostDocuments
  /**
   * Where every card is: what is queued for each lane. Written only in a
   * change of the writer of the places (`places.ts`).
   */
  readonly places: PlacesDocHandle
  readonly log: (message: string) => void
  readonly newId: () => string
  readonly now: () => number
}

/**
 * `Basics` inside a step of the documents' keeper: the roots it reaches,
 * through its `StepDocs`. Only a step has one, so a module that needs a root
 * takes this, and a module made once at startup cannot reach one.
 */
export type StepBasics = Basics & { readonly roots: StepDocs }

/**
 * `Basics` for work off the documents' keeper that reads or writes a root:
 * lane work, which a step may await, takes a lease rather than a step.
 */
export type LeaseBasics = Basics & { readonly leases: Leases }

/** `basics` inside the step whose documents are `roots`. */
export const inStep = <B extends object>(
  basics: B,
  roots: StepDocs,
): B & { readonly roots: StepDocs } => ({ ...basics, roots })

/**
 * What the documents' keeper merges by: a lane's drain, a root's directory
 * record, and the upkeep (`roots.ts`).
 */
export type HostKey = `drain:${ThreadId}` | `root:${RootId}` | "upkeep"

/**
 * The documents' keeper: every command, drain and write of the host's. Each
 * step is handed its `StepDocs`.
 */
export type HostKeeper = Keeper<HostKey, StepDocs>

/**
 * A `.catch` handler that logs `[host] <thread>: <what> failed: <error>`,
 * or `[host] <what> failed: <error>` with no lane. A step a closed
 * keeper refused is not logged: shutdown refuses them on purpose.
 */
export function failed(
  basics: Pick<Basics, "session" | "log">,
  what: string,
  lane?: ThreadId,
): (error: unknown) => void {
  return error => {
    if (error instanceof KeeperClosed) return
    basics.log(
      lane === undefined
        ? `[host] ${what} failed: ${errorText(error)}`
        : `[host] ${readThreadName(basics.session, lane)}: ${what} failed: ${errorText(error)}`,
    )
  }
}

/**
 * A slow step's line: `[host] <where>: a step (<key>) waited <n> ms and ran
 * <n> ms`, with no `<where>: ` for the documents' keeper. A step on the owner
 * of your repo adds where its time went: each part of 1 ms or more, the rest,
 * and the jj and git commands, whose time is inside the parts.
 */
export function slowStepLine(
  where: string | undefined,
  step: SlowStep & { readonly split?: StepSplit },
): string {
  const ms = (n: number) => `${Math.round(n)} ms`
  const head = `[host] ${where === undefined ? "" : `${where}: `}a step${step.key === null ? "" : ` (${step.key})`} waited ${ms(step.waited)} and ran ${ms(step.ran)}`
  const split = step.split
  if (split === undefined) return head
  const { parts, commands } = split
  if (parts.length === 0 && commands.count === 0) return head
  const rest = step.ran - parts.reduce((n, p) => n + p.ms, 0)
  const spent = [
    ...parts.filter(p => p.ms >= 1).map(p => `${p.name} ${ms(p.ms)}`),
    ...(parts.length > 0 && rest >= 1 ? [`the rest ${ms(rest)}`] : []),
  ]
  const ran =
    commands.count === 0
      ? "no jj or git"
      : `jj and git ${ms(commands.ms)} of it, in ${commands.count} command${commands.count === 1 ? "" : "s"}`
  return `${head}: ${[...spent, ran].join(", ")}`
}

/** An `onSlow` handler that logs `slowStepLine`. */
export function slow(
  basics: Pick<Basics, "log">,
  where?: string,
): (step: SlowStep & { readonly split?: StepSplit }) => void {
  return s => basics.log(slowStepLine(where, s))
}
