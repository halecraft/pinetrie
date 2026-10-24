# S340 — On the lane VM, Docker sets `memory.low`, `pids.max`, `cpu.weight`, `io.max` and `oom_score_adj`, and each acts (`memory.low` only under a parent with its own); `memory.high` has no field; a nested lane's rootless Docker drops them all without a word

- **Status:** Answered
- **Led to:** ADR-0210, ADR-0212

**Why.** pine·trie keeps the machine healthy with code of its own: a gate
that holds lanes on memory pressure (ADR-0212), and a hard memory limit
per container, the only cgroup control it sets (`HostConfig.Memory`,
`packages/docker/api.ts`). On 2026-10-24 the observer thrashed at its own
limit for an hour while lanes ran beside it, and the gate read its stall
as the machine's (S334). S335 showed the gate can tell the two apart by
the machine's own reclaim; S325 showed what fills the observer. The
industry's answer to the rest is the kernel's: contain each workload,
protect the control plane, and warn per cgroup before its hard limit
(cgroup v2's `memory.low`/`min`, `memory.high`, `pids.max`, `cpu.weight`,
`io.weight`, and the OOM killer's `oom_score_adj`), set through Docker's
API, which pine·trie already drives. Before a plan rests on them, each
must be known to be settable and effective on every backend pine·trie
runs lanes on: the Mac's lane VM (rootful Docker), a Linux Docker host,
and a nested lane (rootless Docker inside a lane).

**Question.**

1. For each control, through Docker's create API (`HostConfig`), on each
   backend: is it accepted, and what does the container's cgroup read
   back?
   - `MemoryReservation` → `memory.low`? (or `memory.min`?)
   - `memory.high`: is there any `HostConfig` field that sets it (a
     unified-resources map, an annotation), and if not, can a process with
     the cgroup tree (lanehost's privileged role reads it, S323) write it
     after the start, and does a restart of the container keep it?
   - `PidsLimit` → `pids.max`.
   - `CpuShares` (or `CpuWeight`) → `cpu.weight`.
   - `BlkioWeight` → `io.weight`, and is the IO scheduler on the data disk
     one where it acts (BFQ, or `io.cost` enabled)? If not, does
     `io.max` (`BlkioDeviceReadBps`/`WriteBps`) apply?
   - `OomScoreAdj` → `/proc/<pid>/oom_score_adj` of the container's
     processes.
   - `CgroupParent`: can the services (lanehost's roles, the observer) be
     put under a cgroup of their own, apart from the lanes, and can that
     parent carry `memory.low` and `memory.high` of its own?
2. Do they act as the kernel documents, measured with a load:
   - a container over its `memory.high` is throttled and its
     `memory.events` `high` rises, before `max`;
   - a protected cgroup (`memory.low` on the services' parent) keeps its
     pages while S309's lanes press the machine, where an unprotected one
     loses them (its refaults, its own stall);
   - a container at its `pids.max` cannot fork, and nothing else is
     touched;
   - with the machine's CPUs busy, `cpu.weight` divides them as set;
   - the OOM killer, at the machine's limit, picks a lane before a
     service with a lower `oom_score_adj`.
3. In a nested lane (rootless Docker in a lane): which controllers are
   delegated to the inner Docker (`cgroup.controllers` of its cgroup), and
   which of the above it refuses or ignores silently?
4. On a stock Linux host with systemd (Ubuntu 24.04 if one is at hand,
   else read from systemd's and Ubuntu's sources and defaults): does
   `systemd-oomd` run by default, which slices does it manage, and would
   it act on rootless Docker's containers (under `user@.service`), and so
   on a nested lane's?

**Kill criterion.** A control that is not settable, or does not act, on a
backend is left out of the plan for that backend, and the spike says how
the runtime reads back what took effect so the health can say what is
missing. If `memory.low` on a services parent does not protect the
services under load, the plan keeps the gate as their only guard and the
spike says so.

**Throw away.** The spike VM (`sandbox/machine-spikes/vm.sh`, its own
state directory and capped data disk, never the person's lane VM) and the
probe containers. Kept in this spike's folder of sources if the plan
builds on them: each backend's read-back, the loads, and their readings.

## Answers

Run on 2026-10-24 in the spike VM (8 GiB, 8 CPUs, `psi=1`, kernel
6.18.58, Docker 29.5.2 with the cgroupfs driver, the lane VM's image),
each control through `docker run`'s flag (which fills `HostConfig` as
pine·trie's `createBody` does), read back from the container's cgroup in
the VM's root and from `/proc`. The memory loads ran on fresh boots; the
others one after another. The nested lane is a container made as
`renderRun` makes one with `nested` (the nested seccomp profile,
`systempaths=unconfined`, `/dev/net/tun`, a btrfs subvolume owned by uid
1000 at `/var/lib/pinetrie-lanes`, `DOCKER_HOST`, `--init`, `--memory 4g`),
from an image of the lane image's rootless Docker part, copied verbatim
(Docker 29.8.2 inside), started by its own `pinetrie-inner-docker`. The
Linux host was not run: question 4 and that backend's column are read
from source (below).

### The lane VM (rootful Docker, cgroupfs)

| control | accepted | read back | acts |
|---|---|---|---|
| `--memory-reservation` (`MemoryReservation`) | yes | `memory.low` (256m: 268435456); `memory.min` stays 0, and no field sets it | **only under a parent that has `memory.low` too** (2 below). Under `docker/`, whose `memory.low` is 0, it protects nothing |
| `memory.high` | **no field**: no flag; a `HostConfig.Unified` is ignored without a word; `--annotation memory.high=…` reaches runc, which ignores it | written into the cgroup from the VM's root, or by the privileged role's grant (S323's bind), it reads back; **`docker restart`, or a stop and start, resets it to `max`**; `docker update` keeps it | yes (2 below) |
| `--pids-limit` (`PidsLimit`) | yes | `pids.max` | yes |
| `--cpu-shares` (`CpuShares`; no `CpuWeight` field) | yes | `cpu.weight` by runc's conversion: 2 → 1, 256 → 35, 512 → 59, 1024 → 100, 4096 → 303, 262144 → 10000 | yes, as the weights divide |
| `--blkio-weight` (`BlkioWeight`) | yes | `io.bfq.weight` `default 300`; there is no `io.weight` (this kernel has no `io.cost`) | **no** under the data disk's scheduler, `mq-deadline`; weakly once the disk is switched to BFQ |
| `--device-write-bps /dev/vdb:20mb` (`BlkioDeviceWriteBps`) | yes | `io.max` `253:16 … wbps=20971520` | yes |
| `--oom-score-adj` (`OomScoreAdj`) | yes, -1000 to 1000, negative too | `/proc/<pid>/oom_score_adj` of every process in it, `docker exec`'d ones too | yes |
| `--cgroup-parent /pinetrie-services` (`CgroupParent`) | yes | the container at `/sys/fs/cgroup/pinetrie-services/<id>`. Docker makes the parent with every controller and leaves it when the last container goes; the VM's boot clears it | the parent's own `memory.low` and `memory.high`, written from the root, read back and survive the container's restart and removal; its `cpu.weight` divides CPU against `docker/` |

The privileged role's grant (every capability dropped, `NET_ADMIN`,
`NET_RAW`, `SYS_ADMIN` added, the tree bound read-write) wrote a lane's
`memory.high`, `memory.min`, `memory.low`, `cpu.weight` and `pids.max`.
It cannot make a cgroup at the tree's root, which is `dr-xr-xr-x`
(`mkdir`: permission denied, with its own cgroup namespace or the
host's); `CAP_DAC_OVERRIDE` can. So the services' parent is Docker's to
make (`CgroupParent`), and the role's to write. The role cannot lower its
own `oom_score_adj` (it lacks `CAP_SYS_RESOURCE`), but Docker sets each
container's at its creation.

### A nested lane (rootless Docker inside a lane)

| control | accepted | read back | acts |
|---|---|---|---|
| `--memory 1g` | yes, without a word | nothing: every inner container is in the lane's own cgroup (`0::/` inside it; `/docker/<lane>` in the VM, `memory.max` the lane's 4 GiB) | no: 400 MiB held in a `--memory 256m` inner container for 20 s, the lane's `memory.events` all 0 |
| `--memory-reservation 256m` | yes, without a word | nothing (`memory.low` 0) | no |
| `memory.high` | no field, as above; and nothing in the lane can write a cgroup file | (none) | (none) |
| `--pids-limit 32` | yes, without a word | nothing (`pids.max` `max`) | no: 100 sleeps ran in it |
| `--cpu-shares 512` | yes, without a word | nothing (`cpu.weight` 100) | no |
| `--blkio-weight 300` | yes, without a word | nothing | no |
| `--device-write-bps` | refused: the lane has no block device to name | (none) | (none) |
| `--oom-score-adj 500` | yes | 500 on the inner process: a process's value, not the cgroup's | yes, toward its being killed first |
| `--oom-score-adj -500` | yes, but raised to the lane's own (0), which `docker inspect` then shows | 0 | no |
| `--cgroup-parent /pinetrie-services` | yes, without a word | nothing: in the lane's cgroup | no |

`docker inspect` shows every value as asked (`Memory=1073741824`,
`PidsLimit=32`, `CpuShares=512`), where nothing took. The inner Docker's
own word is `docker info`: `CgroupDriver` `none`, and its one warning,
"Running in rootless-mode without cgroups. Systemd is required to enable
cgroups in rootless-mode." Moby's source says why: a rootless daemon
without systemd uses the `none` driver, and `toRootless` deletes the
whole of the container's resources from its runtime spec, and raises an
`oom_score_adj` below the daemon's own to the daemon's
(`out/read-sources.txt`).

### A Linux host with systemd (read, not run)

Docker 29 on cgroup v2 with systemd running uses the systemd driver by
default (`UsingSystemd`, moby `daemon/daemon_unix.go`), and refuses a
`CgroupParent` not named `<name>.slice`. runc's systemd driver
(`opencontainers/cgroups`, `systemd/v2.go`) turns `Memory` into
`MemoryMax`, `MemoryReservation` into `MemoryLow`, the CPU weight into
`CPUWeight`, `PidsLimit` into `TasksMax`, and writes the IO controls
itself (`io.bfq.weight` if the file exists, else `io.weight`, which acts
only where `io.cost` is enabled). systemd mounts the tree with
`memory_recursiveprot` (v255, `mount-setup.c`), so a slice's
`MemoryLow=` reaches the units under it. Under rootless Docker there,
only the controllers delegated to the user's `user@.service` are kept:
Ubuntu 24.04's (systemd 255.4) delegates `pids memory cpu`, so
`BlkioWeight` and `io.max` are dropped without a word, and an
`oom_score_adj` cannot go below the user manager's `OOMScoreAdjust=100`.
None of this was measured.

### The answers

1. **Accepted and read back:** the tables. On the lane VM every control
   is accepted and lands where runc's conversion puts it, except
   `memory.high`, which no `HostConfig` field sets: a process with the
   tree (the privileged role) writes it after the start, and must again
   after each start, since a restart of the container resets it.
   `MemoryReservation` is `memory.low`; nothing sets `memory.min` but a
   write. `CgroupParent` puts the services under a parent of their own,
   which carries its own `memory.low`, `memory.high` and `cpu.weight`.
2. **Do they act, under load** (`out/`):
   - **`memory.high` throttles before `max`.** Four containers of
     `--memory 1g` for 90 s, two with `memory.high` 256M. Reading 512 MiB
     of files over and over: `memory.current` held at 255–256 MiB,
     `memory.events` `high` rose 466,623 and `max` 0, and it made 940
     passes against its twin's 20,673. Keeping 400 MiB anonymous hot
     (no swap): it **stayed above `memory.high`** at 405–455 MiB, since
     nothing could be reclaimed, and was throttled instead, its own
     `full avg10` at a median of 77%, doing 28% of its twin's work
     (4.5 M bogo ops against 16.1 M), `high` +698, `max` 0, and never
     killed. So `memory.high` over memory that cannot be reclaimed is a
     stall without end, not a limit. The root read that stall too
     (`full avg10` median 16%) with no global reclaim (`allocstall_*`,
     `pgscan_direct` 0), as S335 found for a cgroup at its `max`.
   - **`memory.low` on the services' parent keeps the services' pages
     while the machine has other pages to give, and not when the lanes'
     anonymous memory alone fills it.** Four stand-in services (100 MiB
     anonymous and 400 MiB of files read over and over, `--memory 1g`),
     warmed 40 s, then S309's four lanes (12 GiB wanted of 8) for 240 s.
     The samples split by the VM's `MemAvailable`: about 1.1 GiB in 35
     of 46 ("room"), about 350 MiB in 11, when the lanes' anonymous
     memory peaked ("full"). Medians per 5 s sample:

     | service | room: `memory.current` | room: file refaults | full: `memory.current` | full: file refaults |
     |---|---|---|---|---|
     | parent `memory.low` 2G, own `--memory-reservation 800m` | 491 MiB | 0 | 229 MiB | 2.11 M |
     | the same parent, no reservation of its own | 269 MiB | 2.01 M | 152 MiB | 2.07 M |
     | under `docker/`, `--memory-reservation 800m` | 175 MiB | 1.58 M | 140 MiB | 1.29 M |
     | under `docker/`, nothing | 187 MiB | 1.58 M | 133 MiB | 1.30 M |
     | the same, the tree remounted `memory_recursiveprot`: parent and reservation | 492 MiB | 25 k | 228 MiB | 1.93 M |
     | `memory_recursiveprot`: parent, no reservation | 490 MiB | 76 k | 223 MiB | 1.87 M |
     | `memory_recursiveprot`: `docker/`, reservation | 159 MiB | 1.66 M | 136 MiB | 1.21 M |
     | `memory_recursiveprot`: `docker/`, nothing | 167 MiB | 1.67 M | 140 MiB | 1.23 M |

     Over each whole run (the warm-up and the 20 s after included), the
     services under the protected parent made 25,568–27,471 passes over
     their files against 17,894–18,288 under `docker/`, and 36.6–37.3 M
     bogo ops against 29.5–30.0 M; the lanes' own work was alike in both
     runs (202–210 passes, 16.8 M bogo ops each). A
     protection takes only through every ancestor: `docker/`'s
     `memory.low` of 0 voids a reservation under it, and without
     `memory_recursiveprot` (which this VM's init does not mount, and
     systemd does) a container under a protected parent needs its own.
     The remount takes only from the VM's own cgroup namespace
     (`--cgroupns host`); from a container's own it returns success and
     changes nothing. When the lanes' anonymous memory alone filled the
     VM, the kernel reclaimed the protected services as it did the
     others, and counted it in their `memory.events` `low` (386,000–
     408,000 a sample, against 9,000–35,000 with room): the protection
     is best effort, as documented. No service's own stall was large in
     any arm (median `full avg10` at most 1.9% in either phase); the
     cost was its refaults.
   - **`pids.max` refuses a fork and nothing else.** At `--pids-limit 32`,
     with 32 tasks in it the next fork failed ("can't fork"),
     `pids.events` `max 1`, and a `docker exec` into it was refused; a container beside it started
     100, and new containers started.
   - **`cpu.weight` divides busy CPUs as set.** Eight busy loops in each
     of two containers, 30 s: weights 100 and 35 took 180.5 and 62.5
     CPU-seconds, 2.89 to 1 (the weights 2.86). A services parent at
     `cpu.weight` 400 with one busy container took 80% against four busy
     lanes under `docker/` at 100 (the weights 80%). A weight counts
     against its siblings only: a lane's against the other lanes, the
     services' parent's against `docker/` as a whole.
   - **IO:** two containers writing 512 MiB files `O_DIRECT` to a volume
     on the data disk, weights 100 and 1000, 20 s: 544 and 541 MB/s under
     `mq-deadline`; with the disk switched to BFQ, 587 and 805 MB/s, 1.37
     to 1 for weights of 10 to 1. `io.max` at 20 MB/s held a writer to
     21.5 MB/s.
   - **`oom_score_adj` chooses the machine's victim.** A stand-in service
     holding 3500 MiB, a lane 1500 MiB, then a second lane growing to
     3500 MiB, each `--memory 4g`, past the VM's memory: with the
     service at 0, the kernel killed the service (the largest;
     `CONSTRAINT_NONE`, `global_oom`); at -500, the growing lane
     (2.6 GiB), and the service lived. Docker marked each victim
     `OOMKilled` true, as it does for a container at its own limit: the
     kernel's log says which (`CONSTRAINT_NONE` against
     `CONSTRAINT_MEMCG`).
3. **In a nested lane, nothing is delegated.** The lane's cgroup lists
   every controller in `cgroup.controllers` (`cpuset cpu io memory
   hugetlb pids dmem`), but `cgroup.subtree_control` is empty, the tree
   is mounted read-only in the lane, its files are owned by the VM's
   root, and root in the lane can neither write `memory.high` nor make a
   child. The inner Docker runs with the `none` driver: it accepts
   `MemoryReservation`, `Memory`, `PidsLimit`, `CpuShares`,
   `BlkioWeight` and `CgroupParent` and ignores them all without a word
   per container; it refuses only a device it cannot name; it applies a
   positive `oom_score_adj` and raises a negative one to the lane's own.
   Every inner lane is in the nested lane's one cgroup, so only the
   nested lane's limits hold them, together.
4. **systemd-oomd on Ubuntu 24.04** (systemd 255.4-1ubuntu8.17, read):
   - It runs by default **on a desktop install only**: Ubuntu's
     `desktop-minimal` seed names `systemd-oomd`, and its `server`,
     `minimal`, `standard` and `cloud-image` seeds do not; the package
     enables its service.
   - It manages **`user@.service` alone**: Ubuntu's defaults set
     `ManagedOOMMemoryPressure=kill` with a 50% limit on it, held for
     `DefaultMemoryPressureDurationSec=20s`, and leave `-.slice` at
     `ManagedOOMSwap=auto`, which acts on nothing.
   - **It would act on rootless Docker's containers there.** They are
     leaf scopes under `user@<uid>.service`, the candidates it chooses
     among. When that unit's own `full avg10` stays over 50% for 20 s
     with reclaim in it, it kills whole the descendant with the highest
     reclaim (`pgscan`) rate: a lane, the observer or lanehost alike, or
     the person's own applications.
   - A nested lane is one such leaf only where the outer Docker is
     rootless; there it is killed whole, its inner lanes with it. Under
     a rootful outer Docker its cgroup is under `system.slice`, where
     these defaults do nothing.

### The kill criterion, for each control

| control | lane VM | nested lane | Linux host |
|---|---|---|---|
| `memory.low` (`MemoryReservation` + `CgroupParent`) | in: under a services parent whose `memory.low` the privileged role writes after Docker makes it (again after each boot), each service with its own reservation, or the tree mounted `memory_recursiveprot` | out | unmeasured (systemd's `MemoryLow`, `memory_recursiveprot` on) |
| `memory.high` | not through Docker. Settable only by the privileged role, again after every start of the container; where it holds memory that cannot be reclaimed it stalls without end | out | unmeasured; no field either |
| `pids.max` (`PidsLimit`) | in | out | unmeasured (`TasksMax`; delegated to rootless) |
| `cpu.weight` (`CpuShares`) | in | out | unmeasured (`CPUWeight`; delegated to rootless) |
| `io.weight` (`BlkioWeight`) | out: no `io.cost`, and the disk's scheduler is `mq-deadline`; BFQ gave 1.37 for 10 | out | unmeasured; dropped under rootless |
| `io.max` (`BlkioDevice*Bps`) | in, naming the data disk (`/dev/vdb`) | out: no device | unmeasured; dropped under rootless |
| `oom_score_adj` (`OomScoreAdj`) | in | only upward from the lane's own | unmeasured; under rootless not below 100 |
| `CgroupParent` | in (cgroupfs: a path) | out | unmeasured (systemd: `<name>.slice`) |

**Reading back what took effect.** `docker inspect` is no proof: in a
nested lane it shows every value asked for while none applies. The
runtime reads the container's own cgroup: `memory.low`, `memory.high`,
`pids.max`, `cpu.weight` and `io.max` under the disks role's read-only
tree (`/host-cgroup/<parent>/<id>/`, where S323's grant reads them), and
a process's `/proc/<pid>/oom_score_adj`. Where the disks role has no tree
(rootless Docker, `cgroupMount`), `docker info`'s `CgroupDriver` of
`none` already says that no control takes. `memory.events` `low` counts
the protection breached, and `high` the throttle, so the health can say
which held.

**The services' guard under the worst load.** `memory.low` on a services
parent kept their pages against the lanes' page cache, but not when the
lanes' anonymous memory alone filled the VM (11 of 46 samples, the
reclaim S335's rule calls the machine's). There the gate, which holds
lanes, stays the services' only guard; `memory.low` is in the plan as a
guard for their page cache, not in the gate's place.

**Not measured.** A Linux host (none at hand): question 4 and that
backend are read. `systemd-oomd` itself. `memory.min`, which only a
write sets. `memory.high` over a working set of the observer's shape, or
for longer than 90 s. BFQ beyond one 20 s write on this virtual disk, and
reads. The real observer and lanehost as the services (stand-ins of the
same size here). A long-running VM whose page cache is full. Only this
kernel and Docker 29.5.2 outside, 29.8.2 inside.

**Kept** in `docs/findings/S340-cgroup-controls-through-docker/`, run
from `sandbox/machine-spikes/s-cgroups/` beside S308's `vm.sh`:
- `env.sh`: the spike VM's Docker, a shell in the VM's root and a
  read-back of one container's cgroup; `sample.sh`: the 5 s reader
  (S335's, with every `pinetrie-*` parent, `memory.low`, `memory.high`,
  pids and CPU); `summary.mjs` and `phases.mjs`: the summaries;
- `q1-rootful.sh` and `q1-role.sh`: question 1 on the lane VM, and by
  the privileged role's grant (`out/q1-rootful.txt`, `out/q1-role.txt`);
- `q2-high.sh`, `q2-pids-cpu-io.sh`, `q2-protect.sh` (`RECURSIVE=1` for
  the remounted run), `q2-oom.sh`: question 2's loads, using S309's
  `spike-load` image and a Node image for the OOM run; their samples,
  results and summaries in `out/q2-*`;
- `q3-nested.sh` with `nested/`: the nested lane and its inner Docker's
  read-back (`out/q3-nested.txt`);
- `out/read-sources.txt`: what was read for the Linux host and question
  4: Docker API v1.54's resource fields, moby's driver choice and
  `toRootless`, Ubuntu's `systemd-oomd` defaults and seeds, systemd's
  candidate rules.
