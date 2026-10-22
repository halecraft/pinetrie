# S324 — Docker's `oom` event names every container killed for memory and outlives its removal; a poll of the events loses it behind 256 later events, a held stream filtered to `oom` does not

- **Status:** Answered

**Question.** A lanehost role or the observer killed at its container's
memory limit usually takes its container with it (the observer is removed
on exit; a role's server killed stops it), so its cgroup's `oom_kill` is
gone before a 5 s sample reads it. What record of the kill outlives the
container, and can the host read it each sample with one request?

1. Docker's events, polled with `since` and `until` and filtered to `oom`
   and `die` (`GET /events`, no stream): does an `oom` come for a kill of
   the container's main process, and for an exec'd child's while the main
   process lives (the suite's `lanehostOnce`)? On 2026-10-21 the lane VM's
   Docker logged `oom`, `oom`, `die`, `destroy` for the observer at 17:09,
   readable minutes after the container was gone: confirm on the spike VM
   and on a Linux Docker.
2. How many events Docker keeps, and whether a burst of `exec` events
   (three each) between two polls can push an `oom` out.
3. `State.OOMKilled` on a stopped role's container, before it is made
   again.
4. The parent cgroup's `memory.events` (`/sys/fs/cgroup/docker/`): does its
   `oom_kill` count its children's kills, and keep them after a child is
   removed?

**Kill criterion.** A record is usable if it names the container (or its
service) and outlives the container's removal for at least two sample
periods, under a burst of exec events as the suites make.

**Throw away.** The spike VM's containers. Kept in its folder of sources
(`S324-a-service-killed-for-memory/`), since the plan for a service's kill
builds on them:
- `probe.sh`, `probe.txt`: four shapes of kill (below), the events read
  once before and once after every container is removed, and the parent
  cgroup's count;
- `probe2.sh`, `probe2.txt`: `State.OOMKilled` across a `start`, and how
  many execs after an `oom` push it out of a poll;
- `probe3.sh`, `probe3.txt`: a held stream filtered to `oom` through 300
  execs.

## Answers

Run on 2026-10-22 in the spike VM (`docs/findings/S308-pressure-in-the-lane-vm/vm.sh`,
its `IMG` set to the lane VM's current image, `726a4c95f1acc89e`): `linux-virt` 6.18.58, Docker 29.5.2,
cgroupfs driver, cgroup v2. The hog is `tail /dev/zero` under `-m 32m`. Read
from Docker's source at `docker-v29.5.2`: `daemon/events/events.go`,
`daemon/monitor.go`, `daemon/container/state.go`.

1. **Every kill has an `oom` event, naming the container.** Four shapes,
   each its own container:
   - (a) the main process killed, `--rm`: `oom`, `die` (137), `destroy`;
   - (b) a child killed, the main process exiting 1 after it, `--rm` (the
     observer's shape: its server exits when its loader does): `oom`,
     `die` (1), `destroy`. The exit code alone does not say memory;
     the `oom` does;
   - (c) an exec'd child killed while the main process lives (the suite's
     `lanehostOnce`): `oom`, and the container runs on;
   - (d) the main process killed without `--rm`: `oom`, `die` (137).

   Each event's `Actor.Attributes` holds the container's name and every
   label, so a role is named by `pinetrie.lanehost` and its project's
   label, and the observer by its name, `pinetrie-observer-<version>`.
   Every event, read again after every container was removed, was still
   there. Docker emits `oom` from containerd's TaskOOM
   (`daemon/monitor.go`) in the daemon, whatever the cgroup driver, so a
   Linux host's Docker gives the same. No Linux host's Docker was run:
   this Mac has none but the VMs'.
2. **The daemon keeps the last 256 events, of every kind, and a filter does
   not widen that.** `eventsLimit = 256` (`daemon/events/events.go`); a
   request with `since` replays the buffer and filters it after. Measured:
   an `oom` followed by 84 execs (252 events) was still read; by 85, gone.
   A poll every 5 s loses a kill behind about 85 commands run in the lanes
   of every host on the same Docker (the lane VM serves every slot) in one
   period. A command a host runs in a lane is one `docker exec`
   (`packages/docker/runtime.ts`), so ordinary work is far below that, and
   a suite's bursts are not.

   **A held stream does not lose it.** `GET /events` with
   `filters={"event":["oom"]}` and no `until`, held open: through 300
   execs between two `oom`s, it read both. Docker's `SubscribeTopic`
   replays the buffer since `since`, then sends each new event that passes
   the filter, in the same response. So a host that holds one stream for
   its life, and on a reconnect asks again with `since` the last event's
   `timeNano`, misses a kill only behind 256 events while it was not
   connected. No clock of the host's enters: the next `since` is the
   daemon's own time. A subscriber that does not take an event within
   100 ms loses it (`pubsub.NewPublisher(100*time.Millisecond, …)`); a
   reader that drains the response as it comes does.
3. **`State.OOMKilled` fails.** It is set on any `oom` in the container,
   an exec'd child's included (c, while running); and `start` sets it
   false (`daemon/container/state.go`), measured: a role stopped with
   `OOMKilled=true` reads `false` once started. `ensureContainer` starts a
   stopped role with the same spec, so the record goes as the role comes
   back; and the observer, removed, has none.
4. **The parent cgroup counts every kill, keeps it, and names none.**
   `/sys/fs/cgroup/docker/memory.events` read `oom_kill 6` after the six
   kills of probe 1, and still after every container was removed;
   `memory.events.local` read 0. The count is hierarchical and charged at
   the kill, so a removal takes nothing from it. It cannot say which
   container, and it counts lanes' kills too. It is readable where the
   disks role is already given the tree (`HOST_CGROUP`). On a Linux host
   with the systemd driver, containers are under `system.slice`, which
   holds every service of the machine: not measured.

5. **Resuming a stream** (run again the same day, for the plan). `since`
   takes nanoseconds (`<seconds>.<9 digits>`), and a stream opened with
   it and no `until` replays from it, the event *at* `since` included, and
   then stays live: resumed at the first of two `oom`s' own `timeNano`, it
   read both and then a third made after. So a resume skips each event at
   or before the last one heard. Before any event, the stream's response
   carries no headers at all (Docker writes them with the first event),
   so its `Date` cannot say when it connected; the daemon's own time is
   `GET /info`'s `SystemTime`, in nanoseconds, which read within a second
   of the Mac's clock.

**The question's premise holds for the observer only.** Read from the code
after: a lanehost role's container only waits (`sleep infinity`), and the
host starts the server in it with `exec -i`, so a role's server killed is
an exec'd child's kill (shape c): its container and its cgroup's count stay.
The observer's server is its container's main process, removed with it.

**What this leaves for a service's kill.** A record that meets the kill
criterion is a held `/events` stream filtered to `oom`, read by the host
and told to its sensor as a kill heard, as the host's stalls are; the
sample then counts what was heard, not a cgroup's count. A poll each
sample meets it only below about 85 commands a period. The parent cgroup's
count is a backstop that names nothing. A lane killed whose main process
dies loses its cgroup's count the same way, and the same stream names it.
