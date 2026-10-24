import { expect, test } from "vitest"
import {
  lanePlanned,
  laneTagsFilter,
  planUnitRequirements,
  testPlace,
  testRequirements,
} from "./requirements.ts"

const mac = {
  platform: "darwin",
  checkoutOnBtrfs: false,
  hasFlock: false,
  laneRuntime: null,
} as const

test("on the Mac, Linux's, flock's and btrfs's tests go to a lane, and the Mac's stay", () => {
  expect(planUnitRequirements(mac)).toEqual({
    "mac-host": { kind: "here" },
    linux: { kind: "lane" },
    flock: { kind: "lane" },
    "btrfs-checkout": { kind: "lane" },
  })
})

test("a Mac that can make no lane meets them nowhere, saying why", () => {
  const plan = planUnitRequirements({
    ...mac,
    laneRuntime: "Docker does not answer",
  })
  expect(plan["btrfs-checkout"]).toEqual({
    kind: "unmet",
    why: "needs the checkout on btrfs, and no lane can be made here: Docker does not answer",
  })
  expect(plan.linux.kind).toBe("unmet")
})

test("Linux with the checkout on btrfs meets all but the Mac's here", () => {
  const plan = planUnitRequirements({
    platform: "linux",
    checkoutOnBtrfs: true,
    hasFlock: true,
    laneRuntime: null,
  })
  expect(plan.linux).toEqual({ kind: "here" })
  expect(plan["btrfs-checkout"]).toEqual({ kind: "here" })
  expect(plan.flock).toEqual({ kind: "here" })
  expect(plan["mac-host"]).toEqual({
    kind: "unmet",
    why: "needs the Mac's own host, outside its lane VM",
  })
})

test("Linux whose checkout is not on btrfs sends only btrfs's tests to a lane", () => {
  const plan = planUnitRequirements({
    platform: "linux",
    checkoutOnBtrfs: false,
    hasFlock: true,
    laneRuntime: null,
  })
  expect(lanePlanned(plan)).toEqual(["btrfs-checkout"])
})

test("a lane's filter selects any requirement planned there, or none", () => {
  expect(laneTagsFilter(["linux", "btrfs-checkout"])).toBe(
    "linux || btrfs-checkout",
  )
  expect(laneTagsFilter([])).toBeNull()
})

test("a test runs here, in the lane, or nowhere, by its requirements' places", () => {
  const plan = planUnitRequirements(mac)
  expect(testPlace([], plan)).toEqual({ kind: "here" })
  expect(testPlace(["mac-host"], plan)).toEqual({ kind: "here" })
  expect(testPlace(["btrfs-checkout"], plan)).toEqual({ kind: "lane" })
  // A lane is not the Mac: a test needing both runs nowhere.
  expect(testPlace(["mac-host", "linux"], plan)).toEqual({
    kind: "unmet",
    requirement: "mac-host",
  })
  const linuxNoBtrfs = planUnitRequirements({
    platform: "linux",
    checkoutOnBtrfs: false,
    hasFlock: true,
    laneRuntime: null,
  })
  expect(testPlace(["linux", "btrfs-checkout"], linuxNoBtrfs)).toEqual({
    kind: "lane",
  })
  const linux = planUnitRequirements({
    platform: "linux",
    checkoutOnBtrfs: true,
    hasFlock: true,
    laneRuntime: null,
  })
  expect(testPlace(["mac-host"], linux)).toEqual({
    kind: "unmet",
    requirement: "mac-host",
  })
})

test("a test's requirements are its tags that name one", () => {
  expect(testRequirements(["btrfs-checkout", "slow"])).toEqual([
    "btrfs-checkout",
  ])
})
