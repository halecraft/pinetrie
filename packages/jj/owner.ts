// The one writer of your repo, and the only thing that knows the head. Writes
// run on it one at a time, commands first; reads are pinned to the head it
// last observed.

import { type FSWatcher, watch } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import type { AcceptedFacts, RepoConfig, ThreadId } from "@pinetrie/core"
import { createKeeper, type SlowStep } from "@pinetrie/keeper"
import type { Runner } from "@pinetrie/lanes"

import { acceptedFacts } from "./accepted.ts"
import {
  type Fingerprint,
  fingerprintRead,
  type Moved,
  parseFingerprint,
  planObserve,
} from "./observe.ts"
import { planImport } from "./plan.ts"
import {
  type BytesStream,
  bytesFor,
  type CommandWatch,
  executeRepo,
  operationGone,
  runnerFor,
  type TimedCommand,
} from "./run.ts"
import { readShared, type SharedFacts } from "./shared.ts"
import type { RepoStep } from "./step.ts"
import {
  createStepTimes,
  NO_SPLIT,
  type StepSplit,
  type StepTimes,
} from "./step-times.ts"

/** jj and git on your repo, as the owner hands them to a step. */
export interface RepoOps {
  /** jj as the host: `--ignore-working-copy`, `operation.username=pinetrie-host`. */
  readonly jj: Runner
  /** jj as you, for a step that moves the working copy or lands your work. */
  readonly jjAsYou: Runner
  readonly git: Runner
  /** Carry out a repo plan's steps: the only way a `RepoStep` runs. */
  execute(steps: readonly RepoStep[]): Promise<void>
  /**
   * What every lane's refresh reads, as the head is now (`SharedFacts`): read
   * once per operation, and again once the head moves, a write of this
   * step's included.
   */
  shared(): Promise<SharedFacts>
  /** What accepted work's record reads (`acceptedFacts`), as the head is now: kept as `shared` is. */
  acceptedFacts(): Promise<AcceptedFacts>
  /**
   * Time `work` as a named part of this step, for its slow report
   * (`RepoSlowStep`). Parts run one after another, or one inside another.
   */
  part<T>(name: string, work: () => Promise<T>): Promise<T>
}

/** A slow step on the owner, and where its time went: its parts, the shared facts and observations among them, and its commands. */
export interface RepoSlowStep extends SlowStep {
  readonly split: StepSplit
}

/** What a read may run: jj pinned to the last observed operation, its stdout as text or as bytes, and git. */
export type RepoReads = Pick<RepoOps, "jj" | "git"> & {
  readonly jjBytes: BytesStream
}

export type RepoKey = `refresh:${ThreadId}` | "accepted" | "observe" | "shared"

/** What a step on the owner may read and run: at the head, unpinned. */
export type OwnedStep<T> = (ops: RepoOps) => Promise<T>

export interface RepoOwner {
  /** A command someone waits on. */
  command<T>(step: OwnedStep<T>): Promise<T>
  /** Upkeep, at most one queued per key. */
  later(key: RepoKey, step: OwnedStep<void>): Promise<void>
  /** Pure reads at the head the owner last observed: never queued, never a write. */
  read<T>(go: (ops: RepoReads) => Promise<T>): Promise<T>
  /** A lane's bundle into your repo (`planImport`), as the host, as a command. */
  importLane(lane: ThreadId, bundle: string, stack: boolean): Promise<void>
  /** What moved, each time an observation finds a new head. */
  onMoved(listener: (moved: Moved) => void): () => void
  /**
   * The head observed, unless it is the one last observed, as upkeep. A
   * command of yours is otherwise observed when the watch hears it, which
   * no caller can wait for: `idle` can settle before the watch's event
   * comes.
   */
  observe(): Promise<void>
  /** Hold `work` in `idle` until it settles: a request outside the owner, say. */
  track<T>(work: Promise<T>): Promise<T>
  idle(): Promise<void>
  /**
   * Refuse every step from now on, finish the commands queued, drop the
   * upkeep not yet started, and stop watching. Upkeep only rebuilds records
   * from your repo, which the next start's first observation rebuilds
   * anyway: a refresh per lane, queued when accepted work moved, would
   * otherwise hold a shutdown for as long as they all take.
   */
  close(): void
}

/** Where your repo's operation heads are: `.jj/repo` is a file naming the repo in a secondary workspace. */
export async function headsDir(root: string): Promise<string> {
  const dotJj = path.join(root, ".jj")
  const repo = path.join(dotJj, "repo")
  const named = (await stat(repo)).isFile()
    ? path.resolve(dotJj, (await readFile(repo, "utf8")).trim())
    : repo
  return path.join(named, "op_heads", "heads")
}

/** An operation head's file name is its full id; anything else there (a lock) is not one. */
const isOpId = (name: string): boolean => /^[0-9a-f]{32,}$/.test(name)

export function startRepoOwner(input: {
  readonly root: string
  readonly repoConfig: RepoConfig
  readonly onError?: (error: unknown) => void
  readonly onSlow?: (step: RepoSlowStep) => void
  readonly slowMs?: number
  /** Each jj or git command, a step's or a read's, that ran longer than `slowCommandMs`. */
  readonly onSlowCommand?: (command: TimedCommand) => void
  /** Default 500 ms. */
  readonly slowCommandMs?: number
  /** Each jj or git command, a step's or a read's, as it ends: what a check counts. */
  readonly onCommand?: (command: TimedCommand) => void
  /** How often the heads are listed without an event; default 5 s. */
  readonly backstopMs?: number
}): RepoOwner {
  const { root, repoConfig } = input
  const { onSlow } = input
  /** The running step's times: the keeper runs one step at a time. */
  let current: StepTimes | null = null
  const keeper = createKeeper<RepoKey, StepTimes>({
    context: {
      open: () => {
        current = createStepTimes(() => performance.now())
        return current
      },
      close: () => {
        current = null
      },
    },
    ...(input.onError === undefined ? {} : { onError: input.onError }),
    ...(onSlow === undefined
      ? {}
      : {
          onSlow: (step: SlowStep, times: StepTimes | null) =>
            onSlow({ ...step, split: times?.split() ?? NO_SPLIT }),
        }),
    ...(input.slowMs === undefined ? {} : { slowMs: input.slowMs }),
  })
  const listeners = new Set<(moved: Moved) => void>()
  const slowCommandMs = input.slowCommandMs ?? 500
  /** A command watch; a step's commands count toward its times, a pinned read's, run beside it, do not. */
  const commandWatch =
    (counts: boolean): CommandWatch =>
    command => {
      input.onCommand?.(command)
      if (counts) current?.command(command.ms)
      if (command.ms > slowCommandMs) input.onSlowCommand?.(command)
    }
  const timed = commandWatch(true)
  /** Every runner a step reaches, each command of it watched. */
  const runner = (as: Parameters<typeof runnerFor>[1]) =>
    runnerFor(root, as, timed)
  const readRunner = (at: string) =>
    runnerFor(root, { at }, commandWatch(false))
  const host = runner("host")
  const git = runner("git")
  let seen: Fingerprint | null = null
  const first = Promise.withResolvers<void>()

  /** Merge the heads, name the result, and say what moved since the last. */
  async function observe(): Promise<void> {
    const started = performance.now()
    try {
      await observeNow()
    } finally {
      const ran = performance.now() - started
      if (ran > (input.slowMs ?? 1_000))
        onSlow?.({ key: "observe", waited: 0, ran, split: NO_SPLIT })
    }
  }
  async function observeNow(): Promise<void> {
    const ran = await host(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
    if (!ran.ok) throw new Error(`jj op log failed: ${ran.stderr.trim()}`)
    const op = ran.stdout.trim()
    if (op === seen?.op) return
    const read = await runner({ at: op })(fingerprintRead(repoConfig))
    if (!read.ok)
      throw new Error(`reading what moved failed: ${read.stderr.trim()}`)
    const next = parseFingerprint(op, read.stdout, repoConfig)
    const moved = planObserve(seen, next, repoConfig)
    seen = next
    first.resolve()
    for (const listener of listeners) listener(moved)
  }
  /** Whether the one head is the one observed: listing the heads costs no jj process. */
  const isHeadSeen = async (): Promise<boolean> => {
    const heads = (await readdir(await headsDir(root))).filter(isOpId)
    return heads.length === 1 && heads[0] === seen?.op
  }
  // Looked again when it runs: a step's own write is observed by the step,
  // after the watch heard it and queued this.
  const queueObserve = () =>
    keeper.later("observe", async () => {
      if (!(await isHeadSeen())) await observeNow()
    })

  /**
   * The shared facts at the head as it is at the moment of reading: the one
   * file in the heads directory. A head that is not the one observed (an
   * outside write, or two heads) is observed first, which merges them. Only
   * a step calls it, so nothing writes between the look and the read.
   */
  let kept: SharedFacts | null = null
  async function shared(): Promise<SharedFacts> {
    if (!(await isHeadSeen())) await observeNow()
    const op = seen?.op
    if (op === undefined) throw new Error("your repo has no operation to read")
    if (kept?.op !== op)
      kept = await readShared(op, runner({ at: op }), repoConfig)
    return kept
  }
  let keptAccepted: {
    readonly op: string
    readonly facts: AcceptedFacts
  } | null = null
  /** Accepted work's record's facts at the head `shared` reads, once per operation. */
  async function accepted(): Promise<AcceptedFacts> {
    const { op } = await shared()
    if (keptAccepted?.op !== op)
      keptAccepted = {
        op,
        facts: await acceptedFacts(runner({ at: op }), git, repoConfig),
      }
    return keptAccepted.facts
  }

  /** A step's ops, flagging the step as one that wrote, its parts timed in `times`. */
  /** An observation inside a step, timed as its part; a failure is the step's to log, not to throw. */
  const observeIn = (times: StepTimes) =>
    times.part("observe", observe).catch(e => input.onError?.(e))

  function opsOf(wrote: { value: boolean }, times: StepTimes): RepoOps {
    const asYou = runner("you")
    return {
      jj: host,
      jjAsYou: args => {
        wrote.value = true
        return asYou(args)
      },
      git,
      shared: () => times.part("shared facts", shared),
      acceptedFacts: () => times.part("accepted facts", accepted),
      part: (name, work) => times.part(name, work),
      async execute(steps) {
        if (steps.length === 0) return
        try {
          await times.part("steps", () => executeRepo(root, steps, timed))
        } finally {
          await observeIn(times)
        }
      },
    }
  }
  const owned =
    <T>(step: OwnedStep<T>) =>
    async (times: StepTimes): Promise<T> => {
      const wrote = { value: false }
      const ops = opsOf(wrote, times)
      try {
        return await step(ops)
      } finally {
        if (wrote.value) await observeIn(times)
      }
    }

  /** `pinned`'s bytes: a file read whole at the last observed head. */
  const pinnedBytes: BytesStream = async function* (args) {
    await first.promise
    yield* bytesFor(root, { at: seen?.op ?? "" })(args)
  }

  /** jj pinned to the last observed head; once its operation is gone, observed again and retried once. */
  const pinned: Runner = async args => {
    await first.promise
    const at = seen?.op ?? ""
    const ran = await readRunner(at)(args)
    if (!operationGone(ran)) return ran
    await keeper.once("observe", observeNow)
    return readRunner(seen?.op ?? at)(args)
  }

  // The watch, and its backstop: a head that is not the last observed queues
  // an observation. A failed listing is the backstop's to retry.
  let watcher: FSWatcher | null = null
  let closed = false
  const check = () =>
    void (async () => {
      if (closed) return
      if (await isHeadSeen()) return
      void queueObserve()
    })().catch(() => {})
  void headsDir(root)
    .then(dir => {
      if (closed) return
      watcher = watch(dir, check)
      watcher.on("error", () => {})
    })
    .catch(() => {})
  const backstop = setInterval(check, input.backstopMs ?? 5_000)
  backstop.unref?.()
  // The first observation reports everything (`planObserve`'s `all`).
  void queueObserve()

  return {
    command: step => keeper.run(owned(step)),
    later: (key, step) => keeper.later(key, owned(step)),
    read: go => go({ jj: pinned, git, jjBytes: pinnedBytes }),
    importLane: (lane, bundle, stack) =>
      keeper.run(
        owned(ops => ops.execute(planImport({ lane, bundle, stack }))),
      ),
    onMoved(listener) {
      listeners.add(listener)
      // A listener that joins after the first observation hears it as one:
      // everything moved, for it, but accepted work's bookmark, as on a first
      // observation (`planObserve`).
      if (seen !== null)
        queueMicrotask(() => {
          if (listeners.has(listener))
            listener({
              all: true,
              acceptedMoved: false,
              published: true,
              workingCopy: true,
              lanes: new Set(),
              proposed: new Set(),
            })
        })
      return () => listeners.delete(listener)
    },
    observe: () => queueObserve(),
    track: work => keeper.track(work),
    idle: () => keeper.idle(),
    close() {
      closed = true
      clearInterval(backstop)
      watcher?.close()
      keeper.close("drop")
      // A read waiting for a first observation that will never come.
      first.resolve()
    },
  }
}
