# ADR-0129 — The machine lanes' disks are on is served by one program, lanehost: roles by grant, each a container, reached over held channels

- **Status:** Accepted (Duane, 2026-10-10)
- **Area:** `packages/docker/TECHNICAL.md`, `packages/lanes/TECHNICAL.md`
- **Evidence:** S146, S147, S148, S179
- **Amends:**
  - ADR-0130: the disks helper, its shell scripts and the firewall's throwaway
    container are replaced by lanehost's roles, each a container the host
    reaches over one held `docker exec -i`.
- **Revised:**
  - 2026-10-13 (S179): a diff's send stream is folded as it arrives, in time
    linear in the stream, never held: a `pnpm install`'s, held and folded by a
    scan per rename, ran for minutes on the privileged role's one thread and
    past its 256 MB, stalling every lane. A drop deletes the subvolumes inside
    a disk first, deepest first, each made writable: btrfs refuses a subvolume
    that holds others, and `rm -rf` stops at a read-only one.
- **Amended by:**
  - ADR-0202: lanehost knows a nested lane's disk, its owner and data root
    given as values when its server starts, and no runtime; one `disk` call
    takes core's `DiskOp`; it exports the disks' client.

**Context.** Everything the host did to lanes' disks outside a lane was
shell kept in TypeScript strings (`planDiskCommand`), sent one at a time by
`docker exec` to a container that only ran `sleep` (`pinetrie-disks`).
Beside it, a project's grant of the Mac's ports ran in a throwaway
`docker run --rm` with `NET_ADMIN`, and diffs between snapshots (`btrfs
send`) would need a container with `SYS_ADMIN`. No module owned this work,
no call had a typed result, and each paid for two processes:
- **S147:** a disk operation took 28.5 ms by the CLI's `docker exec`: about
  12 ms the CLI's own start, 13 ms runc's, and 3 ms the work. Over one held
  `docker exec -i` it took 3.3 ms; a message, 0.2 ms.
- **S146, S148:** `btrfs send` needs `CAP_SYS_ADMIN` in the host's user
  namespace, and works from a read-only mount of the lanes directory.
  Under rootless Docker (a nested lane) it cannot run.

**Decision.**
- **One package, `@pinetrie/lanehost`,** owns everything the host asks of
  the machine its lanes' disks are on, outside a lane: one protocol, one
  server, one client, and a module per responsibility (disks, projects;
  later grants and diffs). It knows nothing of lanes or Docker.
- **A role is one process of that server, holding one grant,** in a
  container of its own: `disks` (the lanes directory read-write, Docker's
  default capabilities, no network) and `privileged` (the lanes directory
  read-only, every capability dropped but `NET_ADMIN`, `NET_RAW` and
  `SYS_ADMIN`, the host's network). `ROLES` is the table; `planRoles`
  decides, from what the machine grants, which role serves each module.
  A new capability is a module and a row, never another kind of container.
- **The host holds one channel per role,** opened at its first call over
  the runtime's `docker exec -i`, as a lane's channel is
  (`@pinetrie/channel`). Only the holder of Docker's socket can open one:
  no socket listens.
- **Calls name projects by key and disks by name, never paths.** The server
  checks each name and builds every path itself (`layout.ts`).
- **A role's container runs the server from the host's own install and lane
  runtime,** mounted read-only as in a lane, so each host serves its own
  version. It is its project's, and on the Mac its slot's, and the sweeps
  take it with them.

**Consequences.**
- A disk operation costs about 3 ms instead of about 28 (S147); a snapshot
  in a nested lane measured 5 ms against about 30.
- Lanehost starts only once setup names the install and the runtime: a
  disk call before that is refused, naming why.
- The suites reach the disks through lanehost's one-shot command, the path
  the host takes, and read what a snapshot holds by shell in the `disks`
  role's container.

**Alternatives rejected.**
- **A container per command, or per privilege, each with its own image:**
  privilege would set the code's shape.
- **One role holding every grant:** code that reads names from files a lane
  controls would hold `NET_ADMIN` and the host's network.
- **A service listening on a socket:** it needs its own access control;
  `exec -i` has Docker's.
- **Kyneta's `Line`:** it delivers again after a reconnect, where a dead
  server must fail its calls, and has no request and response, abort or
  bytes.
