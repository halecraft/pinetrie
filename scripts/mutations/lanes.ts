// Mutations for @pineta/lanes. Run: pnpm mutate scripts/mutations/lanes.ts
// The planners' checks are unit tests, in seconds.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/lanes"]
/** One section of `e2e:lanes`; needs `container` running. */
const lanes = (section: "main" | "images" | "contract") => [
  "env",
  `PINETA_LANES_SECTION=${section}`,
  "pnpm",
  "run",
  "e2e:lanes",
]
const plan = "packages/lanes/plan.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "the immutable heads replace yours",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  return now === "" ? heads : `(${now}) | ${heads}`',
    to: "  return heads",
    command: unit,
    expect: "extendImmutable: keeps your value",
  },
  {
    name: "planBundle drops the ^<have> exclusion",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  ...have.map(c => `^${c}`),",
    to: "",
    command: unit,
    expect: "planBundle: the lane's bookmark, excluding what your repo has",
  },
  {
    name: "a turn's snapshot clones the image before sync",
    file: plan,
    from: '  inLane("sync"),\n  ...cloneFile(\n    volumeImage(input.paths, input.volume),\n    snapshotFile(input.paths, input.snapshot),\n  ),',
    to: '  ...cloneFile(\n    volumeImage(input.paths, input.volume),\n    snapshotFile(input.paths, input.snapshot),\n  ),\n  inLane("sync"),',
    command: unit,
    expect: "sync comes before the clone",
  },
  {
    name: "fetchById fetches with no destination ref",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  const refs = commits.map((c, i) => `+${c}:${FETCHED_REF}/${i}`).join(" ")',
    to: '  const refs = commits.join(" ")',
    command: unit,
    expect: "fetchById: skipped when every commit is on the disk",
  },
  {
    name: "a lane gets a variable no grant names",
    file: plan,
    from: "  const passed = spec.grants.env.flatMap(name => {",
    to: "  const passed = Object.keys(env).flatMap(name => {",
    command: unit,
    expect: "never your home directory, and no variable no grant names",
  },
  {
    name: "a turn that changed nothing is committed",
    file: "packages/lanes/revisions.ts",
    from: '  if (empty.stdout.trim() === "true") return null',
    to: '  if (empty.stdout.trim() === "never") return null',
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "a landing's merge is left uncommitted",
    file: "packages/lanes/merge.ts",
    from: '  const commit = await jj(["commit", "-m", "land: your work"])',
    to: '  const commit = await jj(["log", "-r", "@"])',
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "a fork skips jj new",
    file: plan,
    from: '    inLane("jj", "new", ...commits),',
    to: '    inLane("true"),',
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "the whole life of a lane",
  },
  {
    name: "the fork's immutable_heads() is not written",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `mkdir -p ${LANE_CONFIG_DIR} && printf '%s' ${shellWord(forkConfig(commits))} > ${LANE_JJ_CONFIG}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "      `mkdir -p ${LANE_CONFIG_DIR}`,",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "the whole life of a lane",
  },
  {
    name: "the lane's queue lets a tool run before the turn's snapshot finishes",
    file: "packages/lanes/lane.ts",
    from: "      await tail\n",
    to: "",
    command: unit,
    expect: "the gate opens only after a turn's snapshot finishes",
  },
  {
    name: "volumes are created without the journal",
    file: plan,
    from: '    "--opt",\n    "journal=ordered",\n',
    to: "",
    command: lanes("contract"),
    expect: "every clone of a journaled volume taken mid-write checks clean",
  },
  {
    name: "a turn's snapshot skips sync",
    file: plan,
    from: '  inLane("sync"),\n',
    to: "",
    command: lanes("main"),
    expect:
      "a file the agent wrote is whole in a branch taken at the next turn",
  },
  {
    name: "/mnt/host-working-copy is mounted writable",
    file: plan,
    from: "    ...readonlyMount({\n      source: spec.hostWorkingCopy,\n      target: HOST_WORKING_COPY,\n    }),",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: '    "--mount",\n    `type=bind,source=${spec.hostWorkingCopy},target=${HOST_WORKING_COPY}`,',
    command: lanes("main"),
    expect:
      "a write to /mnt/host-working-copy fails, through bash and through write",
  },
  {
    name: "the helper is started with the image's node",
    file: "packages/lanes/runtime.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  `${RUNTIME_MOUNT}/node/${LOADER}`,\n  "--library-path",\n  `${RUNTIME_MOUNT}/node/lib`,\n  `${RUNTIME_MOUNT}/node/node`,',
    to: '  "node",',
    command: lanes("images"),
    expect: "a lane on Alpine, with musl and no Node, runs pi's four tools",
  },
  {
    name: "a fork waits for no pending turn record",
    file: "apps/pineta/host/work.ts",
    from: "              await Promise.all([...recording])\n",
    to: "",
    command: lanes("main"),
    expect:
      "a file the agent wrote is whole in a branch taken at the next turn",
  },
  {
    name: "a person's paths are stored as typed in a thread with its own copy",
    file: "apps/pineta/host/index.ts",
    from: "      hostWorkingCopy: own ? (work.project?.root ?? null) : null,",
    to: "      hostWorkingCopy: null,",
    command: lanes("main"),
    expect:
      "a person's path to your working copy is stored as the lane sees it",
  },
  {
    name: "a lane with no disk and no snapshot is not told it is retired",
    file: "apps/pineta/host/work.ts",
    from: "        if (newest === null) throw new Error(RETIRED)\n",
    to: "",
    command: lanes("main"),
    expect:
      "a lane with no disk and no snapshot says it predates lane containers",
  },
]
