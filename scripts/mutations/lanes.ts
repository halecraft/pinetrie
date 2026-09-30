// Mutations for @pineta/lanes. Run: pnpm mutate scripts/mutations/lanes.ts
// The planners' checks are unit tests, in seconds.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/lanes"]
/** One section of `e2e:lanes`; needs `container` running. */
const lanes = (
  section: "main" | "images" | "shared" | "commands" | "contract",
) => ["env", `PINETA_LANES_SECTION=${section}`, "pnpm", "run", "e2e:lanes"]
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
    from: '  const atEmpty = empty === "true"',
    to: '  const atEmpty = empty === "never"',
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
    from: "      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} ${WORKSPACE_ROOT} ${immutable} > ${LANE_JJ_CONFIG}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "      `mkdir -p ${LANE_CONFIG_DIR}`,",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "the whole life of a lane",
  },
  {
    name: "the fork's config applies to every repo",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  `[[--scope]]\\n--when.repositories = ["${repo}"]\\n[--scope.revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: '  `[revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "the fork's config names another repo",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} ${WORKSPACE_ROOT} ${immutable} > ${LANE_JJ_CONFIG}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} /nowhere ${immutable} > ${LANE_JJ_CONFIG}`,",
    command: unit,
    expect: "the whole life of a lane",
  },
  {
    name: "a lane's scratch repo breaks",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  `[[--scope]]\\n--when.repositories = ["${repo}"]\\n[--scope.revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: '  `[revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    command: lanes("main"),
    expect: "a jj repo outside the lane's own works in the lane",
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
    name: "an offer is moved by its bottom revision alone",
    file: plan,
    from: '): LaneStep[] => [hostOp(root, "rebase", "-s", bottom, "-o", target)]',
    to: '): LaneStep[] => [hostOp(root, "rebase", "-r", bottom, "-o", target)]',
    command: unit,
    expect: "planOffer: a commit per source",
  },
  {
    name: "a have your repo lacks fails every offer's start",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  haves.length === 0 ? null : haves.map(h => `present(${h.commit})`).join(" | ")',
    to: '  haves.length === 0 ? null : haves.map(h => h.commit).join(" | ")',
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "an offer: built, refreshed",
  },
  {
    name: "a follow restores the tip where the offer sits",
    file: plan,
    from: '      ...input.start.flatMap(c => ["-o", c]),',
    to: '      ...["-o", input.target],',
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "an offer: built, refreshed",
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
    name: "an older copy stays a start",
    file: plan,
    from: "  return newest === null ? held : held.filter(h => h.at >= newest.at)",
    to: "  return held",
    command: unit,
    expect: "the newest copy, and what came after it",
  },
  {
    name: "a have before the newest copy stays a start",
    file: plan,
    from: "  return newest === null ? held : held.filter(h => h.at >= newest.at)",
    to: '  return newest === null ? held : held.filter(h => h.kind === "delivered" || h.at >= newest.at)',
    command: unit,
    expect: "starts at the newest copy (S51)",
  },
  {
    name: "the host starts from every have",
    file: "packages/lanes/offer.ts",
    from: "  const haves = startHaves(input.haves, new Set(inTip))",
    to: "  const haves = input.haves",
    command: unit,
    expect: "starts at the newest copy (S51)",
  },
  {
    name: "the image ignores Pineta's Playwright version",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `PLAYWRIGHT_VERSION=${input.playwrightVersion}`,",
    to: "",
    command: unit,
    expect: "planImages: Pineta's image is pinned to the app's Playwright",
  },
  {
    name: "the image's browser is not the one Pineta's Playwright drives",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `PLAYWRIGHT_VERSION=${input.playwrightVersion}`,",
    to: '      "PLAYWRIGHT_VERSION=1.55.0",',
    command: lanes("images"),
    expect: "Pineta's Playwright launches Chromium",
  },
  {
    name: "an agent's own commit is not adopted",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "none" }',
    command: unit,
    expect: "a commit the agent made on the bookmark is adopted",
  },
  {
    name: "an agent's own commit is not adopted, against jj",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "none" }',
    command: unit,
    expect: "a commit the agent makes itself is the turn's revision",
  },
  {
    name: "an agent's own commit is not adopted, in a real lane",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "none" }',
    command: lanes("main"),
    expect: "a commit the agent made itself reaches its thread's offer",
  },
  {
    name: "a commit on another line is adopted",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "adopt", commit: parent }',
    command: unit,
    expect: "nothing, when @- is on another line",
  },
  {
    name: "a stack's commit is adopted, against jj",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "adopt", commit: parent }',
    command: unit,
    expect: "a stack's commits are never adopted",
  },
  {
    name: "a merge is adopted",
    file: plan,
    from: '  if (parent === undefined || others.length > 0) return { kind: "none" }',
    to: '  if (parent === undefined) return { kind: "none" }',
    command: unit,
    expect: "nothing, when @- is a merge",
  },
  {
    name: "the lane note is not where the prompt says",
    file: "packages/lanes/lane.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "export const LANE_NOTE = `${PINETA_MOUNT}/packages/pi/lane.md`",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "export const LANE_NOTE = `${PINETA_MOUNT}/packages/pi/lane-notes.md`",
    command: unit,
    expect: "every Pineta file a lane is pointed at exists",
  },
  {
    name: "the lane note is not where the prompt says, in a real lane",
    file: "packages/lanes/lane.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "export const LANE_NOTE = `${PINETA_MOUNT}/packages/pi/lane.md`",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "export const LANE_NOTE = `${PINETA_MOUNT}/packages/pi/lane-notes.md`",
    command: lanes("commands"),
    expect: "the note the prompt names is a file in the lane",
  },
  {
    name: "a diff matches a path prefix",
    file: "packages/lanes/offer.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    `root-file:${JSON.stringify(path)}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "    `root:${JSON.stringify(path)}`,",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "a review reads an offer's commit",
  },
  {
    name: "a container made from another spec is only restarted",
    file: "packages/lanes/plan.ts",
    from: '  if (label !== input.want) return "recreate"\n',
    to: "",
    command: unit,
    expect: "planContainer: create, recreate from another spec",
  },
  {
    name: "a lane with no disk and no snapshot is not told it is retired",
    file: "packages/lanes/plan.ts",
    from: '    ? { kind: "retired" }',
    to: '    ? { kind: "snapshot", from: input.newest }',
    command: unit,
    expect: "planStartFrom: a volume starts from it",
  },
]
