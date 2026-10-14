// host/work/adapter — what a kind of project gives lane work: its
// `Destination`, each lane's `LaneHistory`, and what startup reads of it.
// `host/project.ts` chooses the adapter, by the project's kind, and lane work
// takes it as a value: nothing here names a kind.
//
// It comes in two stages, as startup needs it: opened where startup reads
// your repo's names, before the lanes' configs, which read through it; then
// started once lane work has its registry, which the adapter's own parts
// (fetches, splits) run on.

import type { CommitId, EntryId, ThreadId, WriterId } from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import type {
  BaseCheckout,
  LaneHistory,
  LaneRunners,
  SharedDir,
  WrittenRepo,
} from "@pinetrie/lanes"
import type { PiSetup } from "@pinetrie/pi"
import type { StackMessage } from "@pinetrie/rules"
import type { Basics } from "../basics.ts"
import type { Records } from "../records.ts"
import type { Destination } from "./destination.ts"
import type { LaneRegistry } from "./registry.ts"

/** A kind of project's adapter, before startup opens it. */
export interface ProjectAdapter {
  /**
   * Open the project, with the names your config and the project's
   * `pinetrie.json` wrote: before anything else reads it.
   */
  open(input: {
    readonly written: {
      readonly user: WrittenRepo
      readonly project: WrittenRepo
    }
    readonly basics: Basics
  }): Promise<OpenProject>
}

/** What `prepareShared` answers: the shared directories, and those refused. */
export interface SharedPrepared {
  readonly shared: readonly SharedDir[]
  readonly refused: readonly {
    readonly path: string
    readonly reason: string
  }[]
}

/** The project as startup reads it, before lane work starts. */
export interface OpenProject {
  /** `Destination.fileAt`, before the destination is whole. */
  readonly fileAt: Destination["fileAt"]
  /**
   * The shared directories that apply, prepared: made where missing, kept out
   * of what the project tracks, and named in the lanes' ignore file.
   */
  prepareShared(entries: {
    readonly user: readonly string[]
    readonly project: readonly string[]
  }): Promise<SharedPrepared>
  /** The identity lanes commit as: yours, else pine·trie's agent's. */
  identity(): Promise<{ readonly name: string; readonly email: string }>
  /** Accepted work's commits now: none before it is set up. */
  acceptedNow(): Promise<readonly CommitId[]>
  /** The base's checkout of `yours`, on a fresh disk or on the base before. */
  baseSteps(input: {
    readonly yours: readonly CommitId[]
    readonly fresh: boolean
  }): BaseCheckout
  /** Lane work's parts in, the adapter's whole parts out. */
  start(parts: ProjectParts): StartedProject
}

/** What the adapter's own parts run on, from lane work. */
export interface ProjectParts {
  readonly basics: Basics
  readonly records: Pick<Records, "writeValues">
  readonly piSetup: Pick<PiSetup, "skill" | "complete">
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  readonly registry: LaneRegistry
  /** Start a lane's container, from a step on its queue. */
  readonly startContainer: (lane: ThreadId, h: LaneHistory) => Promise<void>
  /** Queue a lane's container to start before a run. */
  readonly beforeRun: (lane: ThreadId) => void
  /** Accepted work moved: the base snapshot follows. */
  readonly acceptedMoved: () => void
  /** A lane's base record changed. */
  readonly baseChanged: (lane: ThreadId) => void
}

/** What a split is, to the host: its run's prompt, and its end. */
export interface Splits {
  /** The prompt of a split's run: the stack's span and the skill. */
  prepareSplit(
    lane: ThreadId,
    by: WriterId,
    /** The split card's text: what the person asked of it. */
    intent: string,
  ): Promise<StackMessage | { readonly refused: string }>
  /** A split's run ended: its stack, checked, becomes the offer, or why not. */
  splitEnded(lane: ThreadId, prompt: EntryId): Promise<string | null>
}

/** The adapter, started. */
export interface StartedProject {
  readonly destination: Destination
  /** `lane`'s history over its runners; only `withHistory` asks for one. */
  history(lane: ThreadId, runners: LaneRunners): LaneHistory
  readonly splits: Splits
}
