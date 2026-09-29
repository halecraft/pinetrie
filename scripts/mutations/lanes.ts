// Mutations for @pineta/lanes. Run: pnpm mutate scripts/mutations/lanes.ts
// The planners' checks are unit tests, in seconds.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/lanes"]
/** One section of `e2e:lanes`; needs `container` running. */
const lanes = (section: "main" | "images" | "shared" | "contract") => [
  "env",
  `PINETA_LANES_SECTION=${section}`,
  "pnpm",
  "run",
  "e2e:lanes",
]
const plan = "packages/lanes/plan.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "retiring removes nothing of Pineta's line",
    file: plan,
    from: '    .filter(p => p !== PINETA_HEADS && p !== "")',
    to: '    .filter(p => p !== "")',
    command: unit,
    expect: "withoutPinetaHeads",
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
    name: "an update's merge is left uncommitted",
    file: "packages/lanes/merge.ts",
    from: '  const commit = await jj(["commit", "-m", "update: your work"])',
    to: '  const commit = await jj(["log", "-r", "@"])',
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "a fork skips jj new",
    file: plan,
    from: '          inLane("jj", "new", ...start.commits),',
    to: '          inLane("true"),',
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "the whole life of a lane",
  },
  {
    name: "the fork's immutable_heads() is not written",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} ${immutable} > ${LANE_JJ_CONFIG}`,",
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
    from: "    at(parts.hostWorkingCopy, HOST_WORKING_COPY),",
    to: "    { source: parts.hostWorkingCopy, target: HOST_WORKING_COPY, readonly: false },",
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
  {
    name: "the lane's ignore file leaves out the shared directories",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  ["/.pineta-lane/", "/lost+found/", ...shared.map(p => `/${p}/`)]',
    to: '  ["/.pineta-lane/", "/lost+found/"]',
    command: unit,
    expect: "every repo in the lane ignores what the ignore file lists",
  },
  {
    name: "git's variables naming the ignore file are not set",
    file: plan,
    from: '    ...setEnv("GIT_CONFIG_COUNT", "1"),\n',
    to: "",
    command: lanes("shared"),
    expect: "a shared directory is never in a lane's commit",
  },
  {
    name: "shared directories are mounted read-only",
    file: plan,
    from: "      readonly: false,",
    to: "      readonly: true,",
    command: lanes("shared"),
    expect: "a plan a lane writes is in your working copy at once",
  },
  {
    name: "a container made from another spec is only restarted",
    file: plan,
    from: '  if (label !== input.want) return "recreate"\n',
    to: "",
    command: lanes("shared"),
    expect: "after a restart, an existing lane has the newly shared directory",
  },
  {
    name: "a path jj tracks is shared",
    file: plan,
    from: "  const shared = candidates.filter(p => !facts.tracked.has(p))",
    to: "  const shared = candidates",
    command: unit,
    expect: "refused, with a reason",
  },
  {
    name: "a shared directory your repo does not ignore is not excluded",
    file: plan,
    from: "    exclude: shared.filter(p => !facts.ignored.has(p)),",
    to: "    exclude: [],",
    command: unit,
    expect:
      "created when missing; excluded in your repo unless already ignored",
  },
  {
    name: "host operations on your repo snapshot your working copy",
    file: plan,
    from: '    root,\n    "--ignore-working-copy",\n    "--config",',
    to: '    root,\n    "--config",',
    command: unit,
    expect: "planOffer: a commit per source",
  },
  {
    name: "planOffer rebases only the bottom revision",
    file: plan,
    from: '    hostOp(root, "rebase", "-s", at(0), "-o", input.target),',
    to: '    hostOp(root, "rebase", "-r", at(0), "-o", input.target),',
    command: unit,
    expect: "planOffer: a commit per source",
  },
  {
    name: "the repair keeps the host's commit",
    file: plan,
    from: '  hostOp(input.root, "abandon", input.hosts),',
    to: '  hostOp(input.root, "abandon", input.yours),',
    command: unit,
    expect: "an offer: built",
  },
  {
    name: "pineta-onto does not follow a take",
    file: plan,
    from: "    ...(input.onto\n      ? [",
    to: "    ...(false\n      ? [",
    command: unit,
    expect: "planTakeOffer",
  },
  {
    name: "retiring deletes before it moves",
    file: plan,
    from: "    ...laneRefSteps(root, lanes),",
    to: "    ...laneRefSteps(root, []),",
    command: unit,
    expect: "retiring a repo",
  },
  {
    name: "a fork's copy is a child of your @ itself",
    file: plan,
    from: '  inLane("jj", "new", ...yours.parents, "-m", COPY_MESSAGE),',
    to: '  inLane("jj", "new", yours.at, "-m", COPY_MESSAGE),',
    command: unit,
    expect: "planForkSetup: a copy of your @",
  },
  {
    name: "a lane's tip is fetched as a local bookmark",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `+refs/heads/${bookmark}:${to}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "      `+refs/heads/${bookmark}:refs/heads/${bookmark}`,",
    command: unit,
    expect: "planFetch",
  },
  {
    name: "a delivery is not recorded as a have",
    file: "apps/pineta/host/offers.ts",
    from: "          await writeHave({",
    to: "          void ({",
    command: lanes("main"),
    expect: "the next offer holds only the new work",
  },
  {
    name: "a clean update writes no entry",
    file: "apps/pineta/host/work.ts",
    from: "            .append(encodeUpdate(details, Date.now()))",
    to: '            .append({ ...encodeUpdate(details, Date.now()), customType: "pineta.none" } as never)',
    command: lanes("main"),
    expect: "a clean update writes a fact",
  },
  {
    name: "a split's stack is never fetched",
    file: "apps/pineta/host/work.ts",
    from: "        await fetchLane(lane, [details.tip, ...details.start], true)",
    to: "        void details.tip",
    command: lanes("main"),
    expect: "split into a stack",
  },
]
