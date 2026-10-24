// e2e/requirements — what a test or a scenario needs of the place it runs
// in, as values, and where each can be met. Pure: what a place has is
// gathered by `place.ts`.
//
// A unit test names its requirements as Vitest tags (`vitest.config.mjs`
// skips those not met here); a scenario as its `requires`. One plan says,
// for every unit requirement, whether it is met here, in a throwaway lane
// this run makes, or nowhere and why (`planUnitRequirements`); a suite
// requirement is met here or not.

/**
 * Where a verification run's unit tests leave their JSON reports, from the
 * checkout's root: those here (`verify.config.ts`) and the lane's
 * (`apps/pinetrie/scripts/lane-tests.ts`), which
 * `scripts/requirements-report.ts` reads together.
 */
export const UNIT_REPORTS = {
  here: "node_modules/.verify/unit-here.json",
  lane: "node_modules/.verify/unit-lane.json",
} as const

/** What a unit test can require: a tag of Vitest's. */
export const UNIT_REQUIREMENTS = [
  "mac-host",
  "linux",
  "flock",
  "btrfs-checkout",
] as const

/** What a scenario, or one of its checks, can require. */
export const SUITE_REQUIREMENTS = [
  "lane-runtime",
  "lane-vm",
  "rootful-docker",
  "live-model",
  "chromium",
  "qemu",
  "arm64-docker",
] as const

export type UnitRequirement = (typeof UNIT_REQUIREMENTS)[number]
export type SuiteRequirement = (typeof SUITE_REQUIREMENTS)[number]
export type Requirement = UnitRequirement | SuiteRequirement

/** A requirement in words, as a skip or a report names it. */
export function requirementWords(r: Requirement): string {
  switch (r) {
    case "mac-host":
      return "the Mac's own host, outside its lane VM"
    case "linux":
      return "Linux"
    case "flock":
      return "util-linux's flock on the PATH"
    case "btrfs-checkout":
      return "the checkout on btrfs"
    case "lane-runtime":
      return "a runtime for lanes"
    case "lane-vm":
      return "the Mac's lane VM"
    case "rootful-docker":
      return "a rootful Docker, not a lane's rootless one"
    case "live-model":
      return "a real model, which costs money"
    case "chromium":
      return "Chromium's headless shell"
    case "qemu":
      return "qemu-system-aarch64"
    case "arm64-docker":
      return "an arm64 Docker for the observer's builds"
  }
}

/** What a place has that decides where a unit requirement is met. */
export interface UnitFacts {
  readonly platform: NodeJS.Platform
  /** The checkout's `node_modules` is on btrfs, where the tests make subvolumes. */
  readonly checkoutOnBtrfs: boolean
  readonly hasFlock: boolean
}

/** Whether `r` is met here, from facts read without a probe. */
export function isMetHere(r: UnitRequirement, facts: UnitFacts): boolean {
  switch (r) {
    case "mac-host":
      return facts.platform === "darwin"
    case "linux":
      return facts.platform === "linux"
    case "flock":
      return facts.hasFlock
    case "btrfs-checkout":
      return facts.platform === "linux" && facts.checkoutOnBtrfs
  }
}

export type RequirementPlace =
  | { readonly kind: "here" }
  | { readonly kind: "lane" }
  | { readonly kind: "unmet"; readonly why: string }

/** A lane is Linux, with util-linux, its `/workspace` on btrfs: what it can meet. */
const LANE_MEETS: ReadonlySet<UnitRequirement> = new Set([
  "linux",
  "flock",
  "btrfs-checkout",
])

/**
 * Where each unit requirement is met: here, else in a lane when this place
 * can make one (`laneRuntime` null) and a lane has it, else nowhere, with
 * why.
 */
export function planUnitRequirements(
  facts: UnitFacts & {
    /** Why this place cannot make a lane of its own, or null. */
    readonly laneRuntime: string | null
  },
): Readonly<Record<UnitRequirement, RequirementPlace>> {
  const place = (r: UnitRequirement): RequirementPlace => {
    if (isMetHere(r, facts)) return { kind: "here" }
    if (!LANE_MEETS.has(r))
      return { kind: "unmet", why: `needs ${requirementWords(r)}` }
    if (facts.laneRuntime !== null)
      return {
        kind: "unmet",
        why: `needs ${requirementWords(r)}, and no lane can be made here: ${facts.laneRuntime}`,
      }
    return { kind: "lane" }
  }
  return {
    "mac-host": place("mac-host"),
    linux: place("linux"),
    flock: place("flock"),
    "btrfs-checkout": place("btrfs-checkout"),
  }
}

/** The requirements `plan` puts in a lane. */
export const lanePlanned = (
  plan: Readonly<Record<UnitRequirement, RequirementPlace>>,
): readonly UnitRequirement[] =>
  UNIT_REQUIREMENTS.filter(r => plan[r].kind === "lane")

/**
 * The `--tags-filter` that selects the tests a lane runs: those tagged with
 * any requirement planned there. Null when none is.
 */
export const laneTagsFilter = (
  planned: readonly UnitRequirement[],
): string | null => (planned.length === 0 ? null : planned.join(" || "))

const isUnitRequirement = (tag: string): tag is UnitRequirement =>
  (UNIT_REQUIREMENTS as readonly string[]).includes(tag)

/** A test's unit requirements, from its tags; other tags are not ours. */
export const testRequirements = (
  tags: readonly string[],
): readonly UnitRequirement[] => tags.filter(isUnitRequirement)

/**
 * Where a test with `requirements` runs: here when all are met here; in the
 * lane when one is planned there and a lane meets every one, those met here
 * too; else nowhere, naming one that is not met.
 */
export function testPlace(
  requirements: readonly UnitRequirement[],
  plan: Readonly<Record<UnitRequirement, RequirementPlace>>,
):
  | { readonly kind: "here" }
  | { readonly kind: "lane" }
  | { readonly kind: "unmet"; readonly requirement: UnitRequirement } {
  const notHere = requirements.filter(r => plan[r].kind !== "here")
  if (notHere.length === 0) return { kind: "here" }
  const unmet =
    notHere.find(r => plan[r].kind === "unmet") ??
    requirements.find(r => !LANE_MEETS.has(r))
  return unmet === undefined
    ? { kind: "lane" }
    : { kind: "unmet", requirement: unmet }
}
