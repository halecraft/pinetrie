# S186 — Yes: one directory of a lane's states, bind-mounted read-only when its container is made, shows states and conflict versions made later; a symlink renamed into place moves `start`; the lane can write nothing there and reach nothing through it

- **Status:** Answered
- **Led to:** ADR-0142

**Question.** ADR-0142 shows the agent the state its offer is computed
against at `/pinetrie/start`, and each conflict's three versions under
`/pinetrie/conflicts/`. (`/pinetrie` is pine·trie's install in every
lane, so the probe mounts at `/pinetrie-states`.), both read-only. Both change while the container
runs: a catch-up moves the start, and a merge makes conflicts. Docker
cannot add a mount to a running container.
1. If the container is created with one directory bind-mounted read-only
   (a directory of the lane's own states, beside its disk), does a
   snapshot or a clone made inside that directory later appear in the
   running container?
2. Can the lane write there, or reach anything outside it: through a
   symlink in a state, by remounting (a lane has no `CAP_SYS_ADMIN`), or
   by a path with `..`?
3. Does the same hold in a nested lane, under the lane's rootless Docker,
   and on the Mac's VM where the disks role makes the subvolume?

**Kill criterion.** If a subvolume made later does not appear, or the
lane can write through the mount, the versions reach the agent another
way: copied into the lane's own disk under `.pinetrie-lane/`, which the
lane can write, or read through a tool.

**Throw away.** `docs/findings/S186-states-in-a-lane/probe.sh`, run under
this lane's rootless Docker against its btrfs disk.

Run in a lane on the Mac's VM, under the lane's own rootless Docker
(Docker 29.8.2, `alpine:3.22`), on the lane's btrfs disk, with
`--security-opt no-new-privileges` as lanes run. The output is
`results.txt`.

## Answers

1. **What is made later appears.** The container was made with
   `<states>` mounted read-only at `/pinetrie-states`. Afterwards a
   read-only snapshot (`state-2`), and a directory of three versions
   (`conflicts/notes.md/{base,ours,theirs}`, one a clone), were made in
   `<states>`. The running lane listed and read both at once. A snapshot
   is a subvolume in the same file system, not a mount, so no
   propagation is needed. **A fixed name moves by a symlink:**
   `start → state-1`, replaced by a link to `state-2` renamed over it
   (`mv -T`), read `state-2`'s content in the lane at once.
2. **The lane can write nothing there, and reaches nothing through it.**
   - Writing into a state, into a conflict's version, or beside them, and
     moving `start`, all failed: read-only file system.
   - `mount -o remount,rw` failed: permission denied.
   - A symlink in a state resolves in the lane's own view, absolute
     (`/workspace/file.txt`) or climbing (`../../../../etc/hostname`, the
     container's own): nothing of the host's is reached that the lane
     could not already read.
   - The lane's `mountinfo` names the directory's path in the VM's lanes
     file system (its project key and lane id), as it already does for
     `/workspace`.
3. **Where it ran:** a nested lane under rootless Docker on the Mac's VM.
   A lane of the VM's own Docker gets the same bind mount of a directory
   on the same btrfs, from the disks role. Not run there.

**Kill criterion:** not met. ADR-0142's paths become `/pinetrie-states/start`
and `/pinetrie-states/conflicts/<path>/{base,ours,theirs}`: `/pinetrie`
is pine·trie's install. The directory is the lane's own, beside its disk,
never another lane's. The disks role makes and removes what is in it, and
the container's spec names it from the lane's creation, so a lane made
before has its container recreated once.
