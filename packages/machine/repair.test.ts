import fc from "fast-check"
import { describe, expect, test } from "vitest"
import { ROOM_SPENT, ROOM_SPENT_CLEAR } from "./bounds.ts"
import {
  decodeRepairState,
  encodeRepairState,
  isRepairCalledFor,
  isRepairRunning,
  nextRepairState,
  REPAIR_IDLE,
  REPAIR_NEXT,
  type RepairEvent,
  type RepairOutcome,
  type RepairState,
  repairCause,
  repairFacts,
  repairStateNow,
  STILL_FULL_WORDS,
} from "./repair.ts"
import type { MachineSample } from "./sample.ts"

const GiB = 1024 ** 3

const outcome = (left: number | null): RepairOutcome => ({
  leftUnallocated: left,
  leftMetadata: { size: GiB, used: GiB / 2 },
  failed: null,
})

const stateArb: fc.Arbitrary<RepairState> = fc.oneof(
  fc.constant<RepairState>({ kind: "idle" }),
  fc
    .constantFrom(
      "room-spent-and-nothing-to-delete",
      "disk-full-at-boot",
      "asked-again",
    )
    .map((trigger): RepairState => ({ kind: "detected", trigger })),
  fc.constant<RepairState>({ kind: "stopping-vm" }),
  fc
    .array(fc.string(), { maxLength: 3 })
    .map((progress): RepairState => ({ kind: "booting-repair", progress })),
  fc
    .option(fc.nat(), { nil: null })
    .map((left): RepairState => ({ kind: "done", outcome: outcome(left) })),
  fc.tuple(fc.string(), fc.nat()).map(
    ([why, sizeAtFailure]): RepairState => ({
      kind: "failed",
      why,
      sizeAtFailure,
    }),
  ),
)

const eventArb: fc.Arbitrary<RepairEvent> = fc.oneof(
  fc.nat().map(
    (plannedSize): RepairEvent => ({
      kind: "trigger",
      trigger: "room-spent-and-nothing-to-delete",
      plannedSize,
    }),
  ),
  fc.constant<RepairEvent>({ kind: "retry-asked" }),
  fc.constant<RepairEvent>({ kind: "stopping" }),
  fc.constant<RepairEvent>({ kind: "stopped" }),
  fc.string().map((line): RepairEvent => ({ kind: "progress", line })),
  fc.tuple(fc.option(fc.nat(), { nil: null }), fc.nat()).map(
    ([left, size]): RepairEvent => ({
      kind: "booted",
      outcome: outcome(left),
      size,
    }),
  ),
  fc
    .tuple(fc.string(), fc.nat())
    .map(([why, size]): RepairEvent => ({ kind: "broke", why, size })),
)

describe("nextRepairState", () => {
  test("a state moves only where the table lets it, else it stays as it was", () => {
    fc.assert(
      fc.property(stateArb, eventArb, (state, event) => {
        const next = nextRepairState(state, event)
        const allowed: readonly string[] = REPAIR_NEXT[state.kind]
        expect(next === state || allowed.includes(next.kind)).toBe(true)
      }),
    )
  })
  test("a trigger leaves a failure only when the disk could grow past its size then", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (sizeAtFailure, plannedSize) => {
        const failed: RepairState = { kind: "failed", why: "x", sizeAtFailure }
        const next = nextRepairState(failed, {
          kind: "trigger",
          trigger: "disk-full-at-boot",
          plannedSize,
        })
        expect(next.kind).toBe(
          plannedSize > sizeAtFailure ? "detected" : "failed",
        )
      }),
    )
  })
  test("a retry asked moves only a failure, to detected as a person asked, whatever the disk could grow to", () => {
    fc.assert(
      fc.property(stateArb, state => {
        const next = nextRepairState(state, { kind: "retry-asked" })
        expect(next).toEqual(
          state.kind === "failed"
            ? { kind: "detected", trigger: "asked-again" }
            : state,
        )
      }),
    )
  })
  test("a trigger while a repair runs changes nothing", () => {
    for (const state of [
      { kind: "detected", trigger: "disk-full-at-boot" },
      { kind: "stopping-vm" },
      { kind: "booting-repair", progress: [] },
    ] as const)
      expect(
        nextRepairState(state, {
          kind: "trigger",
          trigger: "room-spent-and-nothing-to-delete",
          plannedSize: 1e15,
        }),
      ).toBe(state)
  })
  test("a repair is done only if what it left is no longer spent", () => {
    const booting: RepairState = { kind: "booting-repair", progress: [] }
    expect(
      nextRepairState(booting, {
        kind: "booted",
        outcome: outcome(ROOM_SPENT_CLEAR),
        size: 3 * GiB,
      }).kind,
    ).toBe("done")
    expect(
      nextRepairState(booting, {
        kind: "booted",
        outcome: outcome(ROOM_SPENT_CLEAR - 1),
        size: 3 * GiB,
      }),
    ).toEqual({ kind: "failed", why: STILL_FULL_WORDS, sizeAtFailure: 3 * GiB })
  })
  test("a boot that said it failed is failed, with its words", () => {
    expect(
      nextRepairState(
        { kind: "booting-repair", progress: [] },
        {
          kind: "booted",
          outcome: { ...outcome(10 * GiB), failed: "mount: bad superblock" },
          size: 2 * GiB,
        },
      ),
    ).toEqual({
      kind: "failed",
      why: "mount: bad superblock",
      sizeAtFailure: 2 * GiB,
    })
  })
  test("progress is kept in order while the repair boots", () => {
    let state: RepairState = { kind: "booting-repair", progress: [] }
    for (const line of ["a", "b"])
      state = nextRepairState(state, { kind: "progress", line })
    expect(state).toEqual({ kind: "booting-repair", progress: ["a", "b"] })
  })
})

describe("the shared state", () => {
  test("encoded, it decodes to itself", () => {
    fc.assert(
      fc.property(stateArb, state => {
        expect(decodeRepairState(encodeRepairState(state))).toEqual(state)
      }),
    )
  })
  test("a repair a person asked for again, stored, reads back as it was", () => {
    expect(
      decodeRepairState('{"kind":"detected","trigger":"asked-again"}\n'),
    ).toEqual({ kind: "detected", trigger: "asked-again" })
  })
  test("none written is idle; text that is no state is unreadable", () => {
    expect(decodeRepairState(null)).toEqual(REPAIR_IDLE)
    for (const text of ["", "{", '{"kind":"done"}', '{"kind":"retrying"}'])
      expect(decodeRepairState(text)).toBe("unreadable")
  })
  test("a running state with the lock free, or one unreadable, is interrupted, and starts afresh", () => {
    const booting = encodeRepairState({ kind: "booting-repair", progress: [] })
    for (const read of [
      { lockHeld: false, text: booting },
      { lockHeld: true, text: "{" },
    ]) {
      const facts = repairFacts(read)
      expect(facts.state).toBe("interrupted")
      expect(isRepairRunning(facts)).toBe(false)
      expect(repairStateNow(facts)).toEqual(REPAIR_IDLE)
      expect(repairCause(facts)).toBeNull()
    }
  })
  test("a held lock is a repair only with a running state: else a VM's start", () => {
    fc.assert(
      fc.property(stateArb, state => {
        const facts = repairFacts({
          lockHeld: true,
          text: encodeRepairState(state),
        })
        expect(isRepairRunning(facts)).toBe(
          ["detected", "stopping-vm", "booting-repair"].includes(state.kind),
        )
      }),
    )
  })
  test("a repair running is red with its step; a failure, with why", () => {
    expect(
      repairCause(
        repairFacts({
          lockHeld: true,
          text: encodeRepairState({
            kind: "booting-repair",
            progress: ["[repair] found …", "[repair] grown: …"],
          }),
        }),
      ),
    ).toEqual({
      kind: "disk-being-repaired",
      step: "booting-repair",
      progress: "[repair] grown: …",
    })
    expect(
      repairCause(
        repairFacts({
          lockHeld: false,
          text: encodeRepairState({
            kind: "failed",
            why: "no",
            sizeAtFailure: 1,
          }),
        }),
      ),
    ).toEqual({ kind: "disk-repair-failed", why: "no" })
  })
})

describe("isRepairCalledFor", () => {
  const sample = (unallocated: number, exhausted: boolean): MachineSample =>
    ({
      store: {
        size: 64 * GiB,
        unallocated,
        metadata: { used: GiB / 2, total: GiB },
      },
      upkeep: { freeing: false, exhausted },
    }) as MachineSample
  test("only with nothing left to delete and the room spent", () => {
    expect(isRepairCalledFor(sample(ROOM_SPENT - 1, true))).toBe(true)
    expect(isRepairCalledFor(sample(ROOM_SPENT - 1, false))).toBe(false)
    // Room-unrecoverable alone: gigabytes left.
    expect(isRepairCalledFor(sample(6 * GiB, true))).toBe(false)
  })
})
