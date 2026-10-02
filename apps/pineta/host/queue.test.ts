import { expect, test } from "vitest"
import { deferred } from "./fakes.ts"
import { createSerial, SerialClosed } from "./queue.ts"

test("a step runs after a failed one, and the failure is heard once", async () => {
  const heard: unknown[] = []
  const serial = createSerial(e => heard.push(e))
  const first = serial.run(async () => {
    throw new Error("first")
  })
  const second = serial.run(async () => "second")
  await expect(first).rejects.toThrow("first")
  await expect(second).resolves.toBe("second")
  expect(heard).toHaveLength(1)
})

test("steps run one at a time, in the order queued", async () => {
  const serial = createSerial()
  const order: string[] = []
  const gate = deferred<void>()
  const a = serial.run(async () => {
    await gate.promise
    order.push("a")
  })
  const b = serial.run(async () => {
    order.push("b")
  })
  gate.resolve()
  await Promise.all([a, b])
  expect(order).toEqual(["a", "b"])
})

test("idle waits for a step queued while it waits, and for tracked work", async () => {
  const serial = createSerial()
  const done: string[] = []
  const work = deferred<void>()
  serial.track(work.promise.then(() => done.push("tracked")))
  void serial.run(async () => {
    done.push("first")
    void serial.run(async () => {
      done.push("queued meanwhile")
    })
  })
  const idle = serial.idle().then(() => done.push("idle"))
  await new Promise(r => setTimeout(r, 5))
  expect(done).not.toContain("idle")
  work.resolve()
  await idle
  expect(done).toEqual(["first", "queued meanwhile", "tracked", "idle"])
})

test("a closed serial refuses a new step, and idle still waits for the one it holds", async () => {
  const serial = createSerial()
  const done: string[] = []
  const gate = deferred<void>()
  void serial.run(async () => {
    await gate.promise
    done.push("held")
  })
  serial.close()
  const refused = serial.run(async () => {
    done.push("refused")
  })
  await expect(refused).rejects.toBeInstanceOf(SerialClosed)
  const idle = serial.idle()
  gate.resolve()
  await idle
  expect(done).toEqual(["held"])
})
