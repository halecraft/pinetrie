// Mutations for @pinetrie/lanehost. Run: pnpm mutate scripts/mutations/lanehost.ts
// The planners' checks are unit tests, in seconds; the disks module's checks
// on btrfs run only in a lane, where `packages/lanehost/disks.test.ts` is on
// the lane VM's btrfs.
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/lanehost"]
const disks = "packages/lanehost/disks.ts"

export const mutations: readonly Mutation[] = [
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
