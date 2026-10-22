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
]
