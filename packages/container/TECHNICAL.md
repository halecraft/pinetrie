# `@pinetrie/container`: technical notes

Apple's `container` as a lane runtime (ADR-0034): `containerRuntime`, the
`LaneRuntime` of `@pinetrie/lanes`' `runtime-port.ts`. It declares
`@pinetrie/core` and `@pinetrie/lanes`, and only the app declares it
(`workspace.test.ts`). The app picks it in `apps/pinetrie/host/work/runtime.ts`.

## Where things are

- `plan.ts`: every decision, pure: `renderRun` (a `ContainerShape` as
  `container run`'s arguments) and `mountArgs`, `planDiskCommands` (a
  `DiskOp` as host commands), `planContainerHost` (startup facts as a
  project or the reason lanes work directly), and the readers of
  `container inspect` and `container image inspect`.
- `facts.ts`: gathers `container`'s status, its kernel, an APFS clone probe,
  a container's state and a volume's or snapshot's existence.
- `cli.ts`: runs `container`'s commands.
- `runtime.ts`: `containerRuntime({ paths, trimImage })`, composing the three.
  `DiskPaths` (`container`'s volumes directory, the project's
  `.pinetrie/snapshots/`) is this package's own.

## Disks and snapshots

- **A lane's disk is a volume named as its container** (`laneVolume`).
- **Every volume is journaled** (`--opt journal=ordered`, `createVolume`).
  With no journal, a clone taken while the lane writes is corrupt: 0 of 70
  were consistent in S41. With `ordered`, 687 of 687 were. `container`'s
  default volume has no journal.
- **A snapshot is `/bin/cp -c` of the volume's `volume.img`,** cloned to
  `<name>.tmp` and renamed into place, so no snapshot file is ever
  half-written. GNU `cp` has no `-c`. The base is `base.img`.
- **The image swap is unsupported.** A volume restored from a snapshot is
  created by `container`, then has its `volume.img` replaced by a clone of
  the snapshot's file. `container` 1.4.1 does not promise that works: a
  volume is its `entity.json` and an image read by path (S40). `e2e:lanes`
  runs a small soak on every upgrade (`contract`): twenty clones taken
  mid-write, each checked with `e2fsck` and for every record the writer had
  `fsync`ed. Its mutation drops the journal.
- **Deleting a clone takes about 280 ms** (S40 item 4), so a
  `deleteSnapshots` op deletes one after another, and the host does not
  await it.
- **A `delete` of a volume that is not there succeeds** (`ignoreFailure`):
  a lane is deleted before its fork makes it again.
- **Trimming**: `stop` trims a disk after it stopped the lane's container, so
  it gives back the space the lane deleted. `fstrim` runs in a short-lived
  container with `CAP_SYS_ADMIN`, of pine·trie's default image, which the
  host hands in once built (`trimImage`). A lane's own container never has
  that capability.
- **Clone time rises with a disk's fragmentation, not its size**: 5–9 ms on
  a fresh disk, up to 0.6 s on one churned for minutes (S43 item 6, S40).
  Not isolated.

## Mounts

- **`mountArgs`:** `--mount` separates its fields with commas and `-v` with
  colons, so a path with a comma takes `-v`, and one with both cannot be
  mounted at all (S46 item 4). `planHostMounts` (`@pinetrie/lanes`) refuses
  such paths first.

## pre-docker: lanes moved to Docker

`openContainerDisk` (`convert.ts`) opens a lane's volume, or restores its
newest snapshot into one, in a throwaway `debian:trixie-slim` container
whose `tar` the app pipes into Docker's disks helper
(`apps/pinetrie/host/work/convert.ts`). The volume stays. Deleted with the
package.

## Tests

- **`plan.test.ts`**: the planners. Their mutations are
  `scripts/mutations/container.ts`, with the contract soak's.
- **The `contract` scenario's soak takes about 7 s** (`e2e:lanes` under
  `container`):
  - its volume is 4 GiB, since `e2fsck -f` walks every block group however
    little a volume holds;
  - its writer runs only while the clones are taken;
  - the clones are checked four at a time, in `pinetrie-fsck:1`, an Alpine
    image with `e2fsprogs` that it builds once and keeps.
