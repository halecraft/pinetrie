# `@pinetrie/vm`: technical notes

A Linux machine on the Mac for lanes' Docker (ADR-0130): its image, and
the launcher that runs it and a host's lease on a slot of it. It declares
only `@pinetrie/core` and knows nothing of lanes (`workspace.test.ts`).

## The image (`image/`)

- **`manifest.json` pins everything:** the Alpine branch, each package's
  exact version, the modules stage 1 and the init load, and the module
  trees for hardware a VM lacks. Alpine keeps only each package's latest
  version, so a build that cannot install a listed version fails naming it:
  an update is a deliberate edit of the manifest.
- **`docker-engine`, not `docker`:** the VM needs no CLI or buildx (lane
  images are built from the host's CLI), and `docker` pulls both.
- **`kmod` is listed:** `modprobe` must read Alpine's `.ko.gz` modules.
- **The image's identity is `imageKey`,** a hash of the manifest and the
  three scripts, since a script's change makes another image too. A build
  lands in `$XDG_STATE_HOME/pinetrie/vm/images/<key>/`, unpacked into a
  temporary directory and checked against its `SHA256SUMS` first.
- **The build needs no mount** (`planBuild`): the sources go in as base64
  arguments, and the outputs come out as a tar on stdout. So it runs alike
  in any Docker: `pnpm vm:build` picks the VM's own if it runs, else one on
  this machine, of any vendor (`planBuilder`). A Mac's first image, or a
  new one while its VM is stopped, needs one there: the VM starts only from
  the current image (`planVm`).
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
  `user_subvol_rm_allowed`, formatted on first boot; each slot's share at
  `/mnt/host-shares/<i>`; Docker on vsock 2375 and each slot's ssh agent;
  `sync` on vsock 2377 for the launcher's stop; the clock (below). No
  shell listens on any port. `socat -t 3600`: without it, socat cuts a
  stream 0.5 s after its input ends (S128, S129).
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

## The launcher (`launcher/launcher.swift`)

- **One per user,** in `$XDG_STATE_HOME/pinetrie/vm/`: an exclusive `flock`
  on `launcher.lock`, so a second exits at once and its host joins the
  first. A host that finds no `control.sock` answering starts one, detached,
  its output in `launcher.log`.
- **Built on demand** (`launcher.ts`): `xcrun swiftc -swift-version 5 -O`,
  signed ad hoc with `com.apple.security.virtualization`, into
  `bin/launcher-<hash of the source and entitlements>`. Without Xcode's
  command line tools the lease is refused, naming `xcode-select --install`.
- **The machine:** `VZLinuxBootLoader` with `Image`, `stage1.cpio` and
  `lane.slots=<n>`; `system.erofs` read-only and `data.img` (256 GiB
  sparse) as disks; NAT; a console to `console.log`; entropy; vsock; and
  `<n>` share devices `slot0` … `slot<n-1>`, each an empty directory at
  boot. Its memory is a quarter of the Mac's, between 4 and 16 GiB
  (`vmMemory`), and it has every CPU.
- **Disks are attached with synchronization `fsync`, caching `cached`.**
  Apple's defaults, `full` and `automatic`, made every `docker run` about
  500 ms (S129).
- **The bridge:** `docker.sock` to vsock 2375. Each direction's end becomes
  a `shutdown(SHUT_WR)` of the other side, and a pair closes when both
  directions end, so `docker run -i` sees its input end and keeps its
  output (S128). vfkit's bridge drops the half-close (S126).
- **Slots, one per host.** A host's directories are one
  `VZMultipleDirectoryShare` in its slot, filled once after the host has
  swept the slot's old containers, and never replaced while it runs:
  replacing a share cuts every bind mount into it, even to an entry the
  replacement kept, with nothing in the guest's log (S130). Share devices
  are apart: filling or emptying one leaves the others' binds working
  (S131). A slot empties when its lease's connection ends.
- **The limit:** 16 slots by default, `lanes.vm.slots` in the user config,
  at most 20: a VM boots with 20 share devices beside its others, and not
  24 (S131). It applies when the VM next starts. The 17th lease is refused,
  naming the limit and the key.
- **The lease protocol** (`protocol.ts`; the Swift side mirrors it): JSON,
  one message a line, on `control.sock`. `lease` (with the host's
  `SSH_AUTH_SOCK`) answers `slot`; `fill` answers `filled`; anything else is
  `refused` with a reason the host words (`launcherWords`). A lease lasts as
  long as its connection.
- **Each slot's ssh agent:** the guest's socat listens on
  `/run/pinetrie/ssh-<i>.sock` and connects to vsock `2400+i`, where the
  launcher connects it to the agent its lease named. A lane cannot open a
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
    `ensureGvproxy` fetches it once into `bin/`, refusing another hash.
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

## A host's lease (`lease.ts`, `keep.ts`)

- **A host joins only a current VM** (`planVmVersion`). The `slot` reply
  names the image and launcher the VM was started from, and its leases. A
  host whose `imageKey` or launcher name differs, holding the only lease,
  sends `retire`: the launcher syncs, stops the VM and exits, and the host
  starts the current one. With other hosts' leases on it, the host joins it
  and logs so, and the VM is replaced when the last of them stops. A host
  that cannot start the current VM (no image, no Xcode tools) joins the old
  one and says what is missing. Without this, a host after an update joined
  the VM left running by the last one, for up to its 10 idle minutes.
- **A launcher older than the VM's identity** sends a `slot` without it:
  read with a null identity (`VmIdentity`), joined, and the log says how to
  replace it, since it cannot take `retire`. A decoder that dropped such a
  reply left a host waiting for a slot that never came, with nothing logged.
- **Every launcher reply has a deadline:** 30 s for a lease or a fill, 60 s
  for a retire; past it the host fails naming what it waited for. The host
  logs before it asks for a slot.
- **A host keeps its lease** (`keepLease`): one that ends without the host
  closing it (its launcher stopped or died) is leased again, which starts a
  VM, with a wait doubling from 1 s to 30 s; the slot is swept and filled
  again, and the grant written again. The Docker target reads the slot
  through the lease held now, so each lane is made again at its next
  start. Without this, a host whose launcher was killed failed every lane's
  step until it restarted.

`leaseVm` gathers (the state directory, the image for the current
`imageKey`, the launcher, the Mac's version and chip, whether
`control.sock` answers), plans (`planVm`: join, start, or a refusal worded
by `vmWords`), then starts the launcher if need be, takes a slot, and waits
for Docker's `/_ping`. Its `Lease` is the slot, the Docker socket, `fill`
(once, through `planShares`) and `close`. `planShares` names each entry by
a hash of its source, so a directory has one name whatever else is shared;
one source given twice is one entry, read-write if either is.

## Gotchas

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
- **One Mac directory in two slots at once** loses both sides' appends,
  tears lines, and can refuse a create through one slot of a file just
  made through the other (S141). Nothing prevents it: two hosts sharing
  one read-write directory would meet it.
- **The VM's `T+` clock is the guest's uptime,** not the Mac's: they differ
  by the launcher's own start and the first ping, 0.15–0.5 s (S128).
- **`setShare:` is not in the public headers:** the launcher calls it by
  selector on the running `VZVirtioFileSystemDevice` (S128, S131).

## Tests

`plan.test.ts`, `protocol.test.ts`, `build.test.ts` and `lease.test.ts`,
whose lease runs against a stand-in launcher; mutations in
`scripts/mutations/vm.ts`. The real launcher and VM are checked by the
`contract` scenario under Docker (`packages/docker/TECHNICAL.md`).
