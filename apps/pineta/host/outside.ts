// host/outside — a model request made outside the serial executor, and its
// answer written inside it. A request takes seconds, and no other command
// may wait on it; what it answers is written in a step of its own, after
// the step decides it is still wanted. Banners, commit messages and asks'
// digests share it (ADR-0050, ADR-0038, ADR-0056); each keeps its decisions
// pure (`bannerDue`, `digestDue`, `digestStillWanted`, the offer's checks).

import type { Serial } from "./queue.ts"

/**
 * Ask outside the queue, tracked so `quiet` waits for it; then `settle`, as
 * one step, with the answer, which it writes only if still wanted. A null
 * answer writes nothing. A failure goes to `failed`, never to the caller.
 * With `held`, its key is in the set while the request is out, for the
 * caller's plan to read.
 */
export function requestOutside<R, K = never>(input: {
  readonly serial: Pick<Serial, "run" | "track">
  /** Outside the queue: gather what it needs and ask. Null for nothing to write. */
  readonly request: () => Promise<R | null>
  /** Inside the queue, after the request: decide whether it is still wanted, and write. */
  readonly settle: (answer: R) => Promise<void>
  readonly failed: (error: unknown) => void
  readonly held?: { readonly set: Set<K>; readonly key: K }
}): Promise<void> {
  const { serial, held } = input
  held?.set.add(held.key)
  return serial.track(
    (async () => {
      try {
        const answer = await input.request()
        if (answer !== null) await serial.run(() => input.settle(answer))
      } catch (error) {
        input.failed(error)
      } finally {
        held?.set.delete(held.key)
      }
    })(),
  )
}
