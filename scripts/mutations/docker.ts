// Mutations for @pinetrie/docker and the lane VM's launcher, each caught by
// the `contract` scenario of `e2e:lanes` under Docker, the suites' default:
//
//   pnpm mutate scripts/mutations/docker.ts [name]
//
// On the Mac the scenario boots a VM of its own from this checkout's
// launcher, so a mutation of `launcher.swift` is what runs (it is built
// again, about 30 s). Two only bite on one platform, and say so: the
// working copy is held by the Mac's share flag there, and by the lane's
// read-only bind on Linux.
import type { Mutation } from "../mutate.ts"

const plan = "packages/docker/plan.ts"
const launcher = "packages/vm/launcher/launcher.swift"
const unit = (path: string) => ["pnpm", "exec", "vitest", "run", path]

export const mutations: readonly Mutation[] = [
  // ── the lanes suite, proven in a lane (ADR-0130) ──
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
    name: "a lane granted ssh is given no agent",
    file: "packages/docker/plan.ts",
    from: "  const ssh = shape.ssh && target.sshAgent !== null",
    to: "  const ssh = false && target.sshAgent !== null",
    suite: "lanes",
    scenario: "main",
    expect: "with ssh granted, the lane has SSH_AUTH_SOCK",
  },
  {
    name: "a snapshot is a new empty subvolume, not a snapshot of the lane",
    file: "packages/lanehost/disks.ts",
    from: '      case "snapshot":\n        await btrfs([\n          "subvolume",\n          "snapshot",\n          ...(step.readonly ? ["-r"] : []),\n          step.from,\n          step.to,\n        ])\n',
    to: '      case "snapshot":\n        await btrfs(["subvolume", "create", step.to])\n',
    suite: "lanes",
    scenario: "contract",
    expect:
      "every snapshot taken while a lane writes holds every record written before it",
  },
  {
    name: "(Mac) the slot shares every directory read-write",
    file: "packages/vm/plan.ts",
    from: "    .map(([source, ro]) => ({ name: nameOf(source), source, readOnly: ro }))",
    to: "    .map(([source]) => ({ name: nameOf(source), source, readOnly: false }))",
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
  {
    name: "(Mac) the data disk is attached with Apple's full synchronization",
    file: launcher,
    from: "    url: url(dataPath), readOnly: false, cachingMode: .cached, synchronizationMode: .fsync)\n",
    to: "    url: url(dataPath), readOnly: false, cachingMode: .cached, synchronizationMode: .full)\n",
    suite: "lanes",
    scenario: "contract",
    expect:
      "a lane's docker run -d takes under 150 ms, a snapshot under 50 ms, and a cold VM answers in under 2 s",
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
    name: "ssh is forwarded without the grant",
    file: plan,
    from: "  const ssh = shape.ssh && target.sshAgent !== null",
    to: "  const ssh = target.sshAgent !== null",
    command: unit("packages/docker"),
    expect: "ssh: the slot's agent, only with the grant",
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
    from: "c.labels[SLOT_LABEL] === String(slot)",
    to: "c.labels[SLOT_LABEL] !== undefined",
    command: unit("packages/docker"),
    expect:
      "a slot's sweep takes every container labelled with it, and no other",
  },
  {
    name: "the startup sweep takes a live project's containers",
    file: plan,
    from: '      .filter(c => gone.has(c.labels[PROJECT_LABEL] ?? ""))',
    to: "      .filter(c => c.labels[PROJECT_LABEL] !== undefined)",
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
    file: "packages/lanes/plan.ts",
    from: "    nested: spec.grants.nested,\n",
    to: "    nested: false,\n",
    command: unit("packages/docker"),
    expect: "the nested options only for a nested shape",
  },
  {
    name: "lanes.nested is granted by any value",
    file: "packages/lanes/plan.ts",
    from: "      nested: lanes.nested === true,\n",
    to: "      nested: lanes.nested !== undefined,\n",
    command: unit("packages/lanes"),
    expect: "lanes.nested grants lanes inside a lane, only when true",
  },
  {
    name: "a VM is given more slots than it boots with",
    file: "packages/lanes/plan.ts",
    from: "    n <= MAX_VM_SLOTS",
    to: "    n <= 32",
    command: unit("packages/lanes"),
    expect: "more than 20 slots, refused with why",
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
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
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
    from: "  if (refusal !== null) return refusedWith(dockerWords(refusal))\n  const runtime = dockerRuntime({ target, lanesDir, root, log })\n  log(",
    to: "  const runtime = dockerRuntime({ target, lanesDir, root, log })\n  log(",
    command: unit("apps/pinetrie/host/work/runtime.test.ts"),
    expect: "a Docker that does not answer, in the runtime's words",
  },
  {
    name: "a folder with no jj repo is given lanes",
    file: "packages/lanes/plan.ts",
    from: '  if (d.repo !== "jj")\n    return {',
    to: "  if (false)\n    return {",
    command: unit("apps/pinetrie/host/work/runtime.test.ts"),
    expect: "a folder with no jj repo, with how to make one",
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
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "          `-I DOCKER-USER -s ${subnet} -j ${chain}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
    to: "          `-I DOCKER-USER -j ${chain}`,",
    command: unit("packages/lanehost"),
    expect: "the rules accept each port only from the project's network",
  },
  {
    name: "a lane is granted the host's own port",
    file: "apps/pinetrie/host/work/runtime.ts",
    from: "  return { grant: ports.filter(p => p !== ownPort), refused }",
    to: "  return { grant: ports, refused }",
    command: unit("apps/pinetrie/host/work/runtime.test.ts"),
    expect: "planHostPortGrant: the granted ports, but the host's own",
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
  // ── the network (S135, S136), the contract's checks ──
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
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the anchor is source text
    from: "          `-I DOCKER-USER -s ${subnet} -j ${chain}`,",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the mutant is source text
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
]
