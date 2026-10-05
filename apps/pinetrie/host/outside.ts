// host/outside — a model request made outside the documents' keeper, and its
// answer written inside it. A request takes seconds, and no other command
// may wait on it; what it answers is written in a step of its own, after
// the step decides it is still wanted. Banners, commit messages and asks'
// digests share it (ADR-0050, ADR-0038, ADR-0056); each keeps its decisions
// pure (`bannerDue`, `digestDue`, `digestToWrite`, the offer's checks).

import type { Keeper } from "@pinetrie/keeper"

/**
 * Ask outside the queue, tracked so `quiet` waits for it; then `settle`, as
 * one step, with the answer, which it writes only if still wanted. A null
 * answer writes nothing. A caller that needs your repo gathers first, by a
 * pinned read (`RepoOwner.read`), which writes nothing, and passes what it
 * read. A failure goes to `failed`, never to the caller.
 * With `held`, its key is in the set while the request is out, for the
 * caller's plan to read.
 */
export function requestOutside<R, K = never>(input: {
  readonly keeper: Pick<Keeper, "run" | "track">
  /** Outside the queue: gather from the document, and ask. Null for nothing to write. */
  readonly request: () => Promise<R | null>
  /** Inside the queue, after the request: decide whether it is still wanted, and write. */
  readonly settle: (answer: R) => Promise<void>
  readonly failed: (error: unknown) => void
  readonly held?: { readonly set: Set<K>; readonly key: K }
}): Promise<void> {
  const { keeper, held } = input
  held?.set.add(held.key)
  return keeper.track(
    (async () => {
      try {
        const answer = await input.request()
        if (answer !== null) await keeper.run(() => input.settle(answer))
      } catch (error) {
        input.failed(error)
      } finally {
        held?.set.delete(held.key)
      }
    })(),
  )
}
