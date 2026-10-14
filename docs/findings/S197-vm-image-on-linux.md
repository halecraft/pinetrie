# S197 — Can Linux build the lane VM's image in QEMU from the same kernel and initrd the Mac's build boots, and how long does it take?

- **Status:** Open

**Question.** S195 built the lane VM's image on the Mac in a one-shot
Virtualization VM: `linux-virt`'s kernel, an initrd of Alpine's
minirootfs, seven modules and a builder `/init`, the outputs written as a
tar to a raw disk. On Linux there is no lane VM, and `pnpm vm:build`
reports that there is nothing to build; `--force` should still build one,
with no Docker. Can QEMU boot the same kernel and initrd, so that only the
program starting the VM differs between the two platforms?

1. Does `qemu-system-aarch64 -M virt` boot the unpacked `Image` with the
   initrd as is, and does the builder `/init` find the same devices:
   virtio-net as `eth0` with `-netdev user`, the output disk as
   `/dev/vda` with `-drive file=out.img,format=raw,if=virtio`, entropy
   with `-device virtio-rng-pci` (or `-mmio`)? Does it need modules S195's
   seven do not hold (`virtio_pci` is built into `linux-virt`; check its
   config)?
2. Does the guest's clock come from QEMU's PL031, so `apk`'s TLS accepts it?
3. How long does a build take: on an arm64 Linux machine with KVM
   (`-accel kvm -cpu host`), on an arm64 one without (in a lane: TCG), and
   on x86_64 (TCG, `-cpu max`)?
4. What does it need installed: the package that provides
   `qemu-system-aarch64` on Debian, Ubuntu and Alpine, and its size? Any
   firmware for `-M virt` with `-kernel`?
5. Do the tools that S195 ran on the Mac (`bsdtar` to convert the
   minirootfs to newc cpio, `gunzip`, the zboot unpack) exist on a stock
   Linux, or must the conversion be done in TypeScript to serve both?

**Kill criterion.** QEMU cannot boot the kernel and initrd unchanged (the
initrd or `/init` must differ by platform), or a build without KVM takes
longer than 10 minutes on the machine measured.

**Throw away.** Everything under `/tmp/s197/`: the downloads, the initrd,
the disks and the outputs.
