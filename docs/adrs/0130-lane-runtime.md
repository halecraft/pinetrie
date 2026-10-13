# ADR-0130 — Lanes are Docker containers on btrfs snapshots: in a VM of pine·trie's own on the Mac, on the host on Linux (restated)

- **Status:** Accepted (Duane, 2026-10-10)
- **Area:** `packages/lanes/TECHNICAL.md`, `packages/docker/TECHNICAL.md`,
  `packages/vm/TECHNICAL.md`
- **Evidence:** S39, S122, S123, S124, S125, S127, S128, S129, S130, S131,
  S132, S133, S134, S135, S136
- **Supersedes:**
  - ADR-0103: restated whole, with its two revisions of 2026-10-07 and what
    ADR-0118 changed in it folded in.
- **Amended by:**
  - ADR-0129: the disks helper, its shell scripts and the firewall's throwaway
    container are replaced by lanehost's roles, each a container the host
    reaches over one held `docker exec -i`.
  - ADR-0135: a change to `pinetrie.json` that widens what a lane may do or
    share takes effect only from accepted work; a lane's own copy can only
    narrow it.
  - ADR-0141: a change to what lanes mount or reach no longer means restarting
    the host. What accepted work adds goes in an extra slot of the lane VM,
    and its ports are written again; the host's own slot is still filled once.

Restates ADR-0103 as amended by ADR-0118 and its revisions of 2026-10-07;
decides nothing new. ADR-0103's changes to ADR-0034, ADR-0035 and ADR-0046
stand as ADR-0103 made them.

Supersedes ADR-0034's runtime:
- a VM per lane, by Apple's `container`;
- an ext4 volume per lane, cloned with APFS;
- the trim container;
- the one implementation.

Keeps the rest of ADR-0034:
- the lane's whole directory at `/workspace`, with its own jj repo;
- the working copy read-only at `/mnt/host-working-copy`;
- tools run in the lane;
- a turn's commit, `sync`, snapshot and fetch;
- a branch from the snapshot at its fork point;
- a root lane from the project's base;
- bundles;
- snapshots kept as long as their root;
- the project's image, and grants.

Part of ADR-0102.

**Context.** ADR-0034 made each lane a VM of its own, by Apple's
`container`, on an ext4 volume cloned with APFS:
- it runs only on macOS 26 on Apple silicon, and has no Linux path;
- a lane cannot start lanes: no `container` and no `/dev/kvm` in one (S132).
  So `e2e:lanes` runs only on the Mac, outside the sandbox, and the fast
  suites work directly (ADR-0102).

The spikes:
- **S132:** in a Linux lane, user namespaces, overlayfs and pasta work
  unprivileged. Overlay layers as lane disks fail to rename lower
  directories and copy whole files up. `container`'s kernel has no btrfs.
- **S122,** Docker in Colima's Ubuntu:
  - a btrfs snapshot of the repo takes 2 ms;
  - `docker exec` takes 32 ms, against `container exec`'s 64–69 ms;
  - lanes share one kernel, and the Mac reaches them only through
    published ports;
  - `docker commit` branches in 1.3 s;
  - the VM's Docker socket in a lane reaches every lane.
- **S123,** Alpine in Lima:
  - lanes on btrfs snapshots work end to end, unprivileged, with 571 MB
    less on the Mac than Ubuntu;
  - a lane with `CAP_SYS_ADMIN` remounts its view of the working copy
    read-write, and Lima's share still refused the write.
- **S124:** Lima's Alpine boots in 15 s, nearly all of it before ssh
  answers.
- **S125:** a lane runs lanes without privilege: rootless Docker in an
  unprivileged container, under Docker's seccomp profile plus the namespace
  calls, with `systempaths=unconfined`, `/dev/net/tun`, runc's
  `NoNewKeyring`, and btrfs mounted with `user_subvol_rm_allowed`.
- **S126,** the VM booted directly by vfkit, with its own init:
  - Docker answers on the Mac 0.7–1.0 s after vfkit starts;
  - it holds about 1.0 GB on the Mac;
  - a published port answers at the VM's address;
  - vfkit's vsock bridge drops a half-close, so `docker run -i` never sees
    its input end. A framed bridge of our own, and TLS on the VM's
    address, both carried it;
  - `docker cp` refuses the repo's symlinks that leave it.
- **S127:**
  - lanes inside lanes work on that VM;
  - a lane with `CAP_SYS_ADMIN` wrote to the Mac: vfkit makes every share
    writable on the Mac's side (`vz.NewSharedDirectory(dir, false)`);
  - an init without udev must make `/dev/net/tun` 0666.
- **S128,** a launcher of our own on Virtualization.framework (254 lines of
  Swift):
  - it carries a half-close;
  - a share with the read-only flag held against a lane with
    `CAP_SYS_ADMIN` and against root in the VM;
  - a running share was replaced by two directories, one read-only, with no
    remount;
  - a lane cannot open a vsock socket under Docker's default seccomp
    profile;
  - a lane reaches the Mac's services bound to all interfaces, and not its
    loopback;
  - the system image, trimmed and compressed, is 113 MB and boots like the
    full one, holding about 770 MB on the Mac.
- **S129:** under the launcher, `docker run -d` took about 500 ms because its
  disk images took Apple's synchronization mode, `full`: an `F_FULLFSYNC` on
  the Mac for each flush the guest asks for. With `fsync` and `cached`, as
  vfkit uses, it takes 82–103 ms, and Docker answers in about 1 s.
- **S130:** replacing a virtiofs share while the VM runs breaks every
  container's bind mount into it, even to an entry it kept, with no error
  in the guest's log. A bind of the share's root survives.
- **S131:** share devices are apart: replacing one leaves binds into the
  others working. A VM boots with 20 of them and not 24, and 20 cost 14 MB
  more than one, and 10 ms to mount.

**Decision.**
- **One lane runtime, Docker, in two places,** behind ADR-0034's operations:
  create from the base, snapshot, fork, exec, stop and delete.
  - **On Linux:** Docker on the host.
  - **On the Mac:** Docker in one VM of pine·trie's own per user, started
    through a launcher of pine·trie's own on Apple's
    Virtualization.framework.
- **The VM (Mac):**
  - **What it boots:** Alpine's `linux-virt` kernel and a small
    first-stage initramfs. Its root is a read-only erofs system image
    (Alpine, Docker, `btrfs-progs`) under a tmpfs overlay.
  - **PID 1 is pine·trie's own init,** with no OpenRC, ssh, cloud-init or
    udev. It sets what udev would: `/dev/net/tun` 0666.
  - **The data disk** is a sparse file, formatted btrfs and mounted with
    `user_subvol_rm_allowed`. It holds Docker's data and every lane's
    subvolume.
  - **Its lifetime:** one per user, not per host.
    - The first host to take a lease starts it.
    - It runs while any host holds a lease.
    - It stops after 10 idle minutes, keeping its state (S126).

    A VM per host would give each project, and each suite's throwaway
    project, an image store of its own, and so would build pine·trie's
    default image again for each.
  - **Its memory** is a quarter of the Mac's, between 4 and 16 GiB.
  - **How it is made:** the kernel, first stage and system image are built
    on Linux by a script in this repo, and the host uses a build named by
    its digest.
  - **It is Alpine, built with `apk`, and fixed once built.** Its packages
    (`linux-virt`, `docker`, `btrfs-progs` and the like) come from Alpine's
    repositories when the image is built. Nothing is installed in a running
    VM: its root is read-only, and its tmpfs layer is gone at the next boot.
  - **A build is kept by its digest,** since Alpine keeps only each
    package's latest version. Updates, the kernel's included, are new
    builds.
  - **It carries only what the VM runs:** no `buildx` and no `docker` CLI,
    since lane images are built from the host's CLI, and no modules for
    hardware a VM lacks. Compressed with lz4hc, it is 113 MB, and boots like
    the full image (S128). Lanes keep their own images and package
    managers (ADR-0034), so Alpine's musl never reaches them.
- **The launcher is pine·trie's own** because vfkit lacks two things:
  - **Read-only shares, on the Mac's side.** The working copy, linked
    directories and granted host paths are shared with Virtualization's
    read-only flag set (S128). Shared directories (ADR-0035) are
    read-write.
  - **A slot per host.** The VM has a fixed number of share devices, made
    empty at boot: 16 by default (`lanes.vm.slots`), and at most 20
    (S131).
    - A host takes a free slot with its lease.
    - The slot is filled once with every directory the host's lanes mount,
      its sources among them, and never replaced while the host runs:
      replacing a share breaks every bind into it (S130).
    - A host reads its directories at startup (ADR-0035), so a change
      means restarting it.
    - When the lease ends, the slot is emptied.
    - Before a slot is filled again, any container still labelled with it
      is removed: a host that crashed left it, and filling the slot would
      give it the next host's directories.
    - A host past the last slot is refused at its lease.
  - **A stream that carries a half-close.** The host reaches the VM's
    Docker over vsock through a stream that carries a half-close, so `exec
    -i` and `run -i` see their input end. Pi's tool helper (ADR-0034) and
    streaming the repo in both depend on it.
  - **Disk images flushed with `fsync`, cached** (S129). A guest's flush
    reaches the Mac's drive but does not empty the drive's own cache, so a
    power loss can lose the last writes. A lane's disk is rebuilt from its
    snapshots and commits.

  It is signed with the virtualization entitlement.
- **The host is the only client of the VM's Docker.**
  - Docker listens on the VM's vsock and its own unix socket, not on a
    network address. A lane cannot open a vsock socket: Docker's default
    seccomp profile, and the narrow one of lanes that run lanes, leave
    AF_VSOCK out (S128).
  - The host's operations on lane disks (creating, snapshotting and
    deleting subvolumes) run in a helper container of that Docker. The
    helper holds the lanes' directory and has no privilege: btrfs needs
    none under `user_subvol_rm_allowed` (S125, S127).
  - There is no control shell.
- **A lane is an unprivileged container of that Docker:**
  - its directory is a btrfs subvolume at `/workspace`;
  - the working copy is at `/mnt/host-working-copy`, bound `:ro`;
  - it runs under Docker's default seccomp profile, with a memory limit;
  - it **never** gets `CAP_SYS_ADMIN`, `--privileged` or Docker's socket.
- **A snapshot is a btrfs snapshot, and a branch a snapshot of the one at its
  fork point** (2–13 ms, S122, S123, S126). A turn's steps stay ADR-0034's:
  commit, `sync`, snapshot, fetch. Deleting a snapshot is deleting a
  subvolume (1 ms), and its space comes back with no trim, so ADR-0034's
  trim container, the one container with `CAP_SYS_ADMIN`, goes.
- **The repo reaches a lane by streaming `tar`** through `run -i` or `exec
  -i`, never `docker cp` (S126).
- **The Mac reaches a lane's servers at the VM's address, through ports the
  lane publishes** (S126). Which ports, and when, is decided apart (ADR-0046
  builds no proxy).
- **Grants carry over:**
  - forwarding the ssh agent, which the launcher carries over vsock into
    the VM, and the host mounts into the lane;
  - named environment variables;
  - further read-only shares;
  - shared directories.
- **Lanes inside a lane are a grant,** declared by the project and needed by
  `e2e:lanes`. A lane given it runs:
  - Docker's default seccomp profile plus the namespace and mount calls and
    `pivot_root` (S125);
  - `systempaths=unconfined` and `/dev/net/tun`;
  - an image with rootless Docker, `btrfs-progs` and runc's `NoNewKeyring`
    by default.

  Its inner lanes are its rootless Docker's containers, on btrfs
  subvolumes of its `/workspace`.
- **On Linux, the host needs Docker and a btrfs directory for lanes**, mounted
  with `user_subvol_rm_allowed`. It refuses to start without them and says
  how to make them (ADR-0102).
- **Apple's `container` stays until this runtime runs pine·trie's suites,
  then goes,** with `packages/lanes/disk.ts`'s writing of volume images
  and its contract test.

**Consequences.**
- **One path for lanes on the Mac and Linux,** beside the launcher and the
  VM's image, which pine·trie builds, signs and ships.
- **Lanes share one kernel.** An escape from one lane reaches every lane and
  the data disk; under `container` each lane was a VM.
- **Memory:** one VM per user, about 780 MB on the Mac when idle (S128,
  S131), in place of about 1.2 GiB per running lane (ADR-0034). Each lane
  has a limit of its own. A VM keeps the most memory its guest touched until
  it stops (S39), so a busy hour holds memory until the idle stop.
- **About 16 hosts at once per Mac user,** by default: one slot each.
- **Speed:**

  | | before | now |
  |---|---|---|
  | start a lane | under 1 s | 82–103 ms (S129) |
  | `exec` | 64–69 ms | 25–32 ms |
  | snapshot | 0.3–0.6 s | 2–13 ms |
  | the VM | — | about 1 s, when the host starts (S129) |

- **The working copy is held read-only on the Mac's side,** so even a lane
  given the wrong capabilities cannot write it (S128). Shared directories
  stay writable by every lane, as ADR-0035 decided.
- **The network is the launcher's own** (S136): `gvproxy`, a user-mode
  network stack, as Podman, Lima and CRC run, so a VM another tool starts
  cannot take it away. Virtualization's NAT is shared by every VM on the
  Mac, and one `container run` removed its Mac side under a running VM
  (S135).
- **A lane reaches what it did under `container`** (ADR-0034, S128): the
  internet and the Mac's services bound to all interfaces, at its LAN
  address. A fence in the VM keeps it from `gvproxy`'s own addresses: the
  Mac's loopback, which `gvproxy` exposes, and its API, which opens ports
  on the Mac (S136). A project may grant ports of the loopback
  (`lanes.hostPorts`), to its own lanes only: each project's lanes have a
  Docker network of their own. pine·trie's own port is never granted, since
  a host on loopback takes no key.
- **Seeing what a lane serves,** from the Mac's browser, is the host's to
  open (through `gvproxy`'s API, which no lane reaches): a plan of its own.
- **`e2e:lanes` and the fast suites run in a lane.** An outer lane's
  rootless Docker takes about 16 s to start (S125, S127). Its inner lanes
  have no limits of their own, and cannot be privileged.
- **Not measured yet:**
  - Docker and btrfs end to end on a Linux host (S132 probed only the
    parts);
  - how long the suites take.

**Alternatives rejected.**
- **A VM per host,** as this ADR first said: every project's image store,
  and every suite's throwaway project's, would build pine·trie's default
  image again.
- **One share for every host, replaced as hosts come and go:** each
  replacement breaks every running lane's mounts (S130). Binding the
  share's root survives, but shows every lane every host's directories.
- **Keep Apple's `container`:** a VM per lane, but Mac only, and no lane can
  run lanes (S132).
- **Colima's Ubuntu:** a 316 MB image and a 20 s boot, and its AppArmor
  blocks lanes inside lanes (S122, S123).
- **Lima with Alpine:** a 15 s boot spent in OpenRC and Lima's own start
  (S124, S126), and a writable share behind it only by Lima's choice.
- **vfkit:** its shares are writable on the Mac's side, and its vsock bridge
  drops a half-close (S126, S127).
- **Docker over TLS on the VM's address** (S126): it carries a half-close and
  refuses a lane without a certificate. But it puts Docker on a network
  address and needs a certificate per boot, which the launcher's vsock
  does without.
- **Overlay layers, plain copies or `docker commit` as a lane's disk:**
  - overlay layers cannot rename a lower directory, and copy whole files up
    (S132);
  - a plain copy pays a lane's full size (S132);
  - `docker commit` takes 1.3 s and keeps the whole root (S122).
- **A runtime of our own on namespaces (S132) in place of Docker.** Docker
  brings images, builds and networks, and the same commands on Linux.
- **For lanes inside lanes:**
  - handing a lane the VM's Docker socket reaches every lane (S122, S125);
  - seccomp off is not needed: the narrow profile works (S125, S127).
