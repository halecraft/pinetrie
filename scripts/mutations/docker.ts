// Mutations for @pinetrie/docker and the lane VM's launcher, each caught by
// the `contract` scenario of `e2e:lanes` under Docker, the suites' default:
//
//   pnpm mutate scripts/mutations/docker.ts [name]
//
// On the Mac the scenario boots a VM of its own from this checkout's
// launcher, so a mutation of `launcher.swift` is what runs (it is built
// again, about 30 s). A mutation named (Mac) or (Linux) bites only on that
// platform: the working copy, for one, is held by the Mac's share flag
// there, and by the lane's read-only bind on Linux.
import type { Mutation } from "../mutate.ts"

const plan = "packages/docker/plan.ts"
const launcher = "packages/vm/launcher/launcher.swift"
const unit = (path: string) => ["pnpm", "exec", "vitest", "run", path]

export const mutations: readonly Mutation[] = [
  {
    name: "a slot's stop answers before its containers have died",
    file: "packages/docker/runtime.ts",
    from: "      await waitContainer(target, name)\n",
    to: "      void waitContainer(target, name)\n",
    command: unit("packages/docker"),
    expect:
      "stopSlot kills every container bound into the slot, and answers only once each has died, removing none",
  },
  {
    name: "a slot's stop removes what it stops",
    file: "packages/docker/runtime.ts",
    from: "      await waitContainer(target, name)\n",
    to: "      await waitContainer(target, name)\n      await removeContainer(target, name)\n",
    command: unit("packages/docker"),
    expect:
      "stopSlot kills every container bound into the slot, and answers only once each has died, removing none",
  },
  {
    name: "a host stops the leftovers of a slot other than the one it fills (Mac)",
    file: "apps/pinetrie/host/work/runtime.ts",
    from: "      slotRoot(slot),\n      names =>",
    to: "      slotRoot(slot + 1),\n      names =>",
    suite: "lanes",
    scenario: "contract",
    expect: "a host's start stops the last host's lanes and starts them again",
  },
  {
    name: "an oom's time is read as a JSON number",
    file: plan,
    from: '      : { timeNano: BigInt(time[1] ?? "0"), name, labels }',
    to: '      : { timeNano: BigInt(Number(time[1] ?? "0")), name, labels }',
    command: unit("packages/docker"),
    expect: "an oom's time is kept to the nanosecond",
  },
  {
    name: "the observer's kill is not named",
    file: plan,
    from: '  if (ours.observer !== null && event.name === ours.observer) return "observer"\n',
    to: "",
    command: unit("packages/docker"),
    expect: "each role of this project, and this version's observer, is named",
  },
  {
    name: "a role of any project is named",
    file: plan,
    from: "  if (event.labels[PROJECT_LABEL] !== ours.project) return null\n",
    to: "",
    command: unit("packages/docker"),
    expect:
      "a lane, another project's role and another version's observer are none",
  },
  {
    name: "a resume's since is not padded",
    file: plan,
    from: '(timeNano % 1_000_000_000n).toString().padStart(9, "0")',
    to: "(timeNano % 1_000_000_000n).toString()",
    command: unit("packages/docker"),
    expect: "a resume's since pads its nanoseconds",
  },
  {
    name: "the event at the last one heard is heard again",
    file: plan,
    from: "): boolean => event.timeNano > since",
    to: "): boolean => event.timeNano >= since",
    command: unit("packages/docker"),
    expect: "the event at the last one heard is not new",
  },
  {
    name: "the disks role's cgroup tree is bound read-write",
    file: plan,
    from: '        : [{ source: "/sys/fs/cgroup", target: cgroup, readonly: true }]),',
    to: '        : [{ source: "/sys/fs/cgroup", target: cgroup, readonly: false }]),',
    command: unit("packages/docker"),
    expect:
      "the disks role reads the machine's cgroup tree read-only, and the privileged role has none",
  },
  {
    name: "a nested lane's disks role is given the cgroup tree",
    file: plan,
    from: '  role === "disks" && !rootless ? HOST_CGROUP : null',
    to: '  role === "disks" ? HOST_CGROUP : null',
    command: unit("packages/docker"),
    expect: "under rootless Docker no role is given the cgroup tree",
  },
  {
    name: "a stopped lane is sampled as running",
    file: plan,
    from: '    return lane !== null && c.state === "running" && c.id !== ""',
    to: '    return lane !== null && c.id !== ""',
    command: unit("packages/docker"),
    expect: "the running lanes are the running containers named for a thread",
  },
  {
    name: "a runtime's base lane is not its project's",
    file: "packages/docker/runtime.ts",
    from: "    baseLane: baseLane(key),\n",
    to: '    baseLane: baseLane("0000000000000000"),\n',
    command: unit("packages/docker/runtime.test.ts"),
    expect: "a runtime builds its base in its own project's scratch lane",
  },
  {
    name: "a jj lane mounts a states directory",
    file: "packages/lanes/shape.ts",
    from: '  ...(shape.states ? (["states"] as const) : []),\n',
    to: '  ...(["states"] as const),\n',
    command: unit("packages/docker"),
    expect:
      "a folder lane sees its states directory, read-only; a jj lane's spec has no such mount",
  },
  {
    name: "readIn makes a state with a moved stamp",
    file: "packages/lanehost/folder.ts",
    from: '    if (moved.length > 0) return { kind: "moved", paths: moved }\n',
    to: "",
    command: unit("packages/lanehost"),
    expect:
      "a path whose stamp moved since the host read it makes no state, and is answered",
  },
  {
    name: "the disks role cannot see the project's folder",
    file: plan,
    from: '      ...(shape.role === "disks"',
    to: '      ...(shape.role === "privileged"',
    command: unit("packages/docker"),
    expect:
      "the install and the runtime, read-only where a lane has them, and the disks role's project root, through the slot",
  },
  {
    name: "a lane shares the machine's PID namespace",
    file: "packages/docker/plan.ts",
    from: '    devices: nested ? ["/dev/net/tun"] : [],\n    machine: null,\n',
    to: '    devices: nested ? ["/dev/net/tun"] : [],\n    machine: { tmpfs: [] },\n',
    command: ["pnpm", "exec", "vitest", "run", "packages/docker/plan.test.ts"],
    expect:
      "every shape keeps a PID namespace of its own: the observer's lane is it",
  },
  {
    name: "a host removes a tag it needs",
    file: plan,
    from: "        !input.neededTags.has(tag) &&\n",
    to: "",
    command: unit("packages/docker"),
    expect:
      "a needed tag is never removed, though it shares a repository with another",
  },
  {
    name: "a host removes an image a container uses",
    file: plan,
    from: "    .filter(image => !input.imageIdsContainersUse.has(image.id))\n",
    to: "",
    command: unit("packages/docker"),
    expect: "an image a container was made from keeps all its tags",
  },
  {
    name: "a host removes another repository's images",
    file: plan,
    from: "        PINETRIE_IMAGE_REPOSITORIES.includes(tagRepository(tag)),\n",
    to: "        true,\n",
    command: unit("packages/docker"),
    expect: "an image of any other repository is never touched",
  },
  {
    name: "a missing image at a container's create is never told",
    file: "packages/docker/api.ts",
    from: "  answered.status === 404 && /no such image/i.test(apiMessage(answered))\n",
    to: "  false\n",
    command: unit("packages/docker"),
    expect:
      "a create refused for a missing image is told from any other refusal",
  },
  {
    name: "an image a container holds is a failed removal",
    file: "packages/docker/api.ts",
    from: "  ok(answered) || answered.status === 404 || answered.status === 409\n",
    to: "  ok(answered) || answered.status === 404\n",
    command: unit("packages/docker"),
    expect:
      "an image's removal is settled when done, gone, or held by a container",
  },
  {
    name: "the inner Docker keeps its data beside the data root",
    file: "packages/lanes/image/Containerfile",
    from: "dockerd-rootless.sh --data-root /var/lib/pinetrie-lanes/docker ",
    to: "dockerd-rootless.sh --data-root /var/lib/pinetrie-lanes/inner ",
    command: unit("packages/docker"),
    expect:
      "the lane image's inner Docker keeps its data at the data root a fork clones",
  },
  {
    name: "a root matches any path that starts with its text",
    file: plan,
    from: "  return bind === dir || bind.startsWith(`${dir}/`)\n",
    to: "  return bind.startsWith(dir)\n",
    command: unit("packages/docker"),
    expect: "a root is a whole path: slot 1's is not slot 10's",
  },
  {
    name: "the sweep takes an unlisted project's containers anywhere",
    file: plan,
    from: "    c.binds.every(b => isBindUnder(input.lanesDir, b))\n",
    to: "    true\n",
    command: unit("packages/docker"),
    expect:
      "it takes an unlisted project's containers in its lanes directory, and none elsewhere",
  },
  {
    name: "an unlisted project's network goes with containers left",
    file: plan,
    from: "    unlistedNetworks: [...unlisted].filter(k => !left.has(k)).sort(),\n",
    to: "    unlistedNetworks: [...unlisted].sort(),\n",
    command: unit("packages/docker"),
    expect: "an unlisted project's network stays while it has a container left",
  },
  // ── the machine's health ──
  {
    name: "(Mac) the lane VM boots without pressure stall information",
    file: launcher,
    from: '"console=hvc0 quiet psi=1 lane.slots=',
    to: '"console=hvc0 quiet lane.slots=',
    suite: "lanes",
    scenario: "contract",
    expect: "the lane VM's kernel reports memory pressure",
  },
  {
    name: "a lane's cgroup is looked for where no driver puts it",
    file: "packages/lanehost/machine.ts",
    from: "  `docker/${id}`,\n",
    to: "  `moby/${id}`,\n",
    suite: "lanes",
    scenario: "contract",
    expect:
      "lanehost's disks role reads each running lane's memory from its cgroup",
  },
  {
    name: "the events stream asks for a container's death, not its kill",
    file: "packages/docker/api.ts",
    from: 'const OOM_EVENTS = JSON.stringify({ type: ["container"], event: ["oom"] })',
    to: 'const OOM_EVENTS = JSON.stringify({ type: ["container"], event: ["die"] })',
    suite: "lanes",
    scenario: "contract",
    expect: "Docker's events name lanehost's disks role killed for memory",
  },
  // ── the lanes suite, proven in a lane ──
  {
    name: "lanes share the network of the machine Docker runs on",
    file: "packages/docker/plan.ts",
    from: "    network: projectNetwork(input.project),",
    to: '    network: "host",',
    suite: "lanes",
    scenario: "main",
    expect: "two lanes serve :5173 at once, each its own",
  },
  {
    name: "a lane's disk is mounted read-only",
    file: "packages/docker/plan.ts",
    from: "        target: WORKSPACE_ROOT,\n        readonly: false,",
    to: "        target: WORKSPACE_ROOT,\n        readonly: true,",
    suite: "lanes",
    scenario: "main",
    expect:
      "two lanes write the same file, each on its own disk, and your working copy is untouched",
  },
  {
    name: "a snapshot is a new empty subvolume, not a snapshot of the lane",
    file: "packages/lanehost/btrfs.ts",
    from: '  btrfs(["subvolume", "snapshot", ...(readonly ? ["-r"] : []), from, to])\n',
    to: '  btrfs(["subvolume", "create", to])\n',
    suite: "lanes",
    scenario: "contract",
    expect:
      "every snapshot taken while a lane writes holds every record written before it",
  },
  {
    name: "(Mac) the slot shares every directory read-write",
    file: "packages/vm/plan.ts",
    from: "    .map(([source, ro]) => ({ name: entryName(source), source, readOnly: ro }))",
    to: "    .map(([source]) => ({ name: entryName(source), source, readOnly: false }))",
    suite: "lanes",
    scenario: "contract",
    expect:
      "the working copy cannot be written from a lane, nor on the Mac from a container with CAP_SYS_ADMIN",
  },
  {
    name: "(Linux) a lane's read-only mounts are bound read-write",
    file: plan,
    from: "  target: m.target,\n  readonly: m.readonly,\n",
    to: "  target: m.target,\n  readonly: false,\n",
    suite: "lanes",
    scenario: "contract",
    expect:
      "the working copy cannot be written from a lane, nor on the Mac from a container with CAP_SYS_ADMIN",
  },
  {
    name: "(Mac) the launcher's bridge closes a socket where it should shut its write side",
    file: launcher,
    from: "    shutdown(to, SHUT_WR)\n",
    to: "    close(to)\n",
    suite: "lanes",
    scenario: "contract",
    expect:
      "echo hi | docker run -i … cat returns hi: stdin's end reaches the lane, and its output comes back",
  },
  {
    name: "(Mac) every lane runs without seccomp",
    file: plan,
    from: '      : ["no-new-privileges"],',
    to: '      : ["no-new-privileges", "seccomp=unconfined"],',
    suite: "lanes",
    scenario: "contract",
    expect: "a lane cannot open a vsock socket",
  },
  {
    name: "(Mac) a fill replaces every slot's share, not its own",
    file: launcher,
    from: "    guard setShare(i, share) else {\n",
    to: "    guard (0..<slotCount).map({ setShare($0, share) }).allSatisfy({ $0 }) else {\n",
    suite: "lanes",
    scenario: "contract",
    expect:
      "a second host started and stopped beside the first leaves the first's lane reading its working copy and writing its shared directory",
  },
  // ── unit checks, in seconds ──
  {
    name: "a lane's container carries no project label",
    file: plan,
    from: "  [PROJECT_LABEL]: project,\n  ...target.labels,\n  ...more,\n",
    to: "  ...target.labels,\n  ...more,\n",
    command: unit("packages/docker"),
    expect: "the project's and the target's labels",
  },
  {
    name: "the host socket is mounted in a lane that asks for none",
    file: plan,
    from: "    shape.hostSocket !== null && target.hostSocket !== null\n",
    to: "    target.hostSocket !== null\n",
    command: unit("packages/docker"),
    expect:
      "the host socket is mounted where the shape says, only when it asks for one",
  },
  {
    name: "a lane's starts are never run",
    file: plan,
    from: "  if (!lane.nested && lane.starts.length === 0)",
    to: "  if (!lane.nested)",
    command: unit("packages/docker"),
    expect:
      "a lane's starts run in the background before its wait, and before a nested lane's Docker",
  },
  {
    name: "every lane gets the nested options",
    file: plan,
    from: "  const nested = shape.nested\n",
    to: "  const nested = true\n",
    command: unit("packages/docker"),
    expect: "the nested options only for a nested shape",
  },
  {
    // Proven in a lane: `disks.test.ts` skips where `/workspace` is no btrfs.
    name: "a drop leaves the read-only subvolumes inside a disk",
    file: "packages/lanehost/btrfs.ts",
    from: "  for (const inner of subvolumesDeepestFirst(await subvolumesUnder(at)))\n    await deleteSubvolume(inner)\n",
    to: "",
    command: unit("packages/lanehost"),
    expect:
      "a lane's delete takes a nested disk holding read-only snapshots, and a lane disk holding one",
  },
  {
    // Proven in a lane: `disks.test.ts` skips where `/workspace` is no btrfs.
    name: "a restore takes its snapshot's subvolume, not a snapshot of it",
    file: "packages/lanehost/disks.ts",
    from: '        {\n          kind: "snapshot",\n          from: disks.snapshot(call.from),\n          to: disks.lane(call.lane),\n          readonly: false,\n        },\n',
    to: '        { kind: "move", from: disks.snapshot(call.from), to: disks.lane(call.lane) },\n',
    command: unit("packages/lanehost"),
    expect:
      "a lane restored from another's snapshot is apart from it: neither's writes reach the other",
  },
  {
    name: "a lane's delete leaves its inner lanes' disk",
    file: "packages/lanehost/disks.ts",
    from: '        { kind: "drop", path: disks.nested(call.lane) },\n',
    to: "",
    command: unit("packages/lanehost"),
    expect: "a lane's delete takes its inner lanes' disk",
  },
  {
    name: "Docker without buildx runs lanes",
    file: plan,
    from: '  if (f.buildx !== null)\n    return { kind: "no-buildx", platform: f.platform, said: f.buildx }\n',
    to: "",
    command: unit("packages/docker"),
    expect: "each refusal in order",
  },
  {
    name: "btrfs without user_subvol_rm_allowed runs lanes",
    file: plan,
    from: '    if (!fs.rmAllowed) return { kind: "no-rm-allowed", dir }\n',
    to: "",
    command: unit("packages/docker"),
    expect: "each refusal in order",
  },
  {
    name: "a slot's sweep takes containers of other slots",
    file: plan,
    from: "    .filter(c => c.binds.some(b => isBindUnder(root, b)))\n",
    to: "    .filter(c => c.binds.length > 0)\n",
    command: unit("packages/docker"),
    expect:
      "a slot's sweep takes every container with a bind into it, whatever its labels",
  },
  {
    name: "the startup sweep takes a live project's containers",
    file: plan,
    from: "    c => gone.has(projectOf(c)) || isOrphan(c),\n",
    to: "    c => c.labels[PROJECT_LABEL] !== undefined,\n",
    command: unit("packages/docker"),
    expect:
      "the startup sweep takes the containers and disks of projects whose root is gone",
  },
  {
    name: "the nested profile lets a lane open any socket family",
    file: "packages/docker/seccomp-nested.ts",
    from: "      ...base.syscalls.filter(r => !refusesNamespaces(r)),\n",
    to: '      ...base.syscalls.filter(r => !refusesNamespaces(r) && !r.names.includes("socket")),\n',
    command: unit("packages/docker"),
    expect:
      "the checked-in profile is the generator's output from the checked-in default",
  },
  {
    name: "the checked-in nested profile allows AF_VSOCK",
    file: "packages/docker/seccomp-nested.json",
    from: '"value": 39,',
    to: '"value": 40,',
    command: unit("packages/docker"),
    expect: "socket's rules are the default's",
  },
  {
    name: "a nested shape is never made",
    file: "packages/lanes/shape.ts",
    from: "    nested: spec.grants.nested,\n",
    to: "    nested: false,\n",
    command: unit("packages/docker"),
    expect: "the nested options only for a nested shape",
  },
  {
    name: "lanes.nested is granted when unwritten",
    file: "apps/pinetrie/host/settings.ts",
    from: '      nested: values["lanes.nested"] ?? false,\n',
    to: "      nested: true,\n",
    command: unit("apps/pinetrie/host/settings.test.ts"),
    expect: "a grant left unwritten is not granted",
  },
  {
    name: "a VM is given more slots than it boots with",
    file: "apps/pinetrie/host/settings.ts",
    from: '  "lanes.vm.slots": pick(count({ min: 1, max: MAX_VM_SLOTS }), {',
    to: '  "lanes.vm.slots": pick(count({ min: 1, max: 32 }), {',
    command: unit("apps/pinetrie/host/settings.test.ts"),
    expect: "a VM's slots above 20 are refused",
  },
  {
    name: "a host in a nested lane keeps its lanes in the state directory",
    file: "apps/pinetrie/host/work/runtime.ts",
    from: "    lanesDir: f.nestedMount\n",
    to: "    lanesDir: false\n",
    command: unit("apps/pinetrie/host/work/runtime.test.ts"),
    expect:
      "inside a lane granted lanes of its own, its inner lanes' directory",
  },
  {
    name: "a refusal drops what the command said",
    file: plan,
    from: '  said === "" ? "" : ` (it said: ${said})`',
    to: '  said === "" ? "" : ""',
    command: unit("packages/docker"),
    expect: "a refusal carries what the command said",
  },
  {
    name: "a lane's hostname is Docker's container id",
    file: plan,
    from: "    hostname: shape.name,\n",
    to: "    hostname: null,\n",
    command: unit("packages/docker"),
    expect: "the lane's hostname is its container's name",
  },
  {
    name: "a failed build reports buildx's first line",
    file: "packages/docker/cli.ts",
    from: "    lines.findLast(l => /^ERROR\\b|^error:/i.test(l)) ??\n",
    to: "    lines[0] ??\n",
    command: unit("packages/docker"),
    expect: "a failed build names buildx's error, not its builder",
  },
  {
    name: "a host whose Docker does not answer is given lanes",
    file: "apps/pinetrie/host/work/runtime.ts",
    from: "  if (refusal !== null) return refusedWith(dockerWords(refusal))\n  const observed = planObserver({",
    to: "  const observed = planObserver({",
    command: unit("apps/pinetrie/host/work/runtime.test.ts"),
    expect: "a Docker that does not answer, in the runtime's words",
  },
  {
    name: "lanes share Docker's default network, whatever their project",
    file: plan,
    from: "    network: projectNetwork(input.project),",
    to: '    network: "bridge",',
    command: unit("packages/docker"),
    expect: "every lane is on its project's network",
  },
  {
    name: "a lane is told the host's ports where there is no host address",
    file: plan,
    from: "  const hostPorts = target.hostAddress !== null && shape.hostPorts.length > 0",
    to: "  const hostPorts = shape.hostPorts.length > 0",
    command: unit("packages/docker"),
    expect: "a lane is told the host's address and its granted ports",
  },
  {
    name: "a project's grant applies to every project's lanes",
    file: "packages/lanehost/grants.ts",
    from: "          `-I DOCKER-USER -s ${subnet} -j ${chain}`,",
    to: "          `-I DOCKER-USER -j ${chain}`,",
    command: unit("packages/lanehost"),
    expect: "the rules accept each port only from the project's network",
  },
  {
    name: "a lane is granted the host's own port",
    file: "apps/pinetrie/host/work/shares.ts",
    from: "    grant: changed ? wanted.hostPorts.filter(p => p !== ownPort) : null,",
    to: "    grant: changed ? wanted.hostPorts : null,",
    command: unit("apps/pinetrie/host/work/shares.test.ts"),
    expect: "the host's own port is never granted, and is said with why",
  },
  {
    name: "lanehost's privileged role writes the lanes directory",
    file: "packages/docker/plan.ts",
    from: '      readonly: spec.lanesDir === "ro",\n',
    to: "      readonly: false,\n",
    suite: "lanes",
    scenario: "contract",
    expect: "lanehost's privileged role cannot write the lanes directory",
  },
  {
    name: "a walk's diff drops what was deleted",
    file: "packages/lanehost/walk.ts",
    from: '    if (!after.has(p)) out.push({ path: p, change: "deleted", kind: b.kind })\n',
    to: "",
    suite: "lanes",
    scenario: "contract",
    expect:
      "a diff between two snapshots of a lane reports a file it deleted, and one it made",
  },
  {
    name: "(Mac) a send stream's diff drops what was unlinked",
    file: "packages/lanehost/send-stream.ts",
    from: '        deleted(resolve(path), "file")\n',
    to: "",
    suite: "lanes",
    scenario: "contract",
    expect:
      "a diff between two snapshots of a lane reports a file it deleted, and one it made",
  },
  // ── a folder project's merges, on btrfs ──
  {
    name: "applyMerge writes a text result equal to ours",
    file: "packages/lanehost/folder.ts",
    from: "  if ((clean || markers) && !(await isSameBytes(result, files.ours))) {\n",
    to: "  if (clean || markers) {\n",
    command: unit("packages/lanehost/folder.test.ts"),
    expect: "a text merge whose result is ours writes nothing",
  },
  {
    name: "applyMerge writes through a symlinked directory on its disk",
    file: "packages/lanehost/folder.ts",
    from: "    if (!(await isUnderDirs(disk, p)))\n",
    to: "    if (false)\n",
    command: unit("packages/lanehost/folder.test.ts"),
    expect: "a take through a symlinked directory on the disk is refused",
  },
  // ── the network, the contract's checks ──
  {
    name: "(Mac) a lane is on the VM's own network, outside the fence",
    file: plan,
    from: "    network: projectNetwork(input.project),",
    to: '    network: "host",',
    suite: "lanes",
    scenario: "contract",
    expect:
      "a lane cannot reach the Mac's loopback, nor gvproxy's API that opens ports on the Mac",
  },
  {
    name: "(Mac) a project's grant reaches every project's lanes",
    file: "packages/lanehost/grants.ts",
    from: "          `-I DOCKER-USER -s ${subnet} -j ${chain}`,",
    to: "          `-I DOCKER-USER -j ${chain}`,",
    suite: "lanes",
    scenario: "contract",
    expect:
      "a port of the Mac's loopback the project grants answers its lanes, and not another project's",
  },

  {
    name: "(Mac) a host whose VM stopped does not lease again",
    file: "packages/vm/keep.ts",
    from: "      if (!closing && held === lease) return again()",
    to: "      if (!closing && held === lease) return",
    suite: "lanes",
    scenario: "contract",
    expect:
      "a host whose lane VM stops leases again, and a new lane runs and reads its working copy",
  },
  {
    name: "a lane's missing image is pulled, never built",
    file: "packages/docker/api.ts",
    from: "    if (!(await buildMissing(spec.image))) {\n",
    to: "    if (true) {\n",
    suite: "lanes",
    scenario: "contract",
    expect:
      "a lane whose image another host removed is made, its image built again",
  },
  {
    name: "a host lists no images, so removes none",
    file: "packages/docker/api.ts",
    from: "  return ok(answered) ? parseImages(answered.body) : []\n",
    to: "  return []\n",
    suite: "lanes",
    scenario: "contract",
    expect:
      "after a build, an image of pine·trie's no container uses is removed, and one a stopped container uses stays",
  },
]
