// Mutations for @pinetrie/lanes. Run: pnpm mutate scripts/mutations/lanes.ts
// The planners' checks are unit tests, in seconds. The suite mutations run one
// `e2e:lanes` scenario, on the suites' Docker: in a lane, or on the Mac.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/lanes"]
const plan = "packages/lanes/plan.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "a link whose helper exited is kept",
    file: "packages/lanes/lane.ts",
    from: "    opening.then(l => l.closed.then(drop), drop)\n",
    to: "    opening.then(() => {}, drop)\n",
    command: unit,
    expect:
      "a link that failed to open, or whose helper exited, is opened again",
  },
  {
    name: "a slot leaves out the shared directories",
    file: "packages/lanes/plan.ts",
    from: "  ...sharedMounts(input.shared),\n  ...input.attached,\n",
    to: "  ...input.attached,\n",
    command: unit,
    expect:
      "every directory a lane mounts, its shared directories with the base's",
  },
  {
    name: "the lanes' ignore file leaves out a root pine·trie keeps on a disk",
    file: plan,
    from: "    ...DISK_OWN_ROOTS.map(r => `/${r}/`),\n",
    to: "    ...DISK_OWN_ROOTS.slice(1).map(r => `/${r}/`),\n",
    command: unit,
    expect:
      "every repo in the lane ignores what the ignore file lists, through git's own variables",
  },
  {
    name: "a new directory's entries keep its orphan name",
    file: "packages/lanehost/send-stream.ts",
    from: "          moveUnder(path, to)\n",
    to: "",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanehost"],
    expect: "a new directory filled under its orphan name",
  },
  {
    name: "a send stream's rename scans every change",
    file: "packages/lanehost/send-stream.ts",
    from: "    const paths = under.get(from)\n",
    to: '    const paths = new Set([...changes.keys()].filter(p => p.startsWith(from + "/")))\n',
    command: ["pnpm", "exec", "vitest", "run", "packages/lanehost"],
    expect:
      "tens of thousands of new directories, filled under their orphan names, fold in linear time",
  },
  {
    name: "a send stream's reader drops the command a chunk ends inside",
    file: "packages/lanehost/send-stream.ts",
    from: "      rest = ended ? new Uint8Array(0) : bytes.slice(at)\n",
    to: "      rest = new Uint8Array(0)\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanehost"],
    expect: "fed in pieces, it folds as the whole stream does",
  },
  {
    name: "a send stream's orphan stands for nothing",
    file: "packages/lanehost/send-stream.ts",
    from: "        } else if (ORPHAN.test(pathTo)) orphans.set(pathTo, resolve(path))\n",
    to: "        } else if (ORPHAN.test(pathTo)) orphans.set(pathTo, null)\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanehost"],
    expect: "a deleted directory resolves to its original path",
  },
  {
    name: "a diff is send's under rootless Docker",
    file: "packages/lanehost/roles.ts",
    from: '    ["diff", facts.rootless ? "disks" : "privileged"],\n',
    to: '    ["diff", "privileged"],\n',
    command: ["pnpm", "exec", "vitest", "run", "packages/lanehost"],
    expect:
      "a diff is send's, in the privileged role, unless Docker is rootless",
  },
  {
    name: "a lane's start asks its state again after the caller read it",
    file: "packages/lanes/lane.ts",
    from: "      const state = known ?? (await runtime.containerFacts(container)).state\n",
    to: "      const state = (await runtime.containerFacts(container)).state\n",
    command: ["pnpm", "exec", "vitest", "run", "packages/lanes/lanes.test.ts"],
    expect: "asks the container's state only when the caller does not know it",
  },
  // ── the lanes suite, proven in a lane ──
  {
    name: "a catch up leaves stale outputs",
    file: "apps/pinetrie/host/work/update.ts",
    from: "        await removeStaleOutputs(handle, (await setup.ready).image).catch(\n",
    to: "        await Promise.resolve().catch(\n",
    suite: "lanes",
    scenario: "recipe",
    expect:
      "a catch up that changes what a recipe read removes what it made, and keeps its cache",
  },
  {
    name: "a run starts on stale outputs",
    file: "apps/pinetrie/host/work/containers.ts",
    from: "    await removeStaleOutputs(handle, r.image).catch(\n",
    to: "    await Promise.resolve().catch(\n",
    suite: "lanes",
    scenario: "recipe",
    expect:
      "a run starts without the outputs of a recipe whose input changed since",
  },
  {
    name: "a lane's own pinetrie.json widens its grants",
    file: "packages/lanes/plan.ts",
    from: "      env: a.env.filter(keeps(b.env, o.env, eq)),\n",
    to: "      env: [...new Set([...a.env, ...o.env])],\n",
    suite: "lanes",
    scenario: "main",
    expect:
      "a lane's own pinetrie.json narrows its grants from its next run, and widens none until accepted",
  },
  {
    name: "a lane runs with accepted work's config, whatever its own says",
    file: "apps/pinetrie/host/work/containers.ts",
    from: "    await setup.configs.readLane(lane)\n",
    to: "",
    suite: "lanes",
    scenario: "main",
    expect:
      "a lane's own pinetrie.json narrows its grants from its next run, and widens none until accepted",
  },
  {
    name: "the host never watches the shared directories",
    file: "apps/pinetrie/host/work/index.ts",
    from: "  void sharedWatch\n    .sync(setup.configs.accepted().shared)\n",
    to: "  void sharedWatch\n    .sync([])\n",
    suite: "lanes",
    scenario: "shared",
    expect:
      "your writes are versions as you make them, and a lane's write over one it never read is concurrent",
  },
  {
    name: "a read tool's read is not what the agent knows",
    file: "packages/pi/lane-helper.ts",
    from: "  const touched = fileAccess(call.method, args)\n",
    to: '  const touched =\n    FILE_ACCESS[call.method]?.kind === "read" ? null : fileAccess(call.method, args)\n',
    suite: "lanes",
    scenario: "shared",
    expect:
      "your writes are versions as you make them, and a lane's write over one it never read is concurrent",
  },
  {
    name: "a shared write is never concurrent",
    file: "packages/rules/shared.ts",
    from: "  (v.baseAt !== null &&\n",
    to: "  (false &&\n",
    suite: "lanes",
    scenario: "shared",
    expect:
      "two lanes write one shared file: the write over the other's is flagged concurrent, the other is not",
  },
  {
    name: "the host writes a .pinetrie/ in the project again",
    file: "packages/jj/startup.ts",
    from: '  const git = await run("git", ["rev-parse", "--git-dir"], {\n',
    to: '  const git = await run("sh", ["-c", "mkdir -p .pinetrie && git rev-parse --git-dir"], {\n',
    suite: "lanes",
    scenario: "main",
    expect: "nothing of pine·trie's is written in your project",
  },
  {
    name: "a run's ignored writes are all local",
    file: "packages/rules/disk.ts",
    from: "        ((readSource && !(readFirst.has(w.path) && !w.created)) ||\n",
    to: "        (false ||\n",
    suite: "lanes",
    scenario: "recipe",
    expect:
      "a turn's record names its runs' outputs derived, and a file a command wrote from nothing local",
  },
  {
    name: "the turn's runs are never drained",
    file: "apps/pinetrie/host/work/disk.ts",
    from: "  const drained = await drainLaneRuns(channel, runs)\n",
    to: "  const drained = { runs: [], toolWrites: [], toolShared: [] }\n",
    suite: "lanes",
    scenario: "recipe",
    expect:
      "a directory a run made from source that .gitignore misses is named in the turn's record",
  },
  {
    name: "a lane mounts no host path",
    file: "packages/lanes/plan.ts",
    from: "    ...parts.hostPaths.map(p => at(p, hostPathInLane(p))),\n",
    to: "",
    suite: "lanes",
    scenario: "commands",
    expect: "the lane reads the skill's references and runs its scripts there",
  },
  {
    name: "a shared directory inside .jj is shared",
    file: "packages/lanes/plan.ts",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  return NEVER_SHARED.includes(top) ? `it is inside ${top}` : null",
    to: "  return null",
    suite: "lanes",
    scenario: "shared",
    expect:
      "the user's shared directories apply, and a refused one is logged with its reason",
  },
  {
    name: "a container made from another spec is kept",
    file: "packages/lanes/plan.ts",
    from: '  if (label !== input.want) return "recreate"',
    to: '  if (false) return "recreate"',
    suite: "lanes",
    scenario: "shared",
    expect:
      "after a restart, an existing lane has the newly shared directory, with its disk as it was",
  },
  {
    name: "pre-rename: a fork keeps the old config folder",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  laneShell(`rm -rf ${OLD_LANE_CONFIG_DIR}`),\n  ...input.setup.steps,\n",
    to: "  ...input.setup.steps,\n",
    command: unit,
    expect:
      "planFork: the restore, the container, the old config folder gone, then the adapter's setup",
  },
  {
    name: "a turn's snapshot is taken before sync",
    file: plan,
    from: '  inLane("sync"),\n  onRuntime({ kind: "snapshot", lane: input.lane, snapshot: input.snapshot }),\n',
    to: '  onRuntime({ kind: "snapshot", lane: input.lane, snapshot: input.snapshot }),\n  inLane("sync"),\n',
    command: unit,
    expect: "sync comes before the snapshot",
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
    name: "the lane's queue lets a tool run before the turn's snapshot finishes",
    file: "packages/lanes/lane.ts",
    from: "      await tail\n",
    to: "",
    command: unit,
    expect: "the gate opens only after a turn's snapshot finishes",
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
    from: "    ...shared.map(p => `/${p}/`),\n",
    to: "",
    command: unit,
    expect: "every repo in the lane ignores what the ignore file lists",
  },
  {
    name: "git's variables naming the ignore file are not set",
    file: plan,
    from: '      ["GIT_CONFIG_COUNT", "1"],\n',
    to: "",
    suite: "lanes",
    scenario: "shared",
    expect:
      "a shared directory is never in a lane's commit, your @ or a snapshot, and a branch sees it live",
  },
  {
    name: "shared directories are mounted read-only",
    file: plan,
    from: "    readonly: false,\n  }))",
    to: "    readonly: true,\n  }))",
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
    expect: "planStartFrom: a disk starts from it",
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
    name: "execute skips the runtime's disk operations",
    file: "packages/lanes/execute.ts",
    from: "      else await runtime.disk(step.op)\n",
    to: "",
    command: unit,
    expect: "runs each step where it says, in order",
  },
  {
    name: "the spec label hashes the shape's name, not the runtime's arguments",
    file: plan,
    from: "): string => specHash(runtime.runSpec(shape))",
    to: "): string => specHash([shape.name])",
    command: unit,
    expect: "specHashOf: the hash of the runtime's spec",
  },
  {
    name: "a lane's home is the image's",
    file: "packages/lanes/plan.ts",
    from: '      ["HOME", LANE_HOME],\n',
    to: "",
    command: unit,
    expect: "its home on its disk, and the shared directories",
  },
  {
    name: "an image's tag ignores the files its build copies in",
    file: "packages/lanes/plan.ts",
    from: '    .update("\\0")\n    .update(containerfile.sources.join("\\0"))\n',
    to: "",
    command: unit,
    expect: "planImages: a change to a file the build copies in is a new image",
  },
  {
    name: "a tool call's command runs bare",
    file: "packages/pi/lane-helper.ts",
    from: "    args[1] = launchOptions(run, args[1] as object | undefined)\n",
    to: "",
    suite: "lanes",
    scenario: "images",
    expect:
      "on Alpine, under Docker's default seccomp profile, a tool call's run is attributed: what it made from source is in its turn's record",
  },
  {
    name: "a base made another way is copied",
    file: "packages/lanes/plan.ts",
    from: "  base !== null && base.format === BASE_FORMAT\n",
    to: "  base !== null\n",
    command: unit,
    expect:
      "isCopyableBase: a base made the way they are now; one from before was made on a layer",
  },
  {
    name: "pnpm's store may be tracked in a lane",
    file: "packages/lanes/plan.ts",
    from: '    "/.pnpm-store/",\n',
    to: "",
    command: unit,
    expect:
      "every repo in the lane ignores what the ignore file lists, through git's own variables",
  },
  {
    name: "a lane's own copy turns a grant on",
    file: "packages/lanes/plan.ts",
    from: "      ssh: a.ssh && (!b.ssh || o.ssh),\n",
    to: "      ssh: a.ssh || o.ssh,\n",
    command: unit,
    expect:
      "effectiveLaneConfig: what a lane dropped from its base's copy, key by key, it gives up",
  },
  {
    name: "a shared directory a lane drops stays mounted",
    file: "packages/lanes/plan.ts",
    from: "      keeps(lane.base.shared, lane.own.shared, eq),\n",
    to: "      () => true,\n",
    command: unit,
    expect:
      "effectiveLaneConfig: what a lane dropped from its base's copy, key by key, it gives up",
  },
  {
    name: "a grant switched on goes unnamed",
    file: "packages/lanes/plan.ts",
    from: '    ...(a.ssh && !b.ssh ? [{ kind: "ssh" as const }] : []),\n',
    to: "",
    command: unit,
    expect:
      "configWidenings: what the second lets that the first does not, key by key",
  },
  {
    name: "the agent is not told what waits for acceptance",
    file: "packages/lanes/plan.ts",
    from: "  const waiting = configWidenings(accepted, written).map(wideningWords)\n",
    to: "  const waiting: string[] = []\n",
    command: unit,
    expect:
      "configChangeNote: what a lane gave up applies from its next run; what it asked for waits for acceptance",
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
    from: "curl procps python3 openssh-client \\",
    to: "curl procps openssh-client \\",
    suite: "lanes",
    scenario: "images",
    expect: "the default image has python3",
  },
  // ── a project's folder ──
  {
    name: "a home directory can be a project",
    file: "packages/lanes/plan.ts",
    from: "    path.resolve(root) === path.resolve(f.home) ||\n",
    to: "    false ||\n",
    command: unit,
    expect:
      "planProjectDir: jj's root, a jj project; else git's, else the folder, a folder project; never missing, your home directory or /",
  },
  {
    name: "a missing folder can be a project",
    file: "packages/lanes/plan.ts",
    from: "  if (!f.isDirectory)\n",
    to: "  if (false)\n",
    command: unit,
    expect:
      "planProjectDir: jj's root, a jj project; else git's, else the folder, a folder project; never missing, your home directory or /",
  },
  {
    name: "the inner Docker's PATH has no /usr/sbin",
    file: "packages/lanes/image/Containerfile",
    from: "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin dockerd-rootless.sh",
    to: "PATH=/usr/local/bin:/usr/bin:/bin dockerd-rootless.sh",
    command: unit,
    expect: "the default image's inner Docker finds ip and sysctl",
  },
  {
    name: "the inner Docker's runc makes session keyrings",
    file: "packages/lanes/image/Containerfile",
    from: ' then set -- "$@" --no-new-keyring; added=yes; fi',
    to: " then added=yes; fi",
    command: unit,
    expect: "the default image's runc adds --no-new-keyring",
  },
  {
    name: "lanes do not trust the working copy's .git, which a fetch reads",
    file: plan,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "  `[safe]\\n\\tdirectory = ${HOST_WORKING_COPY}\\n\\tdirectory = ${HOST_WORKING_COPY}/.git\\n`",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "  `[safe]\\n\\tdirectory = ${HOST_WORKING_COPY}\\n`",
    command: unit,
    expect:
      "every repo in the lane ignores what the ignore file lists, through git's own variables",
  },
  // ── lanes runs no jj ──
  {
    name: "a fork's lane steps run jj",
    file: plan,
    from: "  ...input.setup.steps,\n]",
    to: '  ...input.setup.steps,\n  inLane("jj", "new"),\n]',
    command: unit,
    expect: "@pinetrie/lanes names jj as a command nowhere but its image check",
  },
  // tsc names no failing check: with typecheck clean, any error is the mutant's.
  {
    name: "a base's checkout is a fork's setup",
    file: "packages/lanes/history-port.ts",
    from: "  readonly [baseCheckoutBrand]: true\n",
    to: "  readonly [forkSetupBrand]: true\n",
    command: ["pnpm", "exec", "tsc", "--noEmit"],
  },
  {
    name: "a merge takes any copy's facts",
    file: "packages/lanes/history-port.ts",
    from: "    ready: ReadyCopy,\n",
    to: "    ready: { readonly parents: readonly CommitId[] },\n",
    command: ["pnpm", "exec", "tsc", "--noEmit"],
  },
]
