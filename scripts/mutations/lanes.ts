// Mutations for @pinetrie/lanes. Run: pnpm mutate scripts/mutations/lanes.ts
// The planners' checks are unit tests, in seconds. The suite mutations run one
// `e2e:lanes` scenario, which needs `container`: on the Mac.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/lanes"]
const plan = "packages/lanes/plan.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "pre-rename: the old config folder moves after the bookmarks",
    file: plan,
    from: "  return [\n    ...folder,\n    ...renames,\n",
    to: "  return [\n    ...renames,\n    ...folder,\n",
    command: unit,
    expect:
      "the config folder moves, first; the lane's bookmarks are renamed; fetched ones are deleted; another lane's stay",
  },
  {
    name: "pre-rename: a fork keeps the old config folder",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    laneShell(`rm -rf ${OLD_LANE_CONFIG_DIR}`),\n    ...base,\n",
    to: "    ...base,\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/repo/repo.test.ts"],
    expect:
      "a fork of a disk holding the old config folder commits nothing of it",
  },
  {
    name: "pre-rename: the lane's old bookmarks are not renamed",
    file: plan,
    from: "    .filter(([old]) => has.has(old))\n",
    to: "    .filter(() => false)\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/repo/repo.test.ts"],
    expect:
      "the old names on a disk: no bookmark, until planOldNamesOnDisk renames them",
  },
  {
    name: "an integrated-offer commit naming no source the lane holds is joined",
    file: plan,
    from: "    return ours.length === 0\n      ? []",
    to: "    return false\n      ? []",
    command: unit,
    expect:
      "an integrated-offer commit whose sources the lane lacks is not joined",
  },
  {
    name: "an integrated-offer commit is joined only when the lane holds every source it names",
    file: plan,
    from: "    return ours.length === 0\n      ? []",
    to: "    return ours.length < sources.length\n      ? []",
    command: unit,
    expect: "a squash naming one source held and one not is joined",
  },
  {
    name: "an offer integration finds no destination below the offer",
    file: "packages/repo/offer-gather.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "          `present(${revsetName(bookmark)}) & ::parents(${bottom.commit})`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    to: "          `present(${revsetName(bookmark)}) & ${bottom.commit}::`,",
    suite: "lanes",
    scenario: "main",
    expect:
      "integrating the offer moves the line to it, on your landed commit; your working copy is untouched",
  },
  {
    name: "the user's line name wins over the project's",
    file: "packages/lanes/plan.ts",
    from: "    const value = project[key] ?? user[key]",
    to: "    const value = user[key] ?? project[key]",
    command: unit,
    expect: "the project's name wins over the user's",
  },
  {
    name: "publishing catches your files up unless told not to",
    file: plan,
    from: "  catchUp: false,\n}",
    to: "  catchUp: true,\n}",
    command: unit,
    expect: "catching up is off unless set, and the project's setting wins",
  },
  {
    name: "the user's catchUp wins over the project's",
    file: plan,
    from: "  const flag = project.catchUp ?? user.catchUp",
    to: "  const flag = user.catchUp ?? project.catchUp",
    command: unit,
    expect: "catching up is off unless set, and the project's setting wins",
  },
  {
    name: "a catchUp that is not a boolean turns catching up on",
    file: plan,
    from: "  else if (flag !== null)\n    refused.push(",
    to: "  else if (flag !== null)\n    catchUp = true, refused.push(",
    command: unit,
    expect: "a catchUp that is not true or false falls back to off, saying why",
  },
  {
    name: "a bookmark name may hold ..",
    file: "packages/lanes/plan.ts",
    from: '  !name.includes("..") &&',
    to: "",
    command: unit,
    expect: "isBookmarkName: git's rules",
  },
  {
    name: "planBundle drops the ^<have> exclusion",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "    ...input.have.map(c => `^${c}`),",
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
    name: "a lane's scratch repo breaks",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  `[[--scope]]\\n--when.repositories = ["${repo}"]\\n[--scope.revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: '  `[revset-aliases]\\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\\n`',
    suite: "lanes",
    scenario: "main",
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
    suite: "lanes",
    scenario: "contract",
    expect:
      "every clone of a journaled volume taken mid-write checks clean and holds every fsynced record",
  },
  {
    name: "a turn's snapshot skips sync",
    file: plan,
    from: '  inLane("sync"),\n',
    to: "",
    suite: "lanes",
    scenario: "main",
    expect:
      "a file the agent wrote is whole in a branch taken at the next turn",
  },
  {
    name: "/mnt/host-working-copy is mounted writable",
    file: plan,
    from: "    at(parts.hostWorkingCopy, HOST_WORKING_COPY),",
    to: "    { source: parts.hostWorkingCopy, target: HOST_WORKING_COPY, readonly: false },",
    suite: "lanes",
    scenario: "main",
    expect:
      "a write to /mnt/host-working-copy fails, through bash and through write",
  },
  {
    name: "the helper is started with the image's node",
    file: "packages/lanes/runtime.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  `${RUNTIME_MOUNT}/node/${LOADER}`,\n  "--library-path",\n  `${RUNTIME_MOUNT}/node/lib`,\n  `${RUNTIME_MOUNT}/node/node`,',
    to: '  "node",',
    suite: "lanes",
    scenario: "images",
    expect: "a lane on Alpine, with musl and no Node, runs pi's four tools",
  },
  {
    name: "the lane's ignore file leaves out the shared directories",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: '  ["/.pinetrie-lane/", "/lost+found/", ...shared.map(p => `/${p}/`)]',
    to: '  ["/.pinetrie-lane/", "/lost+found/"]',
    command: unit,
    expect: "every repo in the lane ignores what the ignore file lists",
  },
  {
    name: "git's variables naming the ignore file are not set",
    file: plan,
    from: '    ...setEnv("GIT_CONFIG_COUNT", "1"),\n',
    to: "",
    suite: "lanes",
    scenario: "shared",
    expect:
      "a shared directory is never in a lane's commit, your @ or a snapshot, and a branch sees it live",
  },
  {
    name: "shared directories are mounted read-only",
    file: plan,
    from: "      readonly: false,",
    to: "      readonly: true,",
    suite: "lanes",
    scenario: "shared",
    expect: "a plan a lane writes is in your working copy at once, and yours",
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
    name: "a fork's copy is a child of your @ itself",
    file: plan,
    from: '  inLane("jj", "new", on),',
    to: '  inLane("jj", "new", wip.commit),',
    command: unit,
    expect: "planForkSetup: a WIP's copy on the line commit under it",
  },
  {
    name: "the image ignores pinetrie's Playwright version",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `PLAYWRIGHT_VERSION=${input.playwrightVersion}`,",
    to: "",
    command: unit,
    expect: "planImages: pinetrie's image is pinned to the app's Playwright",
  },
  {
    name: "the image's browser is not the one pinetrie's Playwright drives",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      `PLAYWRIGHT_VERSION=${input.playwrightVersion}`,",
    to: '      "PLAYWRIGHT_VERSION=1.55.0",',
    suite: "lanes",
    scenario: "images",
    expect: "on the default image, pinetrie's Playwright launches Chromium",
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
    name: "an agent's own commit is not adopted, in a real lane",
    file: plan,
    from: '  return facts.parentDescends\n    ? { kind: "adopt", commit: parent }\n    : { kind: "none" }',
    to: '  return { kind: "none" }',
    suite: "lanes",
    scenario: "main",
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
    from: "export const LANE_NOTE = `${PINETRIE_MOUNT}/packages/pi/lane.md`",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "export const LANE_NOTE = `${PINETRIE_MOUNT}/packages/pi/lane-notes.md`",
    command: unit,
    expect: "every pinetrie file a lane is pointed at exists",
  },
  {
    name: "the lane note is not where the prompt says, in a real lane",
    file: "packages/lanes/lane.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "export const LANE_NOTE = `${PINETRIE_MOUNT}/packages/pi/lane.md`",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "export const LANE_NOTE = `${PINETRIE_MOUNT}/packages/pi/lane-notes.md`",
    suite: "lanes",
    scenario: "commands",
    expect: "the note the prompt names is a file in the lane",
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
  {
    name: "the resolution is not told what the card asked",
    file: "apps/pinetrie/host/work/update.ts",
    from: "            await resolutionOf(intent),",
    to: '            await resolutionOf(""),',
    suite: "lanes",
    scenario: "main",
    expect:
      "a card that brings the thread up to date runs the resolution when it conflicts, with the card's text, and the offer comes back clean",
  },
  {
    name: "a clean update refuses the card's text",
    file: "apps/pinetrie/host/work/update.ts",
    from: '    case "clean":\n      return { kind: "clean" }',
    to: '    case "clean":\n      return { kind: "refused", reason: "clean" }',
    suite: "lanes",
    scenario: "main",
    expect:
      "a card that brings the thread up to date writes the update in the thread, then sends its text",
  },
  {
    name: "a turn's paths are read from the process's directory",
    file: "packages/lanes/revisions.ts",
    from: "export const PATH_LINE = 'json(path) ++ \"\\\\n\"'",
    to: "export const PATH_LINE = 'json(display_diff_path) ++ \"\\\\n\"'",
    command: unit,
    expect: "a path with a space and an accent",
  },
  {
    name: "a WIP's copy fetches the lane's own copy too",
    file: plan,
    from: "    steps: [fetchById([from.commit]), ...planWipCopy(from, from.on)],",
    to: "    steps: [fetchById([from.commit, from.on]), ...planWipCopy(from, from.on)],",
    command: unit,
    expect: "a WIP's copy fetches only the WIP's commit",
  },
  {
    name: "the line's merge names no base",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "      message: baseMessage(`update: ${from.onto}`, {",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "      message: ((title: string, _: unknown) => title)(`update: ${from.onto}`, {",
    command: unit,
    expect: "the line's merge names its base",
  },
  {
    name: "a runtime with jj alone is taken as complete",
    file: "packages/lanes/runtime.ts",
    from: "  RUNTIME_PROGRAMS.every(p => binEntries.includes(p))",
    to: '  binEntries.includes("jj")',
    command: unit,
    expect: "runtimeComplete: every program, not only jj",
  },
  {
    name: "the lane runtime leaves rg behind",
    file: "packages/core/index.ts",
    from: 'export const RUNTIME_PROGRAMS = ["jj", "rg", "fd", "sd"] as const',
    to: 'export const RUNTIME_PROGRAMS = ["jj", "fd", "sd"] as const',
    suite: "lanes",
    scenario: "images",
    expect:
      "on Alpine, pinetrie's rg, fd and sd run, and grep and find find the files",
  },
  {
    name: "the default image has no python3",
    file: "packages/lanes/image/Containerfile",
    from: "curl procps python3 \\",
    to: "curl procps \\",
    suite: "lanes",
    scenario: "images",
    expect: "the default image has python3",
  },
  // ── a project's folder (ADR-0086) ──
  {
    name: "a home directory can be a project",
    file: "packages/lanes/plan.ts",
    from: "    path.resolve(root) === path.resolve(f.home) ||\n",
    to: "    false ||\n",
    command: unit,
    expect:
      "planProjectDir: jj's root, else git's, else the folder; never missing, your home directory or /",
  },
  {
    name: "a missing folder can be a project",
    file: "packages/lanes/plan.ts",
    from: "  if (!f.isDirectory)\n",
    to: "  if (false)\n",
    command: unit,
    expect:
      "planProjectDir: jj's root, else git's, else the folder; never missing, your home directory or /",
  },
  {
    name: "a project's repo is not told to ignore .pinetrie/",
    file: "packages/lanes/host.ts",
    from: "  return (await excludeInYours(planned.root, [EXCLUDE_LINE]))\n",
    to: "  return true\n",
    command: unit,
    expect:
      "prepareProjectDir (ADR-0086, S108): a repo's root with .pinetrie/ excluded once; a non-colocated repo refused; a plain folder untouched",
  },
  {
    name: "a broken config file reads as missing",
    file: "packages/lanes/host.ts",
    from: "    return isMissing(error)\n",
    to: "    return true\n",
    command: unit,
    expect: "readConfigFile",
  },
]
