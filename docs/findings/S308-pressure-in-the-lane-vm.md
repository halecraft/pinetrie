# S308 — The lane VM's kernel has pressure stall information, off until `psi=1` is on its command line; with it, every lane's cgroup reports its own memory pressure and OOM kills

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** A health value for the machine (what the footer and a
Machine page would show) needs signals that say a lane is starved, not
just busy. On 2026-10-21 the lane VM had no `/proc/pressure`. Does the
pinned kernel (`linux-virt` 6.18.57) have PSI? What turns it on? And can
the host read each lane's own pressure and OOM count, as it would need
to name the thread that suffers?

**Kill criterion.** PSI not built into the kernel; or per-cgroup files
missing or unreadable for a lane's container under Docker's cgroupfs driver.

**Throw away.** The spike VM. Kept in
`docs/findings/S308-pressure-in-the-lane-vm/`, since S307, S309, S310 and
S314 ran on it too:
- `vm.sh`: starts a VM of its own from the lane VM's current image, in a
  state directory beside it, with 8 GiB, 8 CPUs (`CPUS` to change) and
  extra kernel arguments; its data disk must be made first, capped
  (`truncate -s 24G`), since a spike that writes without bound fills the
  Mac's disk;
- `spike-launcher.patch`: the launcher with three additions, all off unless
  asked: `SPIKE_CMDLINE_EXTRA` appended to the kernel's command line,
  `SPIKE_BALLOON` for a balloon device, and its target read each second from
  `balloon-target` in the state directory (a `Timer` never fires: the
  launcher runs on `dispatchMain`, so the patch uses a dispatch timer).

## Answers

Read from the kernel package's `boot/config-6.18.57-0-virt`, and run in
the spike VM on 2026-10-21.

1. **Built in, off by default:** `CONFIG_PSI=y`,
   `CONFIG_PSI_DEFAULT_DISABLED=y`. Booted with `psi=1` (the launcher's
   command line is `console=hvc0 quiet lane.slots=<n>` today), the VM has
   `/proc/pressure/{cpu,memory,io}`; without it, none (the lane VM on
   2026-10-21).
2. **Per lane:** Docker uses the cgroupfs driver on cgroup v2, so a lane's
   cgroup is `/sys/fs/cgroup/docker/<container id>/`, readable from the VM's
   root, with `memory.pressure`, `memory.events` (`oom`, `oom_kill`,
   `high`, `max`), `memory.stat` and `memory.max`. The container reads the
   same files at `/sys/fs/cgroup/` in its own namespace.
3. **The same signals exist on a Linux host** wherever its kernel has PSI
   on, which pine·trie does not set there. Every Linux host with cgroup v2
   has `memory.events` per container.

Also seen: Docker warns "Your kernel does not support swap limit
capabilities" at each `--memory`: a lane's limit holds its memory, and no
limit holds what it swaps (S309 swapped through zram).
