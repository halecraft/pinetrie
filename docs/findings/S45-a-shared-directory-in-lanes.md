# S45 — a host directory shared read-write into every lane

- **Status:** Answered
- **Led to:** ADR-0035

The next change to ADR-0034 shares chosen directories, starting with a
directory of plans, read-write between your working copy and every lane. It
mounts them from the host inside the lane's own directory, for example at
`/workspace/.plans`, and keeps them out of snapshots and out of the lane's
repo. Nothing had measured a mount inside a lane's volume, who owns what a
lane writes there, or how the lane's jj treats it.

**Answers.**

1. **A bind mount inside the lane's volume works, whatever the order.**
   `-v <volume>:/workspace --mount type=bind,source=<host dir>,target=/workspace/.plans`
   gives `/workspace` as the volume (ext4) and `/workspace/.plans` as
   virtiofs. The same holds with the bind mount given first. `container`
   creates the mount point on the volume.
2. **What a lane writes arrives on the host as you.** In the lane everything
   in the directory is owned by root (uid 0), and the lane runs as root. On
   the host, files and directories the lane created are owned by your uid
   (501) and group, mode `644` and `755`. You can edit and delete what a lane
   wrote, and a lane can edit what you wrote.
3. **Changes are visible at once, every way.** Three rounds each:
   - host to lane: a file the host wrote was read back from the lane at once;
   - lane to lane: what one lane wrote, another lane mounting the same
     directory read at once;
   - lane to host: the host read it at once too.

   No caching delay was seen.
4. **The lane's jj honors `.git/info/exclude` only if the line is there before
   it snapshots.**
   - Written before `jj git init --colocate`, `/.plans/` kept the shared
     files out of `@`, new ones included.
   - A jj command run while the line was missing tracked every shared file.
   - Writing the line afterwards does not untrack them.

   So the line must be in place before any jj command runs with the mount
   present: at every container start, since an existing disk or an older
   fork lacks the line for a newly shared directory. pine·trie's base setup
   writes its exclude after `jj git init`, which is too late for a shared
   directory.
5. **A snapshot holds none of the shared files.** A clone of the volume taken
   with the mount in place, read with `debugfs`, has `/.plans` as an empty
   directory, the mount point, and the lane's own files beside it. Started
   again without the mount, the volume shows the same empty directory.
6. **A container's labels read back.** `container run --label pinetrie.spec=<hash>`
   appears in `container inspect` under `configuration.labels`. The host can
   therefore tell a container created from an older spec (other mounts,
   grants or variables) and recreate it; the disk is a separate volume.
7. **Git's own configuration variables keep the shared directory out of both
   git and jj, from outside the repo.** The test was a fresh repo made as the
   base is (`git init`, `jj git init --colocate`), with no exclude line,
   whose first jj command ran with `/workspace/.plans` mounted:
   - with no ignore at all, both git and jj tracked `.plans/p.md`, as in
     item 4;
   - with `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=core.excludesFile` and
     `GIT_CONFIG_VALUE_0=/pinetrie-ignore/ignore` set on the container, and a
     read-only directory holding that file, neither tracked it; `t.txt` was
     tracked as usual;
   - a read-only directory mounted at `$HOME/.config/git/` did the same;
   - a single file mounted at `$HOME/.config/git/ignore` is refused:
     `container run` failed, and bind mounts take directories only.

   The variables work whatever the image's `$HOME` or user, and touch no
   other tool's configuration. The image's `$HOME` was `/root`.
8. **The unnamed stopped container** seen after a run (`574a2d9c…`, 1 GiB) was
   gone a few minutes later without anything done to it: one of the host's
   short-lived `--rm` containers (a trim, or the image check) caught between
   stopping and being removed. Not a leak.

## What this means for the plan

- Shared directories mount at their own path inside `/workspace`, so paths
  in `AGENTS.md` work the same in a lane and in your working copy. No symlink
  is needed.
- What a lane writes there is yours on the host, editable by you and your
  tools.
- The host generates one ignore file for a lane, listing `/.pinetrie-lane/`,
  `/lost+found/` and each shared directory. It mounts that file's directory
  read-only and names the file with `core.excludesFile` through
  `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0` and `GIT_CONFIG_VALUE_0` (item 7).
  Every repo in the lane then ignores those paths from the container's first
  moment: the base, every fork and every old disk. No step writes
  `.git/info/exclude`, and no step order has to hold.
- A container's spec hash is a label. A start whose spec differs recreates
  the container on the same volume, so changed grants and shared directories
  reach existing lanes.

## Not measured

- Two lanes writing the same file at the same moment (last write wins is
  assumed, not shown).
- Large files or many files through virtiofs; a directory of plans is small.
- Symlinks created in the shared directory by a lane, as the host would
  follow them.
- A shared directory whose host path is itself a symlink.

## Method

`sandbox/s45/probe.sh`, `sandbox/s45/exclude.sh` and `sandbox/s45/ignore.sh`,
from the repo root,
outside the sandbox. The probes used containers from pine·trie's default lane
image (`pinetrie-lane:efb706bfa489`) on journaled 4 GiB volumes, with
`sandbox/s45/shared` as the host directory, and read snapshots with
`pinetrie-fsck:1`. Everything they made was removed.
