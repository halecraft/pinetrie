# S323 — lanehost's privileged role reaches every lane's cgroup once `/sys/fs/cgroup` is bound into it read-write, and its disks role reads them bound read-only; a frozen lane must be thawed before it is stopped

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** ADR-0210's ladder reads each lane's cgroup (`memory.current`,
`memory.events`, `memory.pressure`) and writes three of its files
(`memory.reclaim`, `memory.swap.max`, `cgroup.freeze`). S316–S318 did so
from a fully privileged container in the VM's namespaces, which no lanehost
role is: the privileged role holds `NET_ADMIN`, `NET_RAW` and `SYS_ADMIN`,
the host's network and the lanes directory read-only; the disks role,
Docker's default capabilities. Docker gives each container a cgroup
namespace of its own. So:

1. What must a role be given to read and write another container's
   cgroup, and which role should?
2. What can any container read with nothing given?
3. How does Docker treat a lane frozen behind its back?

**Kill criterion.** The ladder needs another way in (Docker's own API, a
role of its own) if neither role can be given the cgroup tree.

**Throw away.** The spike VM. Kept in
`docs/findings/S323-reaching-lanes-cgroups/`: `run.txt`, each grant's
reads and writes, and the stop and removal of a frozen lane.

## Answers

Run on 2026-10-21 in the spike VM (S308's harness), against a container
standing for a lane (`--memory 1g`), from containers holding each grant.
A lane's cgroup is `docker/<id>` under the tree with the cgroupfs driver,
the lane VM's; it is found by the container's id under the bound tree,
whatever the driver names it.

1. **The privileged role, with `/sys/fs/cgroup` bound read-write** (at
   `/host-cgroup`): every read, and every write: `memory.reclaim`,
   `memory.swap.max` set to 0, `cgroup.freeze` (`frozen 1`). The same
   grant with the host's cgroup namespace (`--cgroupns host`) instead
   mounts the tree read-only, and every write is refused.
   **The disks role, with the tree bound read-only:** every read, no
   write. So the disks role samples and the privileged role acts, as each
   role's grant is already split (`packages/lanehost/TECHNICAL.md`, Roles).
2. **Any container reads the machine's pressure** (`/proc/pressure/*`) and
   **btrfs's counters** (`/sys/fs/btrfs/*/allocation/`), with nothing given;
   no other container's cgroup.
3. **Docker does not know:** a lane frozen through `cgroup.freeze` is
   `running`, `paused=false`. `docker stop -t 5` of it took 5.1 s, its
   whole timeout, since a frozen task cannot take `SIGTERM`, and then
   killed it; `docker rm -f` took 107 ms. So a lane is thawed before it is
   stopped, or its stop costs the stop's timeout. Docker's own `pause`
   would be known to Docker, but freezes the container, not a lane's
   memory reclaim with it, and refuses `exec`, as a frozen cgroup does.
