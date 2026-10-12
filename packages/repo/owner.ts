// The one writer of your repo, and the only thing that knows the head. Writes
// run on it one at a time, commands first; reads are pinned to the head it
// last observed.

import { type FSWatcher, watch } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import type { ThreadId } from "@pinetrie/core"
import { createKeeper, type SlowStep } from "@pinetrie/keeper"
import type { RepoConfig, Runner } from "@pinetrie/lanes"
import {
  type Fingerprint,
  fingerprintRead,
  type Moved,
  parseFingerprint,
  planObserve,
} from "./observe.ts"
import { planImport } from "./plan.ts"
import { executeRepo, operationGone, runnerFor } from "./run.ts"
import { readShared, type SharedFacts } from "./shared.ts"
import type { RepoStep } from "./step.ts"

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
   * What accepted work's record and every lane's refresh read, as the head is now
   * (`SharedFacts`): read once per operation, and again once the head moves,
   * a write of this step's included.
   */
  shared(): Promise<SharedFacts>
}

/** What a read may run: jj pinned to the last observed operation, and git. */
export type RepoReads = Pick<RepoOps, "jj" | "git">

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
  /** Hold `work` in `idle` until it settles: a request outside the owner, say. */
  track<T>(work: Promise<T>): Promise<T>
  idle(): Promise<void>
  /** Refuse every step from now on, finish what is queued, and stop watching. */
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
  readonly onSlow?: (step: SlowStep) => void
  readonly slowMs?: number
  /** How often the heads are listed without an event; default 5 s. */
  readonly backstopMs?: number
}): RepoOwner {
  const { root, repoConfig } = input
  const keeper = createKeeper<RepoKey>({
    ...(input.onError === undefined ? {} : { onError: input.onError }),
    ...(input.onSlow === undefined ? {} : { onSlow: input.onSlow }),
    ...(input.slowMs === undefined ? {} : { slowMs: input.slowMs }),
  })
  const listeners = new Set<(moved: Moved) => void>()
  const host = runnerFor(root, "host")
  const git = runnerFor(root, "git")
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
        input.onSlow?.({ key: "observe", waited: 0, ran })
    }
  }
  async function observeNow(): Promise<void> {
    const ran = await host(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
    if (!ran.ok) throw new Error(`jj op log failed: ${ran.stderr.trim()}`)
    const op = ran.stdout.trim()
    if (op === seen?.op) return
    const read = await runnerFor(root, { at: op })(fingerprintRead(repoConfig))
    if (!read.ok)
      throw new Error(`reading what moved failed: ${read.stderr.trim()}`)
    const next = parseFingerprint(op, read.stdout, repoConfig)
    const moved = planObserve(seen, next, repoConfig)
    seen = next
    first.resolve()
    for (const listener of listeners) listener(moved)
  }
  const queueObserve = () => keeper.later("observe", observeNow)

  /**
   * The shared facts at the head as it is at the moment of reading: the one
   * file in the heads directory. A head that is not the one observed (an
   * outside write, or two heads) is observed first, which merges them. Only
   * a step calls it, so nothing writes between the look and the read.
   */
  let kept: SharedFacts | null = null
  async function shared(): Promise<SharedFacts> {
    const heads = (await readdir(await headsDir(root))).filter(isOpId)
    if (heads.length !== 1 || heads[0] !== seen?.op) await observeNow()
    const op = seen?.op
    if (op === undefined) throw new Error("your repo has no operation to read")
    if (kept?.op !== op)
      kept = await readShared(op, runnerFor(root, { at: op }), git, repoConfig)
    return kept
  }

  /** A step's ops, flagging the step as one that wrote. */
  function opsOf(wrote: { value: boolean }): RepoOps {
    const asYou = runnerFor(root, "you")
    return {
      jj: host,
      jjAsYou: args => {
        wrote.value = true
        return asYou(args)
      },
      git,
      shared,
      async execute(steps) {
        if (steps.length === 0) return
        try {
          await executeRepo(root, steps)
        } finally {
          await observe().catch(e => input.onError?.(e))
        }
      },
    }
  }
  const owned =
    <T>(step: OwnedStep<T>) =>
    async (): Promise<T> => {
      const wrote = { value: false }
      try {
        return await step(opsOf(wrote))
      } finally {
        if (wrote.value) await observe().catch(e => input.onError?.(e))
      }
    }

  /** jj pinned to the last observed head; once its operation is gone, observed again and retried once. */
  const pinned: Runner = async args => {
    await first.promise
    const at = seen?.op ?? ""
    const ran = await runnerFor(root, { at })(args)
    if (!operationGone(ran)) return ran
    await keeper.once("observe", observeNow)
    return runnerFor(root, { at: seen?.op ?? at })(args)
  }

  // The watch, and its backstop: a head that is not the last observed queues
  // an observation. A failed listing is the backstop's to retry.
  let watcher: FSWatcher | null = null
  let closed = false
  const check = () =>
    void (async () => {
      if (closed) return
      const heads = (await readdir(await headsDir(root))).filter(isOpId)
      if (heads.length === 1 && heads[0] === seen?.op) return
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
    read: go => go({ jj: pinned, git }),
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
              yours: true,
              lanes: new Set(),
              offers: new Set(),
            })
        })
      return () => listeners.delete(listener)
    },
    track: work => keeper.track(work),
    idle: () => keeper.idle(),
    close() {
      closed = true
      clearInterval(backstop)
      watcher?.close()
      keeper.close()
      // A read waiting for a first observation that will never come.
      first.resolve()
    },
  }
}
