# `@pinetrie/vm`: technical notes

A Linux machine on the Mac for lanes' Docker (ADR-0130): its image, and
the launcher that runs it and a host's lease on a slot of it. It declares
nothing, and knows nothing of lanes (`workspace.test.ts`).

## The image (`image/`)

- **`manifest.json` pins everything:** the Alpine branch, each package's
  exact version, the modules stage 1 and the init load, and the module
  trees for hardware a VM lacks. Alpine keeps only each package's latest
  version, so a build that cannot install a listed version fails naming it:
  an update is a deliberate edit of the manifest.
- **`docker-engine`, not `docker`:** the VM needs no CLI or buildx (lane
  images are built from the host's CLI), and `docker` pulls both.
- **`kmod` is listed:** `modprobe` must read Alpine's `.ko.gz` modules.
- **The image's identity is `imageKey`,** a hash of every file in
  `IMAGE_FILES`: the manifest, the scripts and Docker's `daemon.json`,
  since a change to any makes another image. A build
  lands in `$XDG_STATE_HOME/pinetrie/vm/images/<key>/`, unpacked into a
  temporary directory and checked against its `SHA256SUMS` first.
- **An image records what it was built from:** `SOURCES.SHA256SUMS`
  (`IMAGE_SOURCE_SUMS`), one hash per file of `IMAGE_FILES` in
  `SHA256SUMS`' format, written beside the outputs before they are
  installed. Two images are compared file by file long after their sources
  changed (`changedImageFiles`); the current sources' record is made from
  them, never read, since their image may not be built yet. An image built
  before has none, and its change reads "its sources were not recorded".
  `checkImageDir` checks only the outputs, so the record decides no image's
  validity.
- **Never run another distribution's `depmod`** on the modules: Debian's
  kmod has no zlib, skips `.ko.gz`, and writes an empty index (S128).
  `build.sh` keeps Alpine's own `modules.dep` and indexes, and checks each
  listed module and its dependencies is there. A file may spell a module's
  `_` as `-` (`virtio-rng.ko`).
- **The kernel is an EFI zboot image** (`vmlinuz-virt`): its header names
  the gzip payload's offset and size, and the payload is the arm64 `Image`
  Virtualization boots.
- **Stage 1** is static busybox, `virtio_blk`, `erofs` and `overlay`
  uncompressed for busybox's `insmod`, and `stage1-init`. It mounts the
  erofs system image under a tmpfs overlay and switches to it.
- **`init`, PID 1:** drivers by modalias, then the manifest's modules;
  `/dev/net/tun` made 0666 (no udev, S127); the btrfs data disk with
  `user_subvol_rm_allowed`, formatted on first boot and grown to fill
  `data.img` at every boot, a resize that fails logging why on the
  console (`data disk not resized: …`); then its room from btrfs's
  counters (`data disk room: unallocated=… metadata=…/…`), and `data disk
  full` when unallocated is under 1 GiB, the host's own `ROOM_SPENT` (a
  host test holds them alike); each slot's share at
  `/mnt/host-shares/<i>`; Docker on vsock 2375, started with
  `--config-file /etc/pinetrie/daemon.json` (the image's `daemon.json`,
  which caps BuildKit's cache beside its images: its defaults are
  fractions of the data disk, S234, S237, ADR-0169), and each slot's ssh agent;
  `sync` on vsock 2377 for the launcher's stop; the clock (below). No
  shell listens on any port. `socat -t 3600`: without it, socat cuts a
  stream 0.5 s after its input ends (S128, S129).
- **The services' parent and its floor** (`init`, ADR-0212, S340): cgroup2
  is mounted with `memory_recursiveprot`, so a parent's `memory.low`
  protects every cgroup under it by itself; `init` makes
  `/sys/fs/cgroup/pinetrie-services` (lanehost's `SERVICES_CGROUP`, which a
  host test holds it to), enables `memory`, `pids` and `cpu` in the root's
  and its `cgroup.subtree_control`, and writes the kernel command line's
  `lane.services_floor` to its `memory.low`, logging `services' floor: …`
  or `services' floor not set`. Docker puts lanehost's roles and the
  observer under it (`CgroupParent`), apart from its own `docker/`, whose
  floor is none, under which a floor protects nothing. The boot clears it
  with every other cgroup.
- **The clock is kept to the RTC** (`clock`, installed as
  `/usr/local/sbin/pinetrie-clock`, started by `init`). The kernel reads
  the RTC, Virtualization's PL031 on the Mac's time, only at boot, and the
  guest's clock falls behind while the VM runs, most likely while the Mac
  sleeps: S163 found it 16.6 h behind after 14 h up, and apt in every lane
  image build refused Debian's signatures as "not live until". Every 15 s,
  more than 2 s apart (both are whole seconds) steps it with
  `hwclock -s -u`. A lane cannot set the clock (no `CAP_SYS_TIME`), so the
  VM must.
- **Built in this lane, measured:** 15 s in an Alpine 3.23 chroot; `Image`
  34.6 MB, `stage1.cpio` 1.6 MB, `system.erofs` 102.3 MB.

## The image's build (`builder/`, `build.ts`)

The Mac builds the image in a one-shot VM of its own, with no Docker
(ADR-0147, S195). Nowhere else runs a lane VM, so nowhere else builds one.

- **Who builds:** a lease whose image is missing (`planVm`'s `start` with
  `buildImage`), before it starts the VM; a host replacing an older VM
  builds first, while the old one still runs. And `pnpm vm:build`
  (`planVmBuild`: `present`, `build`, `not-needed` or `refused`;
  `--force` rebuilds), which `pnpm build` runs too. Where the lane VM
  cannot run (`vmHostRefusal`: not a Mac, no Apple silicon, macOS before
  13) nothing is built, and `vmBuildWords` says why and names `--force`,
  which is refused there for now (S197). Built or already built, `pnpm
  vm:build` ends with what happens to the lane VM: none running, it runs
  this image, or which image it runs, what differs, and when this one
  replaces it (`gatherRunningVm`, then `planVmVersion` as a host asks it).
- **What boots the build is pinned** (`builder/pins.json`): the
  `linux-virt` apk the manifest names, so the builder boots the very
  kernel the image ships, and Alpine's minirootfs for `alpine-base`'s
  version, each by SHA-256 (a test holds the versions to the manifest's).
  Fetched once into `builder/` (`ensurePinned`, `pinned.ts`, as gvproxy
  is). Alpine keeps only each package's latest version: when it drops one,
  the fetch's 404 names it, and the manifest and `pins.json` move together.
- **The builder's files are not in `imageKey`:** they change how an image
  is built, not what it holds, so no running VM goes stale for them.
- **The kernel is unpacked in Node** (`apk.ts`): `gunzipSync` reads an apk's
  three gzip streams as one tar, a pax `path` names the entry after it,
  and `zbootImage` takes the `Image` out of the EFI zboot. `build.sh` does
  the same in the guest, in shell, on purpose: the image's build stays
  self-contained, and `imageKey` covers it. The observer suite boots the
  same kernel (`pinnedKernel`).
- **The initrd is two parts concatenated,** made with what macOS ships
  (`writeInitrd`): the minirootfs as newc cpio (`bsdtar ... @tarball`,
  keeping root's ownership without unpacking), then every entry of its own
  directory with uid and gid 0: `m/` (the modules, gunzipped, and
  `m/order`, `writeInitrdDir`) and `init`, and the build's `src/` (the
  image's sources). Later entries win. The repair boot's is made by the
  same functions (below), as the builder is run by the same `runBuilder`.
- **The guest (`builder/init`):** `insmod`s `m/order` in its order
  (busybox cannot read `.ko.gz`); DHCP; `build.sh`; the outputs as a tar
  written raw to `/dev/vda`; `[builder] built`; power off. The run is a
  value (`planVmBuildRun`); `buildVmImageInVm` carries it out, logging the
  console's `[vm-build]` and `[builder]` lines, and reads the disk back
  with `tar`.
- **The machine (`builder/builder.swift`):** built and signed as the
  launcher is (`SwiftBinary`, `swift.ts`), a binary of its own so a change
  to it retires no running VM. The kernel and initrd, 1 GiB, every CPU,
  Virtualization's NAT, entropy, the console on stdout, and a sparse 1 GiB
  file as its one disk. NAT, not gvproxy: a build lasts 20 s, and NAT's
  fragility (S135) matters to a VM that runs for hours.
- **One build at a time, of any image** (ADR-0211): `images/build.lock`
  (`BUILD_LOCK`), an `@pinetrie/lock` lock, waited for and said once
  (`vmBuildWaitWords`); the kernel frees it with its holder, so no dead
  holder's lock is broken by a guess. Two builds of different images (two
  versions of pine·trie at once) wait for each other. It is never removed:
  a removed lock's file is a free lock (S327), so prune keeps it.
- **Installing never removes a whole image** (`installImage`): a build
  that finds one in place discards its own, since a launcher may be
  starting from it. One that is not whole is replaced; `--force` replaces
  either.
- **After a build, what no longer serves goes** (`planPrune`, `prune.ts`):
  images, launchers, builders and pins that are not current and that no
  running launcher names in its arguments, matched by name, since the
  contract scenario runs a launcher from another state directory over the
  same `images/` and `bin/`; and the `.tmp-` and `.old-` entries of
  processes gone, by the pid in their names (a reused pid keeps one until
  a later prune). An old image's `<key>.lock` goes as any entry not
  current. Without `ps`'s listing nothing is removed.
- **Measured:** 20 s on an M3 Max, 21 s with the builder's compile and the
  pins' first fetch (43 MB); a lease from no image to Docker answering,
  27 s.

## The launcher (`launcher/launcher.swift`)

- **One per user,** in `$XDG_STATE_HOME/pinetrie/vm/`: an exclusive `flock`
  on `launcher.lock`, so a second exits at once and its host joins the
  first. A host that finds no `control.sock` answering starts one, detached,
  its output in `launcher.log`.
- **Built on demand** (`swift.ts`, as the builder is):
  `xcrun swiftc -swift-version 5 -O`, signed ad hoc with
  `com.apple.security.virtualization`, into
  `bin/launcher-<hash of the source and entitlements>`. Without Xcode's
  command line tools the lease is refused, naming `xcode-select --install`.
- **The machine:** `VZLinuxBootLoader` with `Image`, `stage1.cpio` and
  `psi=1 lane.slots=<n> lane.services_floor=<bytes>` (the kernel is built
  with pressure stall information off by default, and the host reads the
  machine's and each lane's for its health, S308; the floor is the
  services', which `init` writes); `system.erofs` read-only and `data.img`
  (256 GiB sparse) as disks; NAT; a console to `console.log`; entropy; vsock; and
  `<n>` share devices `slot0` … `slot<n-1>`, each an empty directory at
  boot. Its memory is a quarter of the Mac's, between 4 and 16 GiB
  (`vmMemoryCeiling`), and it has every CPU.
- **The services' floor is the booting launcher's argument**
  (`LauncherFacts.servicesFloorBytes`, the last of `launcherArgs`): the
  host passes the docker package's `servicesFloorBytes` to `leaseVm`, which
  holds no dependency for it. It is not in the launcher's hash or the
  image's key, so a host whose floor differs (another version's budget)
  joins the running VM, and every host on it shares the floor of whichever
  started it; a changed floor applies from the VM's next start (an idle
  stop, or a changed launcher or image), as the data disk's growth does.
  The Health page says so when the floor read back is not this host's.
- **Disks are attached with synchronization `fsync`, caching `cached`.**
  Apple's defaults, `full` and `automatic`, made every `docker run` about
  500 ms (S129). The host decides them (`LAUNCHER_DISKS`, `plan.ts`) and
  passes them as the launcher's last two arguments; `launcherArgs` plans
  the whole argv from facts the lease gathers on a start, the VM's memory
  among them, and a unit test reads it (ADR-0152).
- **The bridge:** `docker.sock` to vsock 2375. Each direction's end becomes
  a `shutdown(SHUT_WR)` of the other side, and a pair closes when both
  directions end, so `docker run -i` sees its input end and keeps its
  output (S128). vfkit's bridge drops the half-close (S126).
- **Slots, one per host.** A host's directories are one
  `VZMultipleDirectoryShare` in its slot, filled once, and never replaced
  while it runs:
  replacing a share cuts every bind mount into it, even to an entry the
  replacement kept, with nothing in the guest's log (S130). Share devices
  are apart: filling or emptying one leaves the others' binds working
  (S131). A slot empties when its lease's connection ends.
- **Extra slots, for what a host's slot lacks** (ADR-0141). When accepted
  work names a directory no slot of the host holds, or wants read-write
  one held read-only, the host leases one more slot and fills it with
  those directories alone (`leaseExtra`: a second connection, `agent`
  null, never starting or retiring a VM; leased and filled in one call,
  its leftovers stopped first as the host slot's are, so
  no extra slot is ever empty or filled twice; `planWidening`). Its own slot
  always holds lanehost's running roles, so it is never refilled; nor is
  an extra slot, and a later widening takes another. A directory is then
  in at most two of a host's slots, one read-only and one read-write: a
  host's `Holdings` record one slot per kind for each source, and no more
  (`holdFill`). Lanes bind the read-write one (`sharePath`). The extras last until the
  host's next lease, which fills one slot with everything. A read-only
  entry beside a read-write one of the same directory still refuses
  writes, in its slot or another (S187).
- **The limit:** 16 slots by default, `lanes.vm.slots` in your or the machine's config,
  at most 20: a VM boots with 20 share devices beside its others, and not
  24 (S131). It applies when the VM next starts. The 17th lease is refused,
  naming the limit and the key.
- **The lease protocol** (`protocol.ts`; the Swift side mirrors it): JSON,
  one message a line, on `control.sock`. `lease` (with the host's
  `SSH_AUTH_SOCK`) answers `slot`; `fill` answers `filled`; anything else is
  `refused` with a reason the host words (`launcherWords`). A lease lasts as
  long as its connection. One channel reads every reply, each with a
  deadline (`launcherChannel`, `lease.ts`).
- **`status` asks without a lease:** answered on any connection with the
  VM's identity (the image, the launcher, the leases held, 0 before the VM
  runs), from the one function the `slot` reply's identity comes from. A
  connection takes no slot until it sends `lease`, and the idle stop counts
  slots only, so asking keeps no VM alive. A launcher older than `status`
  refuses it as `unreadable`: its image and launcher are read from its
  command line in `ps` (`launcherFromCommandLine`, a launcher of this state
  directory only, since the suites run theirs over the same binaries), its
  holders not known.
- **Each slot's ssh socket:** the guest's socat listens on
  `/run/pinetrie/ssh-<i>.sock` and connects to vsock `2400+i`, where the
  launcher connects it to the socket its lease named: the host's ssh
  socket (`@pinetrie/ssh`, ADR-0140), not the person's agent. The launcher
  bridges bytes, so the lease's field keeps its name, `agent`. A lane cannot open a
  vsock socket (S128), so only that socat reaches it.
- **The network is gvproxy's** (gvisor-tap-vsock, S136), which the
  launcher starts before the VM and stops with it; if it exits, the VM
  stops. The card's frames go to it as datagrams on a unix socket
  (`VZFileHandleNetworkDeviceAttachment`): bound to `net.sock`, connected
  to its `gv.sock`, `VFKT` first, buffers of 1 and 4 MiB, as vfkit does.
  The VM's address is `gvproxy`'s one DHCP lease, for MAC
  `5a:94:ef:e4:0c:ee`: `192.168.127.2`, with the gateway and DNS at
  `.1` and the Mac's loopback at `.254` (`GVPROXY_HOST_ADDRESS`).
  - **Not Virtualization's NAT:** macOS shares it between every VM on the
    Mac, and one `container run` removed its Mac side, `bridge100`, under a
    running VM, which had no network from then on (S135).
  - **`-ssh-port -1`:** by default `gvproxy` forwards the Mac's
    `127.0.0.1:2222` to the VM's port 22.
  - **Pinned:** `launcher/gvproxy.json` names the release and its SHA-256;
    `ensureGvproxy` fetches it once into `bin/` (`ensurePinned`), refusing
    another hash.
  - **Its API** (`gv-api.sock`) is on the Mac's side only, for the host.
- **The lanes' fence** (`init`): `gvproxy`'s network holds the Mac's
  loopback (`.254`) and its API on the gateway (`.1:80`), which opens ports
  on the Mac; without a fence a lane reaches both (S136). Three rules in
  `DOCKER-USER`, which Docker runs first for every container's traffic: the
  gateway's DNS returns, the rest of `192.168.127.0/24` is rejected. Docker
  is bridged to the Mac (vsock 2375) only once they are set, so no host
  starts a lane before them, and without them it is never bridged. A
  project's `lanes.hostPorts` adds rules above them, from the host
  (`packages/docker/TECHNICAL.md`).
- **The network comes before Docker** (`init`): Docker starts after DHCP
  has written `/etc/resolv.conf`, or after 10 s without an answer. A pull
  Docker answered before then asked `[::1]:53` and failed (S134).
- **The idle stop:** with no lease for 10 minutes (`LAUNCHER_IDLE_SECONDS`),
  and on `SIGTERM`, the launcher asks the guest to `sync` (vsock 2377),
  stops the VM, and exits. A running VM keeps the image and launcher it
  started with until then.

## The repair (`repair.ts`, `repair-lock.ts`, `builder/repair-init`)

A lane VM whose data disk is full is repaired offline (ADR-0210, S314,
S322): the builder's machine booted on `data.img`, with the VM stopped.
When a host repairs is `@pinetrie/machine`'s; this is the boot and its locks.

- **The boot is pinned and made ready ahead** (`ensureRepairBoot`): the
  builder's kernel, root and modules, the six modules btrfs needs, and
  `btrfs-progs` with its six libraries, each an apk pinned by version and
  SHA-256 in `builder/pins.json`'s `repair` (a test holds `btrfs-progs` to
  the manifest's). The apks are unpacked in Node, files and symlinks with
  their modes (`apkEntries`): a library is found by its symlinked name.
  The initrd is `builder/repair-<hash>.cpio`, the hash of everything in it,
  `repair-init` included; a prune keeps it and the apks (`repairBootNames`),
  so one remade for a changed `repair-init` needs no network. A host on the
  Mac makes it ready at its start, beside the lanes, so a repair never
  fetches or compiles when it runs; one not ready refuses
  (`repairBootMissing`).
- **Its `/init` speaks lines** (`builder/repair-init`): each starts
  `[repair] ` (`REPAIR_LINE_PREFIX`), read by `parseRepairLine` and
  `repairReport`: the room found, grown or not, each repack's chunks moved,
  the room left, `done` or `failed`. Sizes are printed with awk's `%.0f`:
  busybox awk's `%d` stops at 2³¹−1 (S322's correction). A boot that never
  says `done` failed. It grows nothing: the caller grows `data.img` first,
  by the plan a start grows it by.
- **`REPAIR_LOCK` and `repair.state` are in the state directory**, beside
  `data.img`, never `images/`, which a scenario's own lane VM shares. The
  lock serves a repair and every VM's start: a start, its growth included,
  runs under it (`startLaneVm`, the only taker of the proof `startVm`
  needs), so no VM starts and no disk grows while a repair has it, and no
  repair stops a VM mid-start. Its waiting words are the caller's
  (`onStartWaiting`): vm cannot tell a repair from a start. `repair.state`
  is text, written whole by the lock's holder alone (`writeRepairState`);
  vm never reads its meaning, which is the machine package's.
- **The proofs are made only when a lock is taken** (`RepairLockHeld`,
  `LauncherLockHeld`). `stopVmForRepair` takes the first, and
  `repairDataDisk` the second.
- **`stop-for-repair`**: on any connection, the launcher stops the VM and
  exits whatever leases it holds, as `retire` does without its refusal;
  every host's lease ends, and each one kept leases again, its start
  waiting on the repair lock. The repair then takes `launcher.lock`
  (`awaitLauncherGone`): its holder's exit is the exact sign the disk is
  free, and held through the boot it keeps any launcher out, of any
  version, which finds it held and exits at once. A repair starts no VM:
  it writes its state and lets both locks go, the launcher's first, and the
  kept leases start the VM.
- **After every start a host makes, the console's last boot is read**
  (`leaseStartedVm`, `isDiskFullAtLastBoot`), whether Docker answered or
  not: Docker may answer on a full disk and fail every write after (S322).
  `data disk full` there fails the lease as `DiskFullAtBoot`, its lease
  closed, for the host's repair.
- **The VM's logs grow for as long as its state directory lives**
  (`console.log`, `launcher.log`): the Health page's diagnostics read
  their tails (`readVmLogTail`) from the last 64 KiB only, the line the
  read cut into dropped. The start's read of the console stays whole.
- **A repair with no room to grow still repacks**, which may itself fail
  for want of room: the repair then fails, saying so.

## A host's lease (`lease.ts`, `keep.ts`)

- **A host joins only a current VM** (`planVmVersion`). The `slot` reply
  names the image and launcher the VM was started from, and its leases. A
  host whose `imageKey` or launcher name differs, holding the only lease,
  sends `retire`: the launcher syncs, stops the VM and exits, and the host
  starts the current one. With other hosts' leases on it, the host joins it
  and logs so, and the VM is replaced when the last of them stops.
  `planVmVersion` takes the leases of hosts other than the asker
  (`otherHolders`: a host's own lease is not counted, `vm:build` holds
  none), so a host and `vm:build` ask it alike, and whether the launcher
  can be retired apart from how many hold it: one that refuses `status`
  takes `retire` yet does not say (`holders-unknown`). Every line about the
  VM's version is `vmVersionWords`, or `vmKeptWords` for a host that
  cannot start the new VM, each around `vmChangeWords`: both images and
  what differs (the image files, an older launcher, or unrecorded
  sources). A host
  that cannot start the current VM (no Xcode tools, `vmStartRefusal`) joins
  the old one and says what is missing; a missing image is built first. Without this, a host after an update joined
  the VM left running by the last one, for up to its 10 idle minutes.
- **A lease says what it builds before it builds it:** the launcher, and
  the image with what it compiles or fetches first (`VmBuild`), handed to
  its `building` as a value; a host's start words it and times it (ADR-0191).
  Given none (`pnpm vm:build`'s callers, a scenario's lease), it logs
  `vmBuildWords`' line, with its fixed estimate.
- **A launcher older than the VM's identity** sends a `slot` without it:
  read with a null identity (`VmIdentity`), joined (`old-launcher`), and
  the log says how to replace it, since it cannot take `retire`. A decoder that dropped such a
  reply left a host waiting for a slot that never came, with nothing logged.
- **Every launcher reply has a deadline:** 30 s for a lease or a fill, 60 s
  for a retire; past it the host fails naming what it waited for. The host
  logs before it asks for a slot.
- **A host keeps its lease** (`keepLease`): one that ends without the host
  closing it (its launcher stopped or died) is leased again, which starts a
  VM, with a wait doubling from 1 s to 30 s; the slot's leftovers are
  stopped (on a VM just started, each is stopped already) and it is filled
  again, and the grant written again. The Docker target reads the slot
  through the lease held now, so each lane is made again at its next
  start. Without this, a host whose launcher was killed failed every lane's
  step until it restarted.

`leaseVm` gathers (the state directory, the image for the current
`imageKey`, the launcher, the Mac's version and chip, whether
`control.sock` answers), plans (`planVm`: join, start, or a refusal worded
by `vmWords`), then starts the launcher if need be, takes a slot, and waits
for Docker's `/_ping`. Its `Lease` is the slot, the Docker socket, `fill`
and `close`. `fill` takes the slot's stop, runs it first and waits for it
to settle, so no slot is filled while a container the last host left still
binds into it: the order is `fill`'s own, and no proof value crosses from
`@pinetrie/docker`, which this package may not declare (the stop settles
only once each such container has died, `stopSlot`); then it shares
the directories (`planShares`), once per lease, answering the `Fill` it
made. `planShares` names each entry by a hash of its source, so a directory
has one name whatever else is shared; one source given twice is one entry,
read-write if either is. `slotRoot` is where a slot's entries are, for the
stop of what binds into it.

## Gotchas

- **A full data disk stops the VM serving any host:** dockerd may never
  answer, or answer and fail every write (S322). Full is btrfs's, not
  `df`'s: once every chunk is allocated, a full metadata fails every write
  while `df` still shows the free space inside data chunks (S314), and a
  balance cannot run to free one. pine·trie repairs it, offline (above):
  a host that manages the machine, when its samples find the room spent
  with nothing left to delete, or a start whose console says so. `init`'s
  own resize failed once, on a disk of 36,000 subvolumes, and logs why to
  the console; the repair boot grew that one.
- **The lease grows `data.img` at each start it makes** (`growDataDisk`,
  `grow.ts`, ADR-0210), under the repair lock, before the launcher starts, so `init`'s resize
  takes it at that boot: to the size its host plans (`LeaseInput.growData`,
  the machine package's `planStoreSize` over the file's size and allocated
  bytes and its volume's free space), within `lanes.store.max` and never
  into `lanes.store.leaveFree`, and only ever larger. A sparse file grown
  costs the volume nothing until the guest writes into it. A lease on a VM
  already running grows nothing: growth waits for the next start (an idle
  stop, an update), which `room-low`'s words say, or a repair, which
  grows it by the same plan (`laneVmRepairControls`, the host's).
- **Space freed in the guest goes back to the Mac** within seconds: the
  data disk takes discards and btrfs sends them (`discard=async`), so
  `data.img`'s size on the Mac follows what the guest holds (S312).
- **socat's `-t`:** without it, socat cuts a stream 0.5 s after its input
  ends (S128, S129).
- **`/dev/net/tun` is 0600 without udev;** the init makes it 0666 for
  rootless Docker in a lane (S127).
- **A bind into a replaced share fails with "No such file or directory",**
  and the guest logs nothing (S130).
- **A file the Mac and a lane append to at once loses the Mac's lines,**
  in a shared directory or any read-write share: 11 to 20 of 100 kept,
  the lane's all kept, nothing torn. Lanes of one host appending through
  their slot keep every line (S141).
- **One Mac directory read-write in two slots at once** loses both sides'
  appends, tears lines, and can refuse a create through one slot of a file
  just made through the other (S141). A host never does it to itself
  (`planWidening`); two hosts sharing one read-write directory would meet
  it.
- **One directory seen through two entries lags by about 1 s** for a
  rename, an append or a delete made through the other, in one slot or two
  (S178, S187): the guest caches each entry's names and sizes apart. One
  entry bound twice shows every change at once.
- **The VM's `T+` clock is the guest's uptime,** not the Mac's: they differ
  by the launcher's own start and the first ping, 0.15–0.5 s (S128).
- **`setShare:` is not in the public headers:** the launcher calls it by
  selector on the running `VZVirtioFileSystemDevice` (S128, S131).

## Tests

`plan.test.ts` (among them the launcher's argv and its disk modes),
`protocol.test.ts`, `build.test.ts`, `apk.test.ts`, `pinned.test.ts`,
`repair.test.ts` and `lease.test.ts`, whose lease runs against a stand-in
launcher, and whose locks are held by another process
(`childHoldingLock`); mutations in `scripts/mutations/vm.ts`. The real
launcher and VM are checked by the `contract` scenario under Docker
(`packages/docker/TECHNICAL.md`), the image's build in a VM by the lanes
suite's `vm-image` scenario, and the repair by its `vm-repair` scenario,
both on the Mac.
