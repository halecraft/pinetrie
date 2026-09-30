// host/queue — the host's one serial executor.
//
// A step runs after every step queued before it, and after a failed one too:
// a host step (a command, a drain, a compaction) must never stop the ones
// behind it. That is why this is not `@pineta/lanes`' `createQueue`, which a
// fatal failure breaks until `reset`, as a lane's disk needs.

export interface Serial {
  /** Run `step` after every step queued before it, whether they failed or not. */
  run<T>(step: () => Promise<T>): Promise<T>
  /** Hold `work` in `idle` until it settles. */
  track<T>(work: Promise<T>): Promise<T>
  /**
   * Settles when no step is queued or running and nothing tracked is
   * pending, including steps and work added while it waits.
   */
  idle(): Promise<void>
}

/** `onError` hears each failed step; the step's own caller still gets the rejection. */
export function createSerial(onError?: (error: unknown) => void): Serial {
  let tail: Promise<unknown> = Promise.resolve()
  const tracked = new Set<Promise<unknown>>()
  return {
    run(step) {
      const next = tail.then(() => step())
      tail = next.catch(error => onError?.(error))
      return next
    },
    track(work) {
      tracked.add(work)
      const done = () => tracked.delete(work)
      work.then(done, done)
      return work
    },
    async idle() {
      for (;;) {
        const seen = tail
        await seen
        while (tracked.size > 0) await Promise.allSettled([...tracked])
        if (seen === tail) return
      }
    },
  }
}
