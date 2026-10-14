# ADR-0147 — The Mac builds the lane VM's image on demand in a throwaway VM of its own, from files the manifest pins; elsewhere there is nothing to build, and `vm:build` says so

- **Status:** Accepted (Duane, 2026-10-14)
- **Area:** `packages/vm/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`,
  `apps/pinetrie/e2e/TECHNICAL.md`, `AGENTS.md`
- **Evidence:** S195
- **Amends:**
  - ADR-0130: the VM's image is built on the Mac in a VM of pine·trie's own,
    from `linux-virt` and Alpine's minirootfs pinned by SHA-256, not in a
    Docker; a host that finds it missing builds it.

**Context.** `pnpm vm:build` runs `packages/vm/image/build.sh` in an
`alpine:<branch>` container, in the lane VM's Docker if it runs, else in
any Docker on the machine (`planBuilder`). The VM starts only from the
image for the current `imageKey`, which changes with any edit to
`packages/vm/image/`, so a Mac's first image, and every new one while
the VM is stopped, needs a Docker on the Mac. That Docker exists only to
build the image: lanes run in the VM. A host that finds no image refuses
to start (`planVm`'s `no-image`), naming `pnpm vm:build`. On Linux the
image is never booted (lanes run in the host's Docker, `planRuntime`), and
on x86_64 its build fails outright: the container is amd64 and `build.sh`
refuses a builder of another architecture.

S195 measured another way on the Mac: a one-shot Virtualization VM booted
from the manifest's own `linux-virt` kernel and Alpine's minirootfs runs
`build.sh` unchanged in 19 s, with 1 GiB, and the lane VM boots the result.

**Decision.**

1. **Where the lane VM can run is decided once** (`packages/vm`): not a
   Mac, a Mac without Apple silicon, or macOS before 13 is refused, in the
   words `vmWords` has today. Both plans below start from that check, so
   no image is built where no VM could boot it.
2. **A lease builds what it lacks.** The plan a lease makes (`planVm`) no
   longer refuses a missing image when Xcode's command line tools are
   there: it starts the VM after building the image, as it already builds
   a missing launcher. A host joining a VM that runs an older image, with
   no current one, builds it, then replaces the VM as today. A host that
   builds says so first ("building the lane VM's image, about 20 s"). So
   every host with tools on the Mac (`pnpm dev`, `pnpm serve`, the
   suites') builds a missing image with no step of its own.
3. **`pnpm vm:build` and `pnpm build` plan on their own** (`planVmBuild`):
   `present`, `build`, `not-needed` (where the VM cannot run, with that
   reason) or `refused` (no Xcode tools, or `--force` where there is no
   builder), each worded in one function. `not-needed` is never silent:
   it names why, and that `--force` builds anyway.
4. **The build, on the Mac only:**
   - **Kernel and root** from `packages/vm/builder/pins.json`: the URL and
     SHA-256 of `linux-virt-<version>.apk` and
     `alpine-minirootfs-<version>-<arch>.tar.gz`, their versions those of
     the manifest's `linux-virt` and `alpine-base` (a test holds them
     equal). Fetched once into the state directory and checked, as
     `gvproxy.json`'s release is. The builder boots the very kernel the
     image ships.
   - **The initrd,** made on the Mac with what macOS ships: the
     minirootfs converted to newc cpio by `bsdtar`, keeping root's
     ownership; the seven modules a build loads (`failover net_failover
     virtio_net virtio_blk rng-core virtio-rng af_packet`), gunzipped;
     and `packages/vm/builder/init`, concatenated in that order. The
     kernel is unpacked from its EFI zboot in TypeScript (`node:zlib`).
   - **The machine** is a second small binary, `builder.swift`, compiled
     and signed as the launcher is: the kernel, the initrd, 1 GiB, every
     CPU, Virtualization's NAT, entropy, the console to a log, and a
     sparse 1 GiB file as `/dev/vda`. Its `/init` writes the outputs to
     `/dev/vda` as a tar and powers off; the Mac reads them back with
     `tar` and installs them as today, checked against `SHA256SUMS`.
   - **The builder's files are not in `imageKey`:** they change how an
     image is built, not what it holds, so a change to them makes no
     running VM stale.
5. **Installing never removes a whole image:** a build that finds the
   image already in place (another host built it meanwhile) discards its
   own, so a launcher never starts from a directory being replaced.
6. **Old images, launchers and pins are deleted after a build,** all but
   the current ones and any a running launcher process names in its
   arguments: a running VM keeps the image and launcher it started from.
   Not `control.sock`: the contract scenario runs a launcher from another
   state directory over the same images and binaries.
7. **`--force` on Linux is refused for now,** saying building there is not
   supported yet; whether QEMU can boot the same kernel and initrd is S197.
8. **No Docker builds the image any more:** `planBuilder`, its words and
   `planBuild`'s container argv go. The observer suite takes the kernel
   alone, from the same pinned `linux-virt`, with the same unpacking.

**Consequences.**
- On the Mac, `pnpm dev` (or `pnpm serve`) needs nothing more than the
  lane VM already needs: Apple silicon, Xcode's command line tools, the
  network, and the Docker CLI with buildx, which build lane images
  against the VM's Docker. No Docker engine runs on the Mac. The first start, and the first after the image's sources
  change, takes about 20 s longer, and 43 MB is fetched once per manifest
  update.
- A Linux machine, or a lane, can no longer check an edit to
  `packages/vm/image/` by building it; the Mac builds it on its next start,
  and the `contract` scenario boots it.
- The builder uses Virtualization's NAT, shared by every VM on the Mac,
  which one `container run` has broken under a running VM (S135). A
  build lasts 20 s; one that loses the network fails naming it, and a
  second run builds.
- Two pins follow the manifest: when Alpine drops a `linux-virt` version,
  updating the manifest updates `pins.json` with it.

**Alternatives rejected.**
- **Keep Docker as the builder, the VM a fallback.** Two ways to build,
  and the common case still needs a Docker on the Mac for nothing else.
- **Boot Alpine's netboot files.** The loose ones are unversioned; the one
  versioned set is a 426 MB tarball whose `virt` kernel is not the
  image's (S195).
- **A build mode in the launcher.** A launcher's name is its source's
  hash, and a host retires a VM whose launcher differs: every builder
  change would restart running VMs.
- **gvproxy for the builder's network.** It is pinned and fetched already,
  but adds a second process to start and stop around a 20 s build; NAT's
  fragility matters for a VM that runs for hours.
- **Build the next image in an older one, booted for the purpose.** It
  serves no first image, nor one after the state directory is cleared.
- **Download prebuilt images from CI.** An edit to the image could not be
  used on a Mac until CI had published it.
