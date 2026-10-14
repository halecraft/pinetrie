import { holdFill, type Lease, NOTHING_HELD, planShares } from "@pinetrie/vm"
import { describe, expect, test } from "vitest"
import { record } from "../fakes.ts"
import {
  createShares,
  NO_SHARES,
  planShareAndGrant,
  type Shares,
  sharesWords,
  type Wanted,
} from "./shares.ts"

describe("planShareAndGrant: what lanes may mount and reach, shared and granted", () => {
  const mount = (source: string, readonly = true) => ({
    source,
    target: `/in${source}`,
    readonly,
  })
  const wanted: Wanted = {
    mounts: [mount("/p"), mount("/p/.plans", false)],
    hostPorts: [3000],
  }
  /** What the host holds after the plan for `w` was carried out. */
  const after = (w: Wanted, granted: readonly number[] = []): Shares => ({
    ...NO_SHARES,
    filled: true,
    held: holdFill(NOTHING_HELD, {
      slot: 0,
      entries: planShares(
        w.mounts.map(m => ({ source: m.source, readOnly: m.readonly })),
      ),
    }),
    granted,
  })
  test("first, the host's own slot, with every directory", () => {
    expect(planShareAndGrant(NO_SHARES, wanted, null, true)).toEqual({
      fill: {
        into: "host",
        dirs: [
          { source: "/p", readOnly: true },
          { source: "/p/.plans", readOnly: false },
        ],
      },
      grant: [3000],
      words: [],
    })
  })
  test("unchanged, nothing: no slot, no grant, no words", () => {
    expect(
      planShareAndGrant(after(wanted, [3000]), wanted, null, true),
    ).toEqual({ fill: null, grant: null, words: [] })
  })
  test("a new directory goes in an extra slot, alone", () => {
    const more = {
      ...wanted,
      mounts: [...wanted.mounts, mount("/p/docs", false)],
    }
    expect(
      planShareAndGrant(after(wanted, [3000]), more, null, true).fill,
    ).toEqual({
      into: "extra",
      dirs: [{ source: "/p/docs", readOnly: false }],
    })
  })
  test("a widening refused is not asked again until what is new changes", () => {
    const more = {
      ...wanted,
      mounts: [...wanted.mounts, mount("/p/docs", false)],
    }
    const refused: Shares = {
      ...after(wanted, [3000]),
      refused: { dirs: [{ source: "/p/docs", readOnly: false }], why: "full" },
    }
    expect(planShareAndGrant(refused, more, null, true).fill).toBeNull()
    const other = {
      ...more,
      mounts: [...more.mounts, mount("/p/notes", false)],
    }
    const fill = planShareAndGrant(refused, other, null, true).fill
    expect(fill?.into).toBe("extra")
    expect(fill?.dirs.map(d => d.source).sort()).toEqual([
      "/p/docs",
      "/p/notes",
    ])
  })
  test("ports are written when they changed, and on a lease with none written", () => {
    const held = after(wanted, [3000])
    expect(
      planShareAndGrant(
        held,
        { ...wanted, hostPorts: [3000, 5432] },
        null,
        true,
      ).grant,
    ).toEqual([3000, 5432])
    expect(
      planShareAndGrant(held, { ...wanted, hostPorts: [] }, null, true).grant,
    ).toEqual([])
    expect(
      planShareAndGrant({ ...held, granted: null }, wanted, null, true).grant,
    ).toEqual([3000])
  })
  test("the host's own port is never granted, and is said with why", () => {
    const plan = planShareAndGrant(
      after(wanted, [3000]),
      { ...wanted, hostPorts: [3000, 7391] },
      7391,
      true,
    )
    expect(plan.grant).toEqual([3000])
    expect(plan.words.map(sharesWords)).toEqual([
      "lanes.hostPorts 7391 is not granted: it is this pine·trie host's own port, which takes no key on loopback",
    ])
  })
  test("on Linux nothing is shared or granted, and the ports are said once", () => {
    expect(planShareAndGrant(NO_SHARES, wanted, null, false)).toEqual({
      fill: null,
      grant: null,
      words: [{ kind: "linux-ports" }],
    })
    expect(
      planShareAndGrant(
        { ...NO_SHARES, toldLinuxPorts: true },
        wanted,
        null,
        false,
      ).words,
    ).toEqual([])
  })
})

describe("createShares: a host's slots and grant, behind one queue", () => {
  const mount = (source: string, readonly = true) => ({
    source,
    target: `/in${source}`,
    readonly,
  })
  /** A lease on `slot` that records each fill, with the sweep run first. */
  const leaseOn = (slot: number, fills: string[]) =>
    record<Lease>({
      slot,
      fill: async (dirs, sweep) => {
        await sweep(slot)
        fills.push(`${slot}: ${dirs.map(d => d.source).join(" ")}`)
        return { slot, entries: planShares(dirs) }
      },
    }).port
  test("a share still running when the lease is relet lands before the reset, and the new lease's own slot is filled", async () => {
    const fills: string[] = []
    const swept: number[] = []
    const closed: number[] = []
    let release = () => {}
    const extraHeld = new Promise<void>(r => {
      release = r
    })
    const shares = createShares({
      lease: leaseOn(0, fills),
      ownPort: null,
      sweep: async slot => {
        swept.push(slot)
      },
      extra: async dirs => {
        await extraHeld
        return {
          fill: { slot: 7, entries: planShares(dirs) },
          close: async () => {
            closed.push(7)
          },
        }
      },
      grant: async () => {},
      relet: () => {},
      log: () => {},
    })
    const first: Wanted = { mounts: [mount("/p")], hostPorts: [] }
    await shares.share(first)
    const wider = {
      ...first,
      mounts: [...first.mounts, mount("/p/docs", false)],
    }
    const widening = shares.share(wider)
    const relet = shares.relet(leaseOn(3, fills))
    release()
    await Promise.all([widening, relet])
    expect(fills).toEqual(["0: /p", "3: /p /p/docs"])
    expect(swept).toEqual([0, 3])
    // The old lease's extra slot, made before the reset, is closed by it.
    expect(closed).toEqual([7])
    expect(shares.slot()).toBe(3)
    expect(shares.pathOf("/p/docs")).toMatch(/^\/mnt\/host-shares\/3\//)
  })
})
