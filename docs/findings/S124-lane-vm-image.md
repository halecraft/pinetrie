# S124 — The Alpine ISO boots fastest (15 s): Docker is not reinstalled at boot, and the time goes before ssh answers; the cloud image and a clone of it take 27 s

- **Status:** Answered
- **Led to:** ADR-0102, ADR-0103, ADR-0130

Follows S123.

**Question.** S123's Alpine ISO keeps its root in RAM (329 MB) and booted no
faster than Ubuntu (16.0 s against 14.8 s), perhaps because it reinstalls
Docker on every boot. Three VMs in one run, each with the same configuration
as S123 (Lima, `vz`, virtiofs, 4 CPUs, 8 GiB, the repo mounted read-only):
1. the Alpine ISO (`template:_images/alpine-iso`);
2. Alpine's cloud image (`template:_images/alpine-3.23`), whose root is on
   disk;
3. a `limactl clone` of the provisioned cloud VM, standing in for an image
   with Docker built in.

For each:
- each stage of a first boot and of a second, from Lima's log;
- whether provisioning installed Docker or found it, and how long it took;
- memory held in the guest and on the Mac;
- space on the Mac;
- whether btrfs loads.

**Kill criterion.** Neither the cloud image nor the clone boots faster or
holds less than the ISO.

**Throw away.** The three VMs, which the script deletes, and the script and
its results (`s124-probe/` in the shared plans folder).

## How it ran

Duane ran the script once on the Mac (macOS 26.7.1, arm64, Lima 2.2.0), and
it completed. Stage times are from the moment `limactl start` ran, read as
each line of its log arrived. Memory on the Mac is the growth in RSS of the
`Virtualization.VirtualMachine` processes. The provisioning script logged
each boot to `/var/lib/probe-provision.log`, which survives a reboot on both
images. The clone kept its source's log.

## Answers

1. **Boot stages** (ms from `limactl start`):

   | | ISO, first | ISO, again | cloud, first | cloud, again | clone, first | clone, again |
   |---|---|---|---|---|---|---|
   | VM running | 630 | 458 | 15,935 (download before) | 448 | 523 | 441 |
   | ssh ready | 15,842 | 14,669 | 44,747 | 27,534 | 26,887 | 27,118 |
   | guest agent running | 16,008 | 14,836 | 44,903, then 79,859 | 27,698 | 27,051 | 27,279 |
   | Docker probe satisfied | 16,032 | 14,868 | 81,108 | 27,751 | 27,125 | 27,332 |
   | READY | **16,078** | **14,909** | **81,147** | **27,789** | **27,166** | **27,370** |

   On every boot, almost all the time passes between the VM running and ssh
   answering: about 14 s on the ISO and 27 s on the cloud image. Everything
   after ssh takes about 0.2 s. On its first boot the cloud image reported
   its guest agent twice, 35 s apart, before Docker was ready.
2. **Provisioning is not the cost:**
   - the ISO installed Docker on its first boot (7 s) and **found it there
     on its second** (1 s);
   - so did the cloud image (7 s, then 1 s each time);
   - so did the clone, on every boot (1 s).

   S123's guess, that the ISO reinstalls Docker on every boot, is wrong.
   Those 7 s fall inside "ssh ready" on a first boot: Lima runs the script
   before sshd is reported.
3. **Memory and space:**

   | | ISO | cloud | clone |
   |---|---|---|---|
   | root | tmpfs, 323 MB used | `/dev/vda2`, 488 MB used | the same, 488 MB |
   | guest used / shared (MB) | 169 / 324 | 153 / 0 | 165 / 0 |
   | memory the VM holds on the Mac | 1,371 MB | 1,254 MB | 1,218 MB |
   | space on the Mac | **157 MB** | 559 MB | 589 MB |

   Kernels: the ISO's is 6.18.26-0-virt, the cloud image's 6.18.22-0-virt.
   btrfs loads in all three.
4. **A clone of a stopped VM** took 38 ms.

## What this means

- **Kill criterion:** met for boot time, not for memory. The cloud image and
  the clone hold 117–153 MB less on the Mac, but boot 12 s slower and take
  3.6 times the space.
- **The ISO is the best of the three:** 15 s to boot again, 157 MB on the
  Mac.
- **Building Docker into an image would save about 6 s on a VM's first boot
  only.**
- **What remains of a boot happens before ssh answers:** firmware, kernel,
  init and sshd. Which of those takes the 14 s was not measured here. S126
  (direct boot) read the guest's clock at READY: 14.7 s of uptime, with
  `/init` started at 0.08 s, so the time is the guest's own userspace. A
  VM booted directly by vfkit, with its own init in place of OpenRC and
  Lima's, had Docker answering on the Mac in under a second.
- **The VM boots once,** when the host starts. A lane in a running VM
  starts in 74 ms (S123 item 1).
