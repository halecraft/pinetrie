// Mutations for @pinetrie/lanehost. Run: pnpm mutate scripts/mutations/lanehost.ts
// The planners' checks are unit tests, in seconds; the disks module's checks
// on btrfs run only in a lane, where `packages/lanehost/disks.test.ts` is on
// the lane VM's btrfs.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/lanehost"]
const disks = "packages/lanehost/disks.ts"

export const mutations: readonly Mutation[] = [
  // ── the machine's sample ──
  {
    name: "a cgroup is read by any name it is asked",
    file: "packages/lanehost/machine.ts",
    from: "export const isContainerId = (id: string): boolean => /^[0-9a-f]{64}$/.test(id)",
    to: 'export const isContainerId = (id: string): boolean => id !== ""',
    command: unit,
    expect: "only a full container id names a cgroup",
  },
  {
    name: "the room counts only data's chunks",
    file: "packages/lanehost/machine.ts",
    from: "    input.data.diskTotal + input.metadata.diskTotal + input.system.diskTotal",
    to: "    input.data.diskTotal",
    command: unit,
    expect: "a full 2 GiB disk's room is its 1 MiB unallocated",
  },
  {
    name: "the reclaim reads one zone's stalls",
    file: "packages/lanehost/machine.ts",
    from: '  const stalls = [...counts].filter(([name]) => name.startsWith("allocstall_"))',
    to: '  const stalls = [...counts].filter(([name]) => name === "allocstall_normal")',
    command: unit,
    expect: "vmstat's reclaim: every zone's stalls summed, and both scans",
  },
  // ── the observer's client ──
  {
    name: "connect opens no channel",
    file: "packages/lanehost/observer-client.ts",
    from: "    async connect() {\n      await opened()\n    },\n",
    to: "    async connect() {},\n",
    command: unit,
    expect:
      "connect opens the channel once, and a lane observed after it registers on that channel",
  },
  {
    name: "a server starts without its nested disk's values",
    file: "packages/lanehost/serving.ts",
    from: "  if (!isNestedDisk(parsed.nested))\n",
    to: "  if (false)\n",
    command: unit,
    expect:
      "a server's arguments without a nested disk's owner and data root are refused",
  },
  // ── a nested lane's inner Docker data root ──
  {
    name: "a lane's data root is dropped for a source that has gone",
    file: disks,
    from: '    facts.sourceDataRoot === "subvolume"\n',
    to: "    facts.sourceDataRoot !== null\n",
    command: unit,
    expect: "a source whose data root has gone leaves the lane's own as it is",
  },
  {
    name: "a lane clones its own data root",
    file: disks,
    from: "    cloneFromLane !== lane &&\n",
    to: "",
    command: unit,
    expect: "the lane itself is never its source",
  },
  {
    name: "a cloned data root is read-only",
    file: disks,
    from: "        to: dataRoot,\n        readonly: false,\n",
    to: "        to: dataRoot,\n        readonly: true,\n",
    command: unit,
    expect:
      "a source that is a subvolume is cloned, writable, in place of the lane's own",
  },
  {
    name: "a plain docker/ is kept as it is",
    file: disks,
    from: '    ...(facts.ownDataRoot === "not-subvolume"\n',
    to: "    ...(false\n",
    command: unit,
    expect:
      "a plain directory is made a subvolume, and a missing one made, the rootless user's",
  },
  {
    name: "a disks server serves without its project's lock",
    file: "packages/lanehost/start-serving.ts",
    from: "  if (serving.holds === null) return ports.serve(null, answerCall)\n",
    to: "  return ports.serve(null, answerCall)\n",
    command: unit,
    expect:
      "the lock is held before the drop, and the drop runs before any call is answered",
  },
  {
    name: "the client keeps a server that refused",
    file: "packages/lanehost/client.ts",
    from: "      if (hello.refused !== null) {\n",
    to: "      if (false) {\n",
    command: unit,
    expect:
      "a server that refused is let go with its words, and the next call opens another",
  },
  {
    name: "the runtime's disks server locks no project",
    file: "packages/docker/runtime.ts",
    from: '          role === "disks" ? key : null,\n',
    to: "          null,\n",
    suite: "lanes",
    scenario: "contract",
    expect: "a second host on a served project is refused",
  },
  {
    name: "a closed lanehost client still calls",
    file: "packages/lanehost/client.ts",
    from: "      closed = true\n      const opened",
    to: "      const opened",
    command: unit,
    expect: "close ends every channel, and a call after it is refused",
  },
  {
    name: "a closed observer client still connects",
    file: "packages/lanehost/observer-client.ts",
    from: "      closed = true\n      reset()\n",
    to: "      reset()\n",
    command: unit,
    expect: "close ends the channel, and a call after it is refused",
  },
  {
    name: "a service's cgroup is not looked for under the services' parent",
    file: "packages/lanehost/machine.ts",
    from: "  `${SERVICES_CGROUP}/${id}`,\n",
    to: "",
    command: unit,
    expect:
      "a service under the services' parent is found and read, as a lane under Docker's own",
  },
  {
    name: "a container's controls are not read",
    file: "packages/lanehost/machine.ts",
    from: "            controls: await readControls(dir),\n",
    to: "            controls: NO_CONTROLS,\n",
    command: unit,
    expect:
      "the controls read from pids.max and cpu.weight, and max reads null",
  },
  {
    name: "the services' floor is read from Docker's parent",
    file: "packages/lanehost/machine.ts",
    from: '  const low = await readOrNull(path.join(tree, SERVICES_CGROUP, "memory.low"))\n',
    to: '  const low = await readOrNull(path.join(tree, "docker", "memory.low"))\n',
    command: unit,
    expect:
      "the services' floor is their parent's memory.low, and none where it is not there",
  },
]
