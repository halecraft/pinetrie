// vm/keep — a host's lease, kept: when it ends without the host closing it
// (the launcher stopped or died, and the VM with it), the host leases again,
// which starts a VM, and settles the new lease as it did the first.

/** What `keepLease` holds: a lease that can end, and be closed. */
export interface Endable {
  /** Settles when the lease ends without `close`. */
  readonly ended: Promise<void>
  close(): Promise<void>
}

export interface Kept<L extends Endable> {
  /** The lease held now. */
  current(): L
  /** Close the lease held now; no other is taken after. */
  close(): Promise<void>
}

/**
 * Hold `first`, and each lease after it: when one ends, lease again
 * (`lease`), then `settle` it, retrying with a wait that doubles from 1 s to
 * 30 s until one settles or `close` is called.
 */
export function keepLease<L extends Endable>(input: {
  readonly first: L
  readonly lease: () => Promise<L>
  readonly settle: (lease: L) => Promise<void>
  readonly log: (line: string) => void
  readonly wait?: (ms: number) => Promise<void>
}): Kept<L> {
  const wait =
    input.wait ?? ((ms: number) => new Promise(r => setTimeout(r, ms)))
  let held = input.first
  let closing = false

  async function again(): Promise<void> {
    input.log(
      "[host] this host's lease on the lane VM ended (its launcher stopped): leasing again",
    )
    for (let ms = 1000; !closing; ms = Math.min(ms * 2, 30_000)) {
      try {
        const next = await input.lease()
        if (closing) {
          await next.close()
          return
        }
        await input.settle(next)
        held = next
        input.log("[host] leased the lane VM again")
        watch(next)
        return
      } catch (error) {
        input.log(
          `[host] leasing the lane VM again failed: ${error instanceof Error ? error.message : String(error)}; trying again in ${ms / 1000} s`,
        )
        await wait(ms)
      }
    }
  }

  function watch(lease: L): void {
    void lease.ended.then(() => {
      if (!closing && held === lease) return again()
    })
  }
  watch(held)

  return {
    current: () => held,
    async close() {
      closing = true
      await held.close()
    },
  }
}
