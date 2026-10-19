// keeper — one step at a time on a resource that needs exclusive access: the
// host's documents, your repo, a lane's names.
//
// A step runs after every step queued before it, whether they failed or not:
// one must never stop the ones behind it. That is why this is not
// `@pinetrie/lanes`' `createQueue`, which a fatal failure breaks until `reset`,
// as a lane's disk needs.
//
// Steps are of two kinds. `run` and `once` are steps someone waits on, in the
// order queued. `later` is upkeep: it starts only when no `run` or `once` step
// waits. `once` and `later` merge by key: a step queued and not yet started
// covers every call with its key until it starts.
//
// A keeper made with a step context hands each step a value of its own: made
// as the step starts, and closed once the step settles. What a step reaches
// through it is that step's alone.
//
// Closing refuses new steps. The upkeep queued and not yet started is
// finished or dropped, as the closer says: upkeep that only rebuilds what the
// next start rebuilds anyway is not worth a shutdown that waits on it.

/** What a closed keeper's steps reject with. */
export class KeeperClosed extends Error {
  constructor() {
    super("the host is shutting down")
    this.name = "KeeperClosed"
  }
}

/**
 * A step that ran longer than `slowMs`, or a `run` or `once` step that waited
 * longer. An upkeep step's wait is not counted: waiting is what upkeep does.
 */
export interface SlowStep {
  /** Its `once` or `later` key; null for a `run` step. */
  readonly key: string | null
  readonly waited: number
  readonly ran: number
}

/**
 * What each step of a keeper is handed. `close` runs once the step has
 * settled, whether it threw or not, and before the next step opens its own.
 */
export interface StepContext<C> {
  open(): C
  close(context: C): void
}

/**
 * Every promise a keeper returns is already handled: a caller may void it.
 * Awaiting it inside a function whose own promise is voided is not safe: that
 * function's promise then rejects unhandled. Nor is awaiting a step of the
 * same keeper inside one of its steps: the inner step waits for the outer one
 * to end, which waits for the inner.
 */
export interface Keeper<K extends string = never, C = void> {
  /** A step someone waits on: after every `run` and `once` step queued before it, before any `later` step not yet started. */
  run<T>(step: (context: C) => Promise<T>): Promise<T>
  /**
   * A `run` step queued at most once per key until it starts; a call while it
   * runs queues one more. Every caller gets the promise of the step that
   * covers its call.
   */
  once(key: K, step: (context: C) => Promise<void>): Promise<void>
  /**
   * Upkeep: queued once per key until it starts, and started only when no
   * `run` or `once` step waits. So a `later` step runs after every `run` and
   * `once` step queued before it starts.
   */
  later(key: K, step: (context: C) => Promise<void>): Promise<void>
  /** Hold `work` in `idle` until it settles. */
  track<T>(work: Promise<T>): Promise<T>
  /** Settles when nothing is queued, running or tracked, including what is added while it waits. */
  idle(): Promise<void>
  /**
   * Refuse every step from now on (`KeeperClosed`), and finish the running
   * step and every `run` and `once` step queued. Upkeep not yet started is
   * finished too, or with `"drop"` rejected with `KeeperClosed` unstarted.
   */
  close(upkeep: "finish" | "drop"): void
}

interface Entry<C> {
  readonly key: string | null
  readonly step: (context: C) => Promise<unknown>
  readonly queued: number
  readonly done: PromiseWithResolvers<unknown>
}

export function createKeeper<K extends string = never, C = void>(
  options: {
    /** What each step is handed; without one, `undefined`. */
    readonly context?: StepContext<C>
    /** Hears each failed step once; its callers still get the rejection. */
    readonly onError?: (error: unknown) => void
    /**
     * Called for each `SlowStep`, with the step's context, already closed:
     * what the step kept there says what it spent. Null when the context
     * never opened.
     */
    readonly onSlow?: (step: SlowStep, context: C | null) => void
    readonly slowMs?: number
    readonly now?: () => number
  } = {},
): Keeper<K, C> {
  type Queued = Entry<C>
  const now = options.now ?? (() => performance.now())
  const slowMs = options.slowMs ?? 1000
  /** `run` and `once` steps, in the order queued. */
  const waiting: Queued[] = []
  /** `later` steps, in the order queued. */
  const upkeep: Queued[] = []
  /** Keyed steps queued and not yet started. */
  const onceQueued = new Map<string, Queued>()
  const laterQueued = new Map<string, Queued>()
  const tracked = new Set<Promise<unknown>>()
  const listeners = new Set<() => void>()
  let running = false
  let scheduled = false
  let closed = false

  const notify = () => {
    for (const listener of listeners) listener()
    listeners.clear()
  }

  function entry(
    key: string | null,
    step: (context: C) => Promise<unknown>,
  ): Queued {
    const done = Promise.withResolvers<unknown>()
    done.promise.catch(error => options.onError?.(error))
    return { key, step, queued: now(), done }
  }

  /** Start the next step, a microtask from now, so a call queued beside it in the same turn is weighed too. */
  function schedule(): void {
    if (running || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      const isUpkeep = waiting.length === 0
      const next = waiting.shift() ?? upkeep.shift()
      if (next === undefined) return notify()
      if (next.key !== null) {
        if (onceQueued.get(next.key) === next) onceQueued.delete(next.key)
        if (laterQueued.get(next.key) === next) laterQueued.delete(next.key)
      }
      running = true
      const started = now()
      const { context } = options
      let opened: { readonly value: C } | null = null
      const finish = () => {
        if (context !== undefined && opened !== null)
          try {
            context.close(opened.value)
          } catch (error) {
            options.onError?.(error)
          }
        const ran = now() - started
        const waited = started - next.queued
        if (ran > slowMs || (!isUpkeep && waited > slowMs))
          options.onSlow?.(
            { key: next.key, waited, ran },
            opened === null ? null : opened.value,
          )
        running = false
        schedule()
        notify()
      }
      new Promise(resolve => {
        opened = {
          value: context === undefined ? (undefined as C) : context.open(),
        }
        resolve(next.step(opened.value))
      }).then(
        value => {
          next.done.resolve(value)
          finish()
        },
        error => {
          next.done.reject(error)
          finish()
        },
      )
    })
  }

  const refused = (): Promise<never> => {
    const refusal = Promise.reject(new KeeperClosed())
    refusal.catch(() => {})
    return refusal
  }

  function queue(
    into: Queued[],
    keyed: Map<string, Queued> | null,
    key: string | null,
    step: (context: C) => Promise<unknown>,
  ): Promise<unknown> {
    if (closed) return refused()
    const covering = key === null ? undefined : keyed?.get(key)
    if (covering !== undefined) return covering.done.promise
    const next = entry(key, step)
    into.push(next)
    if (key !== null) keyed?.set(key, next)
    schedule()
    return next.done.promise
  }

  return {
    run: <T>(step: (context: C) => Promise<T>) =>
      queue(waiting, null, null, step) as Promise<T>,
    once: (key, step) => queue(waiting, onceQueued, key, step) as Promise<void>,
    later: (key, step) =>
      queue(upkeep, laterQueued, key, step) as Promise<void>,
    track(work) {
      tracked.add(work)
      const done = () => {
        tracked.delete(work)
        notify()
      }
      work.then(done, done)
      return work
    },
    async idle() {
      while (
        running ||
        scheduled ||
        waiting.length > 0 ||
        upkeep.length > 0 ||
        tracked.size > 0
      )
        await new Promise<void>(resolve => listeners.add(resolve))
    },
    close(queued) {
      closed = true
      if (queued === "finish") return
      const dropped = upkeep.splice(0)
      laterQueued.clear()
      for (const step of dropped) step.done.reject(new KeeperClosed())
      // `idle` waits on what was queued: it may have nothing left to wait for.
      notify()
    },
  }
}
