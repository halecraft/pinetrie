// host/offers/watch — your own jj operations: your repo's operation head is
// read every 2 s, and a new one refreshes the line's record and each open
// offer. So does the first read, so a host that just started checks each
// offer once: its last record may have been lost with the host before (S73).

import type { LaneName } from "@pineta/core"
import { readOffers } from "@pineta/reads"
import type { OfferState } from "./state.ts"

/** How often your repo's operation head is read. */
const POLL_MS = 2_000

/**
 * What one read of your repo's operation head means. The same head changes
 * nothing; the first read, and a new head, refresh the line and touch every
 * open offer.
 */
export function planPoll(input: {
  readonly last: string | null
  readonly op: string
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
    touch: moved ? input.open : [],
  }
}

/** Poll your repo: `line` refreshes the line's record, `touch` one lane's offer. */
export function startWatch(
  state: Pick<OfferState, "ops" | "basics">,
  on: { line(): void; touch(lane: LaneName): void },
): { close(): void } {
  let last: string | null = null
  const poll = setInterval(() => {
    const open = [...readOffers(state.basics.doc).values()]
      .filter(o => o.taken === null)
      .map(o => o.lane)
    void state
      .ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
      .then(ran => {
        if (!ran.ok) return
        const planned = planPoll({ last, op: ran.stdout.trim(), open })
        last = planned.last
        if (planned.line) on.line()
        for (const lane of planned.touch) on.touch(lane)
      })
  }, POLL_MS)
  poll.unref?.()
  return { close: () => clearInterval(poll) }
}
