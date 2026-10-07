# S133 — The lane VM's image builds in a lane, and Docker in a lane accepts a lane's arguments, but rootless Docker's `newuidmap` is refused under `container`

**Status:** Answered. Serves `PLAN-2026-10-07-lane-runtime` (ADR-0103),
Phases 2, 5 and 7.

**Question.** Before the Mac runs them, from inside a pine·trie lane (Apple's
`container`, aarch64, Debian trixie, no `CAP_SYS_ADMIN`):
1. Does `packages/vm/image/build.sh` build the VM's image, and what does it
   make?
2. Does Docker accept the arguments `renderRun` writes, for a plain lane and
   a nested one with the generated seccomp profile?
3. Does rootless Docker start in such a lane, as a nested lane's would?

**Kill criterion.** None: it checks work before the Mac's proof, which
decides.

**Throw away.** The Alpine chroot, the built image, the static Docker
bundle and the probe scripts, in the lane's `/tmp`.

## How it ran

1. An Alpine 3.23.6 minirootfs, extracted in `/tmp` and entered with
   `chroot` (the lane may `chroot`, not `mount`), stood in for the
   `alpine:3.23` container `planBuild` names. `buildVmImage` ran through it,
   sources as arguments and outputs as a tar on stdout, as on the Mac.
2. Docker 29.8.2's static `dockerd`, run in `unshare -Urm` (root mapped to
   root only, so no `newuidmap`), with `--storage-driver=vfs`, no bridge and
   no iptables. An image of static busybox, every file owned by root, was
   `docker import`ed: Alpine's and busybox's own images hold files of other
   users, which a one-id namespace cannot own ("lchownat … invalid
   argument").
3. `dockerd-rootless.sh` as uid 1000 (`node`), with `uidmap`,
   `slirp4netns` and a `subuid` range.

## Answers

1. **The image builds in 15 s:** `Image` 34.6 MB (36,306,944 bytes, the
   size of S126's), `stage1.cpio` 1.6 MB, `system.erofs` 102.3 MB, against
   S128's 113 MB with the docker CLI and `e2fsprogs`.
   - Alpine 3.23 still serves every version S128's image held (its
     `APKINDEX`, 2026-10-07).
   - `linux-virt`'s `vmlinuz-virt` is an EFI zboot image: `zimg` at offset
     4, the gzip payload's offset and size at 8 and 12. Its payload is the
     arm64 `Image` (`ARMd` at 56).
   - `virtio_rng`'s file is `virtio-rng.ko.gz`: `modules.dep` spells a
     module's `_` as `-`.
   - apk 3 takes `--initdb` as an option of `add`, not a global one, and
     `mkfs.erofs` 1.8 has `--quiet` and no `-q`.
   - Everything `init` calls is in the image; the trimmed driver trees are
     gone; `/etc/pinetrie/modules` lists the manifest's modules.
2. **Docker accepted both shapes' arguments and created both containers:**
   the spec and project labels, every `--mount` (read-only where the shape
   says), `no-new-privileges` for the plain lane, and for the nested one the
   seccomp profile (read by the CLI from `seccomp-nested.json`),
   `systempaths=unconfined` and `/dev/net/tun`. Neither started: runc could
   not apply the memory limit's cgroup ("unable to apply cgroup
   configuration"), which this lane does not give. Docker on the Mac's VM,
   and in a nested lane under Docker, has cgroups.
3. **Rootless Docker did not start:** "newuidmap: write to uid_map failed:
   Operation not permitted", though the lane has `CAP_SETUID`, a full uid
   map and no `NoNewPrivs`. Not explained. S125 ran the same under Docker
   with the narrow profile, which is what a nested lane gets; Apple's
   `container` is not that, so this does not bear on the plan.

## What this means

- The image's build is checked end to end before the Mac's first
  `pnpm vm:build`; what is left is the build under `container run` and
  the boot.
- `renderRun`'s arguments are Docker's own; what is left on the Mac is
  running them, with btrfs and cgroups.
- Lanes inside lanes can only be checked under Docker (Phase 9).
