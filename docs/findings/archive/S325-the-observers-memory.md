# S325 — The observer starts at 225 MB of its 512 MiB, 177 MB of it the loader's maps; each connection adds 28 MB, and lanes whose host is gone hold 39 MB each at their bound, so 11 connections, or 7 or 8 such lanes, fill it

- **Status:** Answered

**Question.** The observer's container (`OBSERVER_GRANT`, 512 MiB) was
killed for memory on 2026-10-21 in the person's lane VM, and in the lanes
suite's `shared` scenario. What does its process hold as it grows: the
held notices of lanes whose host is gone (`HELD_PER_LANE`, 100,000 a
lane), the output rings, the loader's maps, or Node's heap? Does it grow
with a workload's file events, its runs, its lanes, or its hosts'
reconnects? Is it held or garbage (a forced collection's `heapUsed`, as
S191 sampled the host's)?

**Kill criterion.** The belief is that a bound the observer documents
(`planHeld`'s, `HELD_PER_LANE`) admits more than 512 MiB. It is wrong if
the growth follows no documented bound, which would name another cause;
the spike then says what it saw.

**Throw away.** The probe and its workloads; kept in its folder of
sources only if a plan builds on them.

**Seen on 2026-10-24, in the person's lane VM (S334).** Not this spike's
answer, which still needs the probe; what an incident read, to start
from:

- **Each connection is a process in the observer's cgroup.** A host's
  connection is a `docker exec` running `observer-connect.ts` there: a
  Node process of 22–66 MB (`VmRSS`, nearly all anonymous). A host
  inside a lane opens one for each of its connections, relayed by the
  host outside. Eleven of them, eight leaked (S337), with the server and
  `observe`, filled the 512 MiB: `anon` 325 MB.
- **The kernel's share is a cost it starts with.** At its limit the
  cgroup held `kernel` 187 MB (`slab` 2.5 MB of it); a fresh observer, a
  minute after its start, held 181 MB of `kernel` and 98 MB of `anon`.
  What the kernel memory is (the loader's maps, read with `bpftool map
  show`, is the first guess) is unmeasured.
- **At its limit it thrashed for an hour before it was killed.** With
  `file` at 23 MB its code was read again without end
  (`workingset_refault_file` 2.0 billion, `pgmajfault` 4.6 million),
  its own `memory.pressure` `full avg10` 21–35%, until the kernel killed
  it for memory.

So the question widens: what each connection costs, whether relayed
connections need a process each, and what a limit should be when about
180 MB of it is spent before the first lane registers.

## Answers

Run on 2026-10-24 in the spike VM (8 GiB, 8 CPUs, kernel 6.18.58), the
observer's image built from this repo by the runtime's own build
(`observer.Containerfile`, with Node 24 copied out of `node:24-trixie-slim`
as the lane runtime is), its container made as the runtime renders it
(`renderObserver` and `createBody` in `packages/docker`: the machine's
pids, a read-only root, no network, 512 MiB, three capabilities), each
connection a `docker exec -i` of `observer-connect.ts` from the Mac, as
`openObserver` opens one. Stand-in lanes were Alpine containers, each
registered by its first pid; a run was a `docker exec` with
`PINETRIE_RUN` set, writing one small file over and over (1,000 writes
made 4,002 notices). Read: the container's `memory.stat` and each of its
processes' RSS, `bpftool map show`, and the server's heap through its
inspector after a forced collection.

| the observer's cgroup | `anon` | `kernel` | `memory.current` |
|---|---|---|---|
| 3 s after its start, no connection | 44 MB | 179 MB | 224 MB |
| one connection (a host's), no lane | 73 MB | 179 MB | 252 MB |
| four connections | 156 MB | 182 MB | 339 MB |
| eight connections | 266 MB | 185 MB | 452 MB |
| one connection, eight lanes registered | 104 MB | 180 MB | 286 MB |
| eight lanes, their host gone, 100,000 notices held in each of six | 313 MB | 185 MB | 499 MB |

1. **The kernel's share is the loader's maps, all made at its start.**
   `bpftool map show` sums to 176.7 MB against the cgroup's 179 MB of
   `kernel`: the two rings, 84.2 MB (`events` 64 MiB, `output_events`
   16 MiB, `vmalloc` in `memory.stat`), and the hash maps, 92.4 MB, which
   the kernel preallocates whole at their `max_entries` (`tags` and
   `wfiles` at 262,144 entries, 27.3 and 25.2 MB; `writing` 6.3 MB; five
   of 65,536 at 5.8 MB each). It does not grow with lanes or events
   (179 to 185 MB over every run here). The loader's own `RssFile`
   (165 MB) is the rings mapped into it, not charged again; its anonymous
   memory is 0.2 MB, 4.4 MB with eight lanes.
2. **Each connection is 28 MB.** Every `observer-connect.ts` is a Node
   process of 26–28 MB anonymous (`RssAnon`) idle, 42 MB after it had
   carried 804,000 notices; from one to four connections, and four to
   eight, `anon` rose 27.5–27.9 MB a connection and `memory.current`
   28.3–28.9 MB. Closing them gave it back (452 to 254 MB). Eleven
   connections fill the 512 MiB, as on 2026-10-24 (S334). A relayed
   connection is one too, by design read from source: the host outside
   opens a channel of its own for each connection the lane's helper
   relays (`relayObserver` in `packages/pi/observer.ts`, through the lane
   observation's `relay` in `packages/lanehost/observer-client.ts`, which
   opens it with the client's `open`, `openObserver` on the host
   outside), since the role owns a lane by the connection that registered
   it.
3. **The server itself is 42–45 MB anonymous, its heap 6–7 MB after a
   collection,** with no lane or with eight, and after 804,000 notices
   flowed to a subscribed host (16.6 MB used before the collection, 6.1
   after: what passes through is garbage).
4. **Held notices are held, and their bound admits more than the
   limit.** With the lanes' host gone, each held notice cost about 390
   bytes of the server's memory (its `RssAnon` 42 to 275 MB for six lanes
   at 100,000, `HELD_PER_LANE`), and a forced collection freed little
   (heap used 78 to 68 MB at 172,000 held). Six lanes at their bound took
   the cgroup to 499 MB of 537. Node sizes V8's heap from the cgroup's
   limit: 271.6 MB here, so the server dies of its own heap before the
   kernel's limit is met. Filling lanes 7 and 8, it aborted with "JavaScript
   heap out of memory" (exit 134) at 254 MB of heap; it did so the first
   time too, with eight lanes filling at once. Its lanes, their
   registrations and every held notice went with it, and every connected
   host's channel.
5. **So it grows with connections, and with notices only while a host is
   gone,** not with lanes registered (30 MB for eight, most of it the
   registering connection's own process, the loader's share 4 MB) nor
   with runs while their host reads them. Hosts' reconnects cost a
   connection each while open; one that never closes (S337) is 28 MB for
   good.

**The kill criterion.** The belief holds: `HELD_PER_LANE` admits about
39 MB a lane, so seven or eight lanes whose host is gone fill the
server's heap, before the cgroup's limit, which six take to 499 MB. But the growth seen on 2026-10-24 was the other
cause, connections, which no documented bound limits: 225 MB of the
limit is spent before the first, then 28 MB each.

**What a limit should be.** Fixed: 179 MB of maps, 44 MB of server, about
20 MB for the code to live in (S334 thrashed at 23 MB of `file`; here
`file` read 0 to 8 KB, since the image's pages were charged to the build
that wrote them). Then 28 MB a connection, up to 42 MB with traffic, and
39 MB a lane held at its bound. A limit is a choice among: fewer bytes a
connection (relayed connections multiplexed over one, or a lighter
process than Node), smaller preallocated maps, a bound on held notices
counted over all lanes rather than per lane, and a heap limit given
explicitly. None is measured here.

**Not measured.** The output rings' cost to a host (`subscribe-output` was
open, no output was attributed); the inner host's own side of a relay
(each relayed connection here is a direct one from the Mac, which is what
the observer sees); growth over hours.

**Kept** in `docs/findings/archive/S325-the-observers-memory/`:
- `start.sh`: the container as the runtime renders it; `env.sh` and
  `read.sh`: its cgroup and processes, read from the VM's root;
- `probe.ts`: connections opened as a host's, subscribed, the first
  registering stand-in lanes, held or left;
- `heap.mjs`: the server's heap and V8's limit after a forced collection,
  through its inspector, run inside the container;
- `out/`: every reading in order, `02-bpftool.txt` the maps, and
  `observer-log.txt` the server's abort.
