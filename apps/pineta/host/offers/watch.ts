// host/offers/watch — your own jj operations: your repo's operation head is
// read every 2 s, and a new one refreshes the line's record and touches each
// lane with an offer in your repo. So does the first read, so a host that
// just started checks each offer once.

import type { LaneName } from "@pineta/core"
import { offerNames } from "@pineta/lanes"
import { readNames, readOffers } from "@pineta/reads"
import { failed } from "../basics.ts"
import type { OfferState } from "./state.ts"

/** How often your repo's operation head is read. */
const POLL_MS = 2_000

/**
 * What one read of your repo's operation head means. The same head changes
 * nothing; the first read, and a new head, refresh the line and touch each
 * lane whose offer bookmark is in your repo, and each whose record is open.
 * The record is only a hint of where to look: it is how an offer you
 * abandoned by hand is built again.
 */
export function planPoll(input: {
  readonly last: string | null
  readonly op: string
  readonly bookmarked: readonly LaneName[]
  readonly open: readonly LaneName[]
}): {
  readonly last: string
  readonly line: boolean
  readonly touch: readonly LaneName[]
} {
  const moved = input.op !== input.last
  return {
    last: input.op,
    line: moved,
    touch: moved ? [...new Set([...input.bookmarked, ...input.open])] : [],
  }
}

/** Poll your repo: `line` refreshes the line's record, `touch` one lane's offer. */
export function startWatch(
  state: Pick<OfferState, "ops" | "basics" | "serial">,
  on: { line(): void; touch(lane: LaneName): void },
): { close(): void } {
  const { session: doc } = state.basics
  let last: string | null = null
  /** Lanes by the thread name their offer bookmark carries; read on the queue (S57). */
  const bookmarked = () =>
    state.serial.run(async () => {
      const lanes = new Map(
        [...readNames(doc)].map(([lane, name]) => [name, lane]),
      )
      return (await offerNames(state.ops)).flatMap(name => {
        const lane = lanes.get(name)
        return lane === undefined ? [] : [lane]
      })
    })
  const poll = setInterval(() => {
    void state
      .ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
      .then(async ran => {
        if (!ran.ok) return
        const op = ran.stdout.trim()
        // The same head: skip the bookmarks' read, which `planPoll` would
        // discard.
        if (op === last) return
        const planned = planPoll({
          last,
          op,
          bookmarked: await bookmarked(),
          open: [...readOffers(doc).values()]
            .filter(o => o.taken === null)
            .map(o => o.lane),
        })
        last = planned.last
        if (planned.line) on.line()
        for (const lane of planned.touch) on.touch(lane)
      })
      .catch(failed(state.basics, "watching your repo"))
  }, POLL_MS)
  poll.unref?.()
  return { close: () => clearInterval(poll) }
}
