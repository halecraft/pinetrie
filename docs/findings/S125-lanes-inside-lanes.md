# S125 — A lane runs lanes of its own without privilege: rootless Docker and btrfs snapshots in an unprivileged container, under Docker's seccomp profile plus the namespace calls

- **Status:** Answered
- **Led to:** ADR-0102, ADR-0103

Follows S123 and S124. It serves `e2e:lanes`, which must run its lanes inside
a lane.

**Question.** S123 got part of the way:
- with seccomp turned off and `/proc` unmasked, a container could make user
  namespaces and mount its own `/proc`;
- overlay failed with its upper layer on the container's own overlay root.

End to end, on the Alpine ISO VM (S124):
- Can an **outer lane** run rootless Docker? The outer lane is an
  unprivileged container with a btrfs subvolume as `/workspace` and the
  working copy read-only, using `docker:dind-rootless` with its data on
  `/workspace`.
- Can it make, snapshot and delete btrfs subvolumes there?
- Can its **inner lanes**, each with a snapshot as `/workspace`:
  - stay apart from one another;
  - serve `:5173` at once and reach the network;
  - stay away from the VM's Docker, other lanes' disks and the working copy?
- Under which security settings?
  - seccomp off;
  - Docker's default profile plus only the calls a user namespace needs
    (`clone`/`clone3` with namespace flags, `unshare`, `setns`, the mount
    calls, `pivot_root`, `sethostname`, `setdomainname`). This leaves out
    the rest of what Docker gates on `CAP_SYS_ADMIN`, such as `bpf`,
    `perf_event_open` and `syslog`;
  - Docker's defaults.

  Each also needs `systempaths=unconfined` and `/dev/net/tun`.
- For comparison: what handing the VM's Docker socket to a lane would give
  it.

**Kill criterion.** No setting short of `--privileged` lets an outer lane run
inner lanes, or an inner lane can reach another lane's disk, the VM's
Docker or the working copy.

**Throw away.** The VM `pinetrie-nested`, which the script deletes, and the
script, its seccomp profile and results (`s125-probe/` in the shared plans
folder).

## How it ran

Duane ran the script on the Mac (Lima 2.2.0, docker CLI 29.8.1) three times.
The VM was the Alpine ISO of S124, with `docker`, `btrfs-progs` and
`python3`, and btrfs in a 30 GB sparse file mounted at `/lanes` with
`user_subvol_rm_allowed`. Each outer lane got a fresh subvolume of it,
owned by uid 1000.

- **Run 1** used `docker:dind-rootless` as is. It has no `btrfs`, and the
  script hid that error, so its inner lanes ran on plain directories that
  Docker made. Under the narrow profile, every inner container failed:
  "unable to join session keyring: unable to create session key: operation
  not permitted". runc calls `keyctl`, which Docker's default profile
  refuses, because kernel keyrings are not namespaced. Under Docker's
  defaults, rootless Docker did not start: "[rootlesskit:parent] error:
  failed to start the child: fork/exec /proc/self/exe: operation not
  permitted".
- **Run 2** used the outer image below. Its second case reused the first
  case's subvolume, so its inner Docker started on leftover data.
- **Run 3**, whose numbers follow, gave each case its own subvolume.

The outer image was `docker:dind-rootless` with `btrfs-progs` added and the
inner Docker's `daemon.json` set to `{"default-runtime": "nokeyring",
"runtimes": {"nokeyring": {"runtimeType": "io.containerd.runc.v2",
"options": {"NoNewKeyring": true}}}}`. It was made with `docker run` and
`docker commit`, since the Mac's docker CLI may lack BuildKit.

The narrow profile was built in the VM from
`moby/profiles/seccomp/default.json`:
- it drops the three rules that refuse `clone` with namespace flags, and
  `clone3`, without `CAP_SYS_ADMIN`;
- it adds one rule allowing `clone`, `clone3`, `unshare`, `setns`, `mount`,
  `umount`, `umount2`, `mount_setattr`, `move_mount`, `open_tree`,
  `fsconfig`, `fsmount`, `fsopen`, `fspick`, `pivot_root`, `sethostname`
  and `setdomainname`.

## Answers

1. **Both settings worked end to end** (run 3). The two settings: seccomp
   off; and the narrow profile. Each had `systempaths=unconfined` and
   `--device /dev/net/tun`, and neither was privileged. The outer lane ran
   as uid 1000 with a btrfs subvolume as `/workspace`, and the working copy
   read-only:

   | | seccomp off | narrow profile |
   |---|---|---|
   | rootless Docker up in the outer lane | 16.4 s | 16.4 s |
   | inner Docker | 29.8.2, overlayfs on the btrfs `/workspace`, no cgroup driver, default runtime `nokeyring` | the same |
   | btrfs as uid 1000: create a subvolume, snapshot it, delete one | ok | ok |
   | each inner lane's `/workspace` a snapshot (inode 256) | yes | yes |
   | inner lane's write in its snapshot, not in the other's or the base | yes | yes |
   | two inner lanes each serving `:5173` and reaching npm | yes | yes |
   | `exec` into the outer lane / into an inner lane through it | 23 / 42 ms | 30 / 49 ms |
   | inner `docker run -d` | 107 ms | 113 ms |
   | inner pulls of `alpine:3` and `python:3-alpine` | 3.9 s | 3.8 s |

2. **Inner lanes reach nothing they should not.**
   - In an inner lane there is no `/var/run/docker.sock` and no `/lanes`.
   - The working copy, passed on read-only, refused a write ("Read-only
     file system").
   - Nothing reached the Mac.
3. **`btrfs subvolume show` fails without privilege** ("Could not search
   B-tree: Operation not permitted"). Its tree search needs `CAP_SYS_ADMIN`.
   A subvolume can be told by its root's inode number, 256.
4. **The inner Docker has no cgroup driver** (`cgroup none`). So an inner
   lane gets no memory or CPU limit of its own: the outer lane's limit holds
   for all of them.
5. **A privileged inner container fails** (run 2): runc could not mount
   `sysfs` ("operation not permitted").
6. **Handing a lane the VM's Docker socket** (run 1) lets it list the VM's
   containers and start a privileged one with the VM's root mounted, from
   which it read every lane's disk.
7. **The VM's first boot took 80.6 s in run 3,** against 18–19 s in runs 1
   and 2, with the same provisioning. Not explained.

## What this means

- **Kill criterion:** not met. An unprivileged outer lane runs inner lanes,
  and no inner lane reached another's disk, the VM's Docker or the working
  copy.
- **What a lane that runs lanes needs,** beyond an ordinary lane:
  - the narrow seccomp profile in place of Docker's default (seccomp off is
    not needed);
  - `systempaths=unconfined`;
  - `/dev/net/tun`;
  - an image with rootless Docker, `btrfs-progs`, and runc's
    `NoNewKeyring` as its Docker's default;
  - its `/workspace` a btrfs subvolume on a volume mounted with
    `user_subvol_rm_allowed`.
- **Those settings belong to the lanes that run `e2e:lanes`,** not to every
  lane. The narrow profile opens user namespaces, and with them more of the
  kernel, to the lane.
- **Inner lanes have no limits of their own,** and cannot be privileged.
  Neither is needed to run `e2e:lanes`' lanes.
- **The VM's Docker socket must never reach a lane.**
