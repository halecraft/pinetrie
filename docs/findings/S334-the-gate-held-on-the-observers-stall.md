# S334 — On 2026-10-24 leaked relay connections filled the observer, the gate read its stall as the machine's and held lanes, a get-the-latest waiting at the gate deadlocked it there for an hour, and every command waited behind it

- **Status:** Answered (from the incident; each cause still unexplained is a
  spike of its own: S335, S336, S337, S338, S339, S325)
- **Led to:** ADR-0212

**Question.** On 2026-10-24, from about 12:00 (MDT; the measurements' times
are UTC, six hours ahead) the person's lane VM felt slow, and two commands
to foggy-garnet's lane, a get-the-latest and a message to its agent, seemed
lost: the get-the-latest showed no caught-up line, and the message never
appeared in the thread, then or after a resend. One lane, limber-glade, was
running `pnpm run verify:all`. The Machine page said memory was short, two
threads waited for room, and the observer held 512 MB of 512 MB. What
happened, and why did the commands vanish?

**Kill criterion.** None: an incident's account. What it cannot explain is
asked by the spikes it names.

**Throw away.** Nothing was run but reads: the host's store, copied and
since deleted; `cat` and `ps` in the containers through Docker; `ps` and
`lsof` on the Mac. Only two things were changed, to recover: the suite in
limber-glade was stopped, then the host restarted.

## Answers

Read from the measurements the host keeps (`pinetrie_machine_*` in the
session's store), the cgroups of each container (`memory.pressure`,
`memory.events`, `memory.stat`, `cgroup.procs`), Docker's events, and the
processes on both sides, while the incident lasted.

1. **Relayed observer connections outlived the hosts that opened them.**
   `verify:all` runs `e2e:lanes`, whose scenarios start hosts inside
   limber-glade; each such host's observer connection is relayed by the
   host outside (`relayObserver`, `packages/pi/observer.ts`;
   `packages/lanehost/TECHNICAL.md`, "A host inside a lane"). Each relayed connection is its own
   `docker exec -i` on the Mac, running `observer-connect.ts` in the
   observer's container: a Node process of 22–66 MB there. Eight opened
   within 100 s at about 11:58, as `e2e:lanes` began, and stayed for over an hour while the suite
   went on. When the suite's process was killed (12:59), its eight inner
   clients exited, and the eight outer processes, and their `docker exec`
   on the Mac (children of the host), did not; `e2e:browser`, the next
   step, added three more. The observer server disconnects on a client's
   `end` and the client exits on its socket's close, so the outer host
   never ended those channels: the close is lost between the lane's helper
   and the host outside (S337). The eight stayed through the suite because
   a host's close never closes its observer connection, and `e2e:lanes`
   closes many hosts in one process (S337).
2. **The observer thrashed at its limit, unkilled for an hour.** Its cgroup
   held `anon` 325 MB, `kernel` 187 MB, `file` 23 MB: its code had about
   20 MB to live in, so its pages were read again without end
   (`workingset_refault_file` 2.0 billion, `pgmajfault` 4.6 million,
   `memory.events` `max` 41 million). Its own `memory.pressure` read
   `full avg10` 21–23%, rising to 35% as the suite's next step added
   connections, until it was killed for memory at 13:02:31 and made again
   at 13:02:44. The host's own connection to it was seen in state `D`. A
   fresh observer, a minute after its start, held 181 MB of `kernel` and
   98 MB of `anon`: the kernel memory is a cost it starts with (S325).
3. **The gate read the observer's stall as the machine's.** The rung reads
   the VM's `/proc/pressure/memory`, which counts a stall in any cgroup,
   one pressed against its own limit included; a rung is entered when any
   of its bounds is over (`rungReading`, `packages/machine/rung.ts`). From
   12:01 `full avg10` read 15–20% while 9.8 of 12.5 GB were available, and
   the machine went to rung 3, "only the threads that matter most make
   tool calls". limber-glade, the one lane running, at 3.5 of its 4 GiB
   (2.1 GiB page cache), read 0.00 in its own `memory.pressure`. The VM's
   file refaults rose from 0 to 5–6 million pages a sample with the
   observer's. Holding lanes could not relieve a stall inside one service's
   cgroup. Whether another reading separates the two is S335.
4. **The gate deadlocked at rung 3 for an hour.** The last sample the
   host completed was at 12:17:44, the one that held steady-feather; from
   then the Machine page served that reading as current (the observer's
   512 MB, 16.5% pressure) and recorded nothing, not the observer's OOM.
   fleet-creek (held 12:16:39) and steady-feather (12:17:44) waited until
   the host was restarted. No call hung: the sample awaited the health's
   write, a step of the documents' keeper, held by a get-the-latest that
   waited at the gate for its lane's start, which only a later sample
   could allow (S338, reproduced with the real manager). The health written
   to the document never gained steady-feather, so the host's log said "1
   thread waits for room" while the page said 2. Every other await a
   sample makes is unbounded too (`request`, `packages/docker/api.ts`;
   `call`, `packages/channel/client.ts`), and could freeze it the same way
   (S336).
5. **A person's sends to foggy-garnet waited behind that step, and were
   lost at the restart.** Every command waits for the documents' keeper,
   which the deadlock held, so the sends never reached foggy-garnet's lane
   and no decision names it (S338). The resend showed "sending…" until the
   host's restart, the composer waiting on the send's outcome with no bound
   (`card-editor.tsx`, `packages/web`); after it, neither message was in
   the thread or the composer.
6. **Stop did not stop the suite.** limber-glade's agent ran `( nohup pnpm
   run verify:all > log; echo EXIT … ) &` in one tool call, then polled
   its log in others. The suite ran in that first call's process group,
   under the container's init; each Stop killed the poll in flight, the
   agent polled again, and `verify` went on to its next step. Whether Stop
   can end every process a run started, by the observer's tag of the run,
   is S339.
7. **The host's log has no times.** Its lines (`[host] the machine: …`,
   `[host] limber-glade: classing the turn's writes failed: docker start
   pinetrie-observer-…: container is marked for removal`, the observer's
   OOM met by a turn's end) could not be placed against the measurements.

**What the Machine page showed and did not.** The reading it served was
the 12:17:44 sample's from then until the restart. It named the cause it read
("memory is short") and the observer at its limit, without saying either
was stale or that a service at its limit is a cause. "2 threads wait
for room" named no thread, and the held threads' columns showed no held
line the person saw.

**Recovered** by stopping the suite's process group in limber-glade (the
leaked connections went with the observer's OOM, its `docker exec` on the
Mac with it), then restarting the host: rung 0, nothing held, fleet-creek
started.
