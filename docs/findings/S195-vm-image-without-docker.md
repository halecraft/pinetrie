# S195 — The Mac can build the lane VM's image with no Docker: a one-shot Virtualization VM booted from the manifest's own `linux-virt` and Alpine's minirootfs runs `build.sh` in 19 s, and the lane VM boots the result

- **Status:** Answered
- **Led to:** ADR-0147, ADR-0148

**Question.** `pnpm vm:build` runs `packages/vm/image/build.sh` in an
`alpine:<branch>` container, so a Mac's first image, or a new one while
its VM is stopped, needs a Docker on the Mac (`planBuilder`,
`packages/vm/TECHNICAL.md`, "The image"). Can it instead boot a one-shot
Virtualization VM from files Alpine publishes for the manifest's branch,
pinned by SHA-256, and run `build.sh` in it, needing nothing the lane VM
does not already need (Apple silicon, Xcode's command line tools, the
network)? In detail:

1. Is there a versioned, pinnable set of release files (kernel, an
   initramfs with the modules a build needs, a root with `apk`)?
2. Does Virtualization's `VZLinuxBootLoader` boot Alpine's `vmlinuz-virt`
   once the Mac unpacks its EFI zboot payload, with no Linux tool?
3. Can the root be built on the Mac with no Linux tool, as concatenated
   newc cpio archives (Alpine's `initramfs-virt` for its modules, the
   minirootfs, and our `/init` last), keeping root's ownership?
4. Does the guest reach the network (virtio-net, DHCP) and keep a clock
   TLS accepts, so `apk` installs the manifest's packages?
5. Can the outputs come back with no share or guest module beyond
   `virtio_blk`: a tar written raw to a second disk, read on the Mac?
6. Are the outputs byte-identical to the Docker build's (the same
   `SHA256SUMS`), and how long does it take?

**Kill criterion.** The approach is dead if `vmlinuz-virt` will not boot
under `VZLinuxBootLoader` from its unpacked `Image`, or if the guest cannot
install the manifest's packages (no network or no clock TLS accepts)
without adding something the Mac must install. Different bytes from the
Docker build do not kill it, but they are named.

**Throw away.** Everything under `/tmp/s195/`: the downloads, the probe's
Swift and its binary, the cpio archives, the disks and the outputs.

## Answers

Not killed: every step works with what macOS ships (`bsdtar`, `gunzip`,
`python3` for the zboot header, `xcrun swiftc`) and the network.

1. **Pin the kernel by the manifest, not by a netboot release.** Alpine's
   `releases/aarch64/netboot/` files are unversioned (always the latest
   point release); the only versioned netboot is
   `alpine-netboot-3.23.6-aarch64.tar.gz`, 426 MB, most of it the `lts`
   and `rpi` kernels, and its `virt` kernel (6.18.52) is not the image's.
   The `linux-virt-<version>.apk` the manifest already pins
   (`main/aarch64/linux-virt-6.18.56-r0.apk`, 39 MB) carries
   `boot/vmlinuz-virt` and every module, and `bsdtar` reads it as is (an
   apk is concatenated gzip streams). Its unpacked `Image` is
   byte-identical to the image's own `Image`, so the builder boots the
   kernel the image ships. The root is
   `releases/aarch64/alpine-minirootfs-3.23.6-aarch64.tar.gz` (4 MB),
   versioned by `alpine-base`'s version in the manifest, with
   `.sha256` beside it. Both are in Alpine's repo or releases only while
   current, as the manifest's packages are: a pin that vanished is the
   same deliberate manifest update.
2. **Yes.** The zboot header (`zimg` at 4, payload offset and size at 8
   and 12, `gzip` at 24) unpacked in a few lines of Python to an arm64
   `Image` (`ARMd` at 56); `VZLinuxBootLoader` booted it with the initrd
   and `console=hvc0 rdinit=/init`. `/init` ran 0.06 s after start.
3. **Yes, and without `initramfs-virt`.** `bsdtar --format newc -cf
   root.cpio @alpine-minirootfs.tar.gz` converts the tar to cpio keeping
   its uid and gid 0 with no extraction; the probe's own files go in with
   `--uid 0 --gid 0`. The kernel takes the archives concatenated, later
   entries winning. `initramfs-virt` is not needed and is awkward: its
   `bin`, `lib` and `sbin` are symlinks into `usr`, where the minirootfs's
   are directories. Its modules are for the netboot's 6.18.52, not the
   manifest's kernel.
   - **Modules, loaded by hand:** linux-virt's modules are `.ko.gz`,
     which the minirootfs's busybox `modprobe` and `insmod` cannot read
     (as the image's `kmod` entry says). The Mac gunzips the seven a
     build needs into `/m`, and `/init` `insmod`s them in dependency
     order: `failover net_failover virtio_net virtio_blk rng-core
     virtio-rng af_packet`. **`af_packet` is a module in 6.18.56:**
     without it `udhcpc` fails with `socket(AF_PACKET,2,8): Address family
     not supported by protocol` and `apk` cannot resolve a name. With
     `initramfs-virt`'s module tree the kernel had loaded it on its own.
4. **Yes.** `rtc-pl031` is built in (`CONFIG_RTC_DRV_PL031=y`) and set the
   clock from the Mac's at boot; `apk`'s TLS accepted it. With
   `VZNATNetworkDeviceAttachment` the guest had an address by 0.27 s,
   and `build.sh` installed every manifest package at its pinned version.
   NAT was chosen for brevity: the lane VM uses gvproxy because macOS's
   NAT is shared and fragile (`packages/vm/TECHNICAL.md`); a 19 s build
   meets that rarely, and could use the pinned gvproxy instead (not
   tried).
5. **Yes.** A sparse 1 GiB file (`mkfile -n 1g`) attached as the only
   disk is `/dev/vda` (not `vdb`; writing to a missing `/dev/vdb` made a
   plain file in devtmpfs and reported success). `tar -cf /dev/vda` then
   `sync`, and the Mac's `tar -xf out.img` reads it back, stopping at the
   end marker; `shasum -c SHA256SUMS` passes. `poweroff -f` stops the VM,
   and the probe exits on `guestDidStop`.
6. **`Image` is identical; the other two differ only as two Docker builds
   would.** Against the Docker-built image for the same `imageKey`
   (`64aabef58fefc1a1`): `Image` has the same SHA-256. `stage1.cpio`
   unpacks to identical files; its listing differs only in mtimes and in
   directories' link counts (1 under Docker's overlayfs, the true count
   under tmpfs). `system.erofs` differs, and three VM builds gave three
   hashes too: the build writes the time into both. Nothing compares
   outputs (`imageKey` hashes the sources), so this does not matter.
   **The lane VM boots the result:** with the real launcher and lease
   (`leaseVm`) in a separate state directory holding the VM-built
   image, Docker answered 3.05 s after the launcher started (29.5.2,
   overlayfs, kernel 6.18.56-0-virt) and `docker run alpine:3.23`
   ran.
   **Time:** 18.6–19.1 s from start to power-off with 1 or 2 GiB of memory
   and every CPU, the network included (the packages are fetched each
   time; the Docker build in a lane took 15 s). The downloads, 43 MB,
   are once per manifest. 1 GiB is enough: the root, the chroot and the
   outputs all live in the initramfs's tmpfs.

7. **The kernel needs no tool at all, on any platform.** Node's
   `gunzipSync` reads an apk's three concatenated gzip streams (its
   signature, `.PKGINFO`, and the data) as one tar, 73.5 MB and 1510
   entries. A walk of 512-byte ustar headers, taking a pax `path` where
   one is given, finds `boot/vmlinuz-virt`, and the zboot unpack of it
   gives an `Image` whose SHA-256 is the Docker build's
   (`83f0f917…`), in 162 ms all told.

**What a plan needs, from this.** The pins (minirootfs and linux-virt,
SHA-256 each), fetched and checked like `gvproxy.json`; the zboot unpack
and the cpio archives in TypeScript (`node:zlib` and a newc writer, or
macOS's `bsdtar`); a build mode of the launcher or a second small Swift
binary, signed as the launcher is; the probe's `/init` as a source of the
image, so a change to it changes `imageKey`; and `planBuilder` with a
third, last builder that needs no Docker. A `vm:build` on Linux keeps
Docker: Virtualization is the Mac's.

## Evidence

Run on the Mac (macOS 26.6, M3 Max, Xcode's `swiftc`) on 2026-10-14,
against `packages/vm/image/` at `imageKey` `64aabef58fefc1a1`. Kept in
`docs/findings/S195-vm-image-without-docker/`:

- `make-initrd.sh`: fetches the minirootfs and `linux-virt`, unpacks
  the kernel and the seven modules, and writes `Image` and `initrd.cpio`;
  re-run from scratch, it gave a build whose `SHA256SUMS` checked.
- `init`: the builder's PID 1: the modules, DHCP, `build.sh`, the tar to
  `/dev/vda`, power off.
- `probe.swift`: the VM: `Image`, `initrd.cpio`, `out.img` as a disk,
  NAT, the console on stdout, entropy; exits when the guest stops. Built
  with `xcrun swiftc -swift-version 5 -O` and signed ad hoc with
  `packages/vm/launcher/launcher.entitlements`.

Runs: the netboot 6.18.52 kernel with `initramfs-virt`'s modules and
4 GiB, 17.4 and 18.5 s (the first wrote its tar to the missing
`/dev/vdb`); `linux-virt` 6.18.56 with seven modules, 2 and 1 GiB, 19.1
and 18.6 s, after a first pair without `af_packet` stopped at DHCP in
10 s.
