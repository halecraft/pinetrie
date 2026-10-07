// Mutations for @pinetrie/container. Run: pnpm mutate scripts/mutations/container.ts
// The planners' checks are unit tests, in seconds. The suite mutation runs
// one `e2e:lanes` scenario under `container`, on the Mac:
//
//   PINETRIE_E2E_RUNTIME=container pnpm mutate scripts/mutations/container.ts journal
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/container"]
const plan = "packages/container/plan.ts"
const workspace = ["pnpm", "exec", "vitest", "run", "workspace.test.ts"]

export const mutations: readonly Mutation[] = [
  {
    name: "volumes are created without the journal",
    file: plan,
    from: '  "--opt",\n  "journal=ordered",\n',
    to: "",
    suite: "lanes",
    scenario: "contract",
    expect:
      "every clone of a journaled volume taken mid-write checks clean and holds every fsynced record",
  },
  {
    name: "container restores a volume without the snapshot's file",
    file: plan,
    from: "          createVolume(volume),\n          ...cloneFile(\n            snapshotFile(paths, op.from),\n            volumeImage(paths, volume),\n          ),\n",
    to: "          createVolume(volume),\n",
    command: unit,
    expect: "a restore creates the volume, then clones the snapshot's file",
  },
  {
    name: "container fails a delete of a volume that is not there",
    file: plan,
    from: "        ignoreFailure: true,\n",
    to: "        ignoreFailure: false,\n",
    command: unit,
    expect: "deletes succeed when there is nothing to delete",
  },
  {
    name: "mountArgs always uses --mount",
    file: plan,
    from: '  if (!paths.includes(","))',
    to: "  if (true)",
    command: unit,
    expect: "mountArgs: --mount; -v for a path with a comma",
  },
  {
    name: "a runtime declares another package than core and lanes",
    file: "packages/container/package.json",
    from: '    "@pinetrie/lanes": "workspace:*"\n',
    to: '    "@pinetrie/lanes": "workspace:*",\n    "@pinetrie/repo": "workspace:*"\n',
    command: workspace,
    expect: "a runtime declares only core, and lanes when it runs lanes",
  },
  {
    name: "a package below the app declares a runtime",
    file: "packages/repo/package.json",
    from: '    "@pinetrie/lanes": "workspace:*"\n',
    to: '    "@pinetrie/lanes": "workspace:*",\n    "@pinetrie/container": "workspace:*"\n',
    command: workspace,
    expect: "only the app declares a runtime",
  },
]
