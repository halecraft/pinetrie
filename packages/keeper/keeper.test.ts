import { describe, expect, test } from "vitest"
import { createKeeper, KeeperClosed } from "./index.ts"

const gate = () => Promise.withResolvers<void>()
/** Let every queued microtask and step run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe("run", () => {
  test("a step runs after a failed one, and the failure is heard once", async () => {
    const heard: unknown[] = []
    const keeper = createKeeper({ onError: e => heard.push(e) })
    const first = keeper.run(async () => {
      throw new Error("first")
    })
    const second = keeper.run(async () => "second")
    await expect(first).rejects.toThrow("first")
    await expect(second).resolves.toBe("second")
    expect(heard).toHaveLength(1)
  })

  test("steps run one at a time, in the order queued", async () => {
    const keeper = createKeeper()
    const order: string[] = []
    const held = gate()
    const a = keeper.run(async () => {
      await held.promise
      order.push("a")
    })
    const b = keeper.run(async () => {
      order.push("b")
    })
    held.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(["a", "b"])
  })

  test("a run queued after three later steps runs before the two not yet started", async () => {
    const keeper = createKeeper<"a" | "b" | "c">()
    const order: string[] = []
    const held = gate()
    void keeper.later("a", async () => {
      await held.promise
      order.push("a")
    })
    void keeper.later("b", async () => void order.push("b"))
    void keeper.later("c", async () => void order.push("c"))
    await settle()
    void keeper.run(async () => void order.push("run"))
    held.resolve()
    await keeper.idle()
    expect(order).toEqual(["a", "run", "b", "c"])
  })
})

describe("once and later", () => {
  test("later with one key, called five times while queued, runs once; called while running, runs once more", async () => {
    const keeper = createKeeper<"k">()
    let runs = 0
    const held = gate()
    void keeper.run(() => held.promise)
    for (let i = 0; i < 5; i += 1)
      void keeper.later("k", async () => {
        runs += 1
      })
    held.resolve()
    await keeper.idle()
    expect(runs).toBe(1)
    const running = gate()
    let started = false
    void keeper.later("k", async () => {
      runs += 1
      started = true
      await running.promise
    })
    await settle()
    expect(started).toBe(true)
    void keeper.later("k", async () => {
      runs += 1
    })
    running.resolve()
    await keeper.idle()
    expect(runs).toBe(3)
  })

  test("once keeps its place among run steps, and two callers of one queued key get the same promise", async () => {
    const keeper = createKeeper<"k">()
    const order: string[] = []
    const held = gate()
    void keeper.run(async () => {
      await held.promise
      order.push("first")
    })
    const one = keeper.once("k", async () => void order.push("once"))
    const two = keeper.once("k", async () => void order.push("never"))
    void keeper.run(async () => void order.push("last"))
    expect(two).toBe(one)
    held.resolve()
    await keeper.idle()
    expect(order).toEqual(["first", "once", "last"])
  })

  test("a later step queued before a once step still runs after it", async () => {
    const keeper = createKeeper<"compact" | "drain">()
    const order: string[] = []
    void keeper.later("compact", async () => void order.push("compact"))
    void keeper.once("drain", async () => void order.push("drain"))
    await keeper.idle()
    expect(order).toEqual(["drain", "compact"])
  })

  test("a voided run, once or later whose step throws raises no unhandled rejection", async () => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown) => void unhandled.push(reason)
    process.on("unhandledRejection", listener)
    try {
      const keeper = createKeeper<"k">()
      const boom = async () => {
        throw new Error("boom")
      }
      void keeper.run(boom)
      void keeper.once("k", boom)
      void keeper.later("k", boom)
      await keeper.idle()
      await settle()
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", listener)
    }
  })
})

describe("idle, close and slow steps", () => {
  test("idle waits for a step queued while it waits, and for tracked work", async () => {
    const keeper = createKeeper()
    const done: string[] = []
    const work = gate()
    void keeper.track(work.promise.then(() => done.push("tracked")))
    void keeper.run(async () => {
      done.push("first")
      void keeper.run(async () => {
        done.push("queued meanwhile")
      })
    })
    const idle = keeper.idle().then(() => done.push("idle"))
    await new Promise(r => setTimeout(r, 5))
    expect(done).not.toContain("idle")
    work.resolve()
    await idle
    expect(done).toEqual(["first", "queued meanwhile", "tracked", "idle"])
  })

  test("a closed keeper refuses a new step, and idle still waits for the one it holds", async () => {
    const keeper = createKeeper<"k">()
    const done: string[] = []
    const held = gate()
    void keeper.run(async () => {
      await held.promise
      done.push("held")
    })
    keeper.close()
    await expect(keeper.run(async () => {})).rejects.toBeInstanceOf(
      KeeperClosed,
    )
    await expect(keeper.later("k", async () => {})).rejects.toBeInstanceOf(
      KeeperClosed,
    )
    const idle = keeper.idle()
    held.resolve()
    await idle
    expect(done).toEqual(["held"])
  })

  test("a step that waited or ran past slowMs is reported, with its key", async () => {
    let t = 0
    const slow: unknown[] = []
    const keeper = createKeeper<"k">({
      now: () => t,
      slowMs: 10,
      onSlow: s => slow.push(s),
    })
    await keeper.run(async () => {
      t += 5
    })
    await keeper.once("k", async () => {
      t += 20
    })
    // Queued together, the second waits for the first's 20.
    const first = keeper.run(async () => {
      t += 20
    })
    const second = keeper.once("k", async () => {})
    await Promise.all([first, second])
    expect(slow).toEqual([
      { key: "k", waited: 0, ran: 20 },
      { key: null, waited: 0, ran: 20 },
      { key: "k", waited: 20, ran: 0 },
    ])
  })

  test("an upkeep step that only waited is not reported; one that ran long is", async () => {
    let t = 0
    const slow: unknown[] = []
    const keeper = createKeeper<"k" | "j">({
      now: () => t,
      slowMs: 10,
      onSlow: s => slow.push(s),
    })
    const held = keeper.run(async () => {
      t += 20
    })
    const waited = keeper.later("k", async () => {})
    const ran = keeper.later("j", async () => {
      t += 20
    })
    await Promise.all([held, waited, ran])
    expect(slow).toEqual([
      { key: null, waited: 0, ran: 20 },
      { key: "j", waited: 20, ran: 20 },
    ])
  })
})
