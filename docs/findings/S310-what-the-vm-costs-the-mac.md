# S310 — The lane VM keeps every page its guest has touched until it stops; its RSS also counts the Mac's cache of its disks, and Virtualization's balloon returns nothing

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** On 2026-10-21 the lane VM's process held 21 GB of RSS for a
12 GiB guest. What does the VM cost the Mac's memory, and can a running VM
give back what its guest no longer uses, through a balloon device
(`VZVirtioTraditionalMemoryBalloonDeviceConfiguration`; the kernel has
`CONFIG_VIRTIO_BALLOON=m` and `CONFIG_PAGE_REPORTING=y`, and the image keeps
the module)?

**Kill criterion.** A balloon is worth adding if inflating it in a guest
that has touched its memory lowers the VM process's physical footprint on
the Mac.

**Throw away.** The spike VM. Kept in
`docs/findings/S310-what-the-vm-costs-the-mac/`: `no-balloon.txt` and
`balloon.txt`, the runs; `footprint-inflated.txt`, `footprint` and
`vmmap --summary` with the balloon inflated.

## Answers

Run on 2026-10-21 in the spike VM (8 GiB) with S308's patched launcher.
The VM process is `com.apple.Virtualization.VirtualMachine`, an XPC
service run as the user.

1. **A page the guest touches stays the Mac's until the VM stops.** After
   6000 MiB written to a tmpfs in the guest and deleted, the process's
   physical footprint stayed at 6.65 GB; the guest's `free` said 7.5 GiB
   free.
2. **RSS overstates it.** After 6 GiB read through the guest's page cache
   and dropped there, RSS was 13.3 GB against a footprint of 6.9 GB, for an
   8 GiB guest: RSS counts the disk images' pages the Mac caches (caching
   `cached`, `LAUNCHER_DISKS`). The footprint is what to report.
3. **The balloon inflates and returns nothing.** With a target of
   2048 MiB, the guest gave up 6.2 GiB (`free`: 6326 MiB used, 1429 free),
   and the footprint stayed at 6.78 GB, all of it dirty, none reclaimable
   (`footprint`: "app-specific tag 1", 6791 MB dirty). Deflated, the guest
   wrote 5000 MiB again with the footprint unchanged.

So the Mac's cost of the VM is its high-water mark up to its size
(`vmMemoryCeiling`), and only a stop gives it back: the launcher's idle stop
after 10 minutes without a lease does, and nothing else would.
