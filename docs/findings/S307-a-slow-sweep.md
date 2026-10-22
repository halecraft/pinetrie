# S307 — Removing a lane's container takes as long as deleting its writable layer, five times longer under memory pressure; a kill alone frees the slot, so a fill need not wait for removals

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** On 2026-10-21 a host's start spent 1:08 in "the lanes' disks
and grants". lanehost's calls in that step took under 0.4 s. The rest was the
sweep before the slot's fill, which removed ten containers a dead host had
left in slot 0, one after another (`sweepSlot`, `packages/docker/runtime.ts`;
`fill`, `packages/vm/lease.ts`). Docker's events show four stopped lanes
destroyed in 1.5 s, then two running ones: one 10 s from its `die` to its
`destroy`, the other 55 s. The VM was thrashing then (S309). So:

1. What does a forced removal of a running lane spend its time on, after
   the kill?
2. Does that time grow under memory pressure?
3. The sweep runs before the fill so that no slot is filled with a dead
   host's container still bound into it. Is a kill enough for that, so the
   removals could follow the fill?

**Kill criterion.** A removal whose time does not follow the files in the
container's writable layer; or a killed container whose binds into the slot
remain.

**Throw away.** The spike VM and its containers (the harness is
`docs/findings/S308-pressure-in-the-lane-vm/`). The commands are below.

## Answers

Measured on 2026-10-21 on the Mac (Apple M3 Max), in the spike VM: the lane
VM's image, 8 GiB, 8 CPUs, its own data disk. Docker's own log from the
incident was lost: `/run` is a tmpfs, and the VM had been restarted.

1. **The time is the writable layer's deletion.** A running container,
   `docker rm -f`, by the files its writable layer holds (1 KB each):

   | files | removal |
   |---|---|
   | 0 | 83 ms |
   | 100,000 | 1,403 ms |
   | 300,000 | 4,622 ms |

   A container that is not running has nothing to kill: after a kill,
   removing one took 34 ms. That matches the incident: the stopped lanes
   went in about 0.1 s each, and the running ones, killed in 0.2–0.3 s,
   took 10 s and 55 s more. What filled the two lanes' writable layers was
   not measured; a lane that installs packages or keeps caches outside its
   disk writes there (the one still running afterwards held 347 MB).

2. **Memory pressure multiplies it by five.** The same 300,000-file removal
   while four lanes thrashed as in S309's configuration A: 22.7 s and
   26.3 s, against 4.6 s at rest.

3. **A kill frees the slot.** A container binding `/mnt/host-shares/0`
   shows one mount of it across the VM's `/proc/*/mountinfo` while it runs,
   and none after `docker kill`: the binds live in the container's mount
   namespace, which ends with its last process. So a sweep that kills
   every container bound into the slot, then fills, may leave the removals
   to run after, in parallel, off the start's path, provided nothing starts
   those containers in between: the host makes each lane's container again
   at its next start.

Commands, from the Mac, against the spike VM's Docker:

```sh
docker run -d --name bound -v /mnt/host-shares/0:/slot alpine:3.23 sleep 3600
docker run --rm --privileged --pid=host alpine:3.23 nsenter -t 1 -m \
  sh -c 'cat /proc/*/mountinfo | grep -c " /slot "'     # 1
docker kill bound                                         # then 0
docker run -d --name heavy alpine:3.23 sh -c '<N files of 1 KB under /w>; sleep 3600'
docker rm -f heavy                                        # timed
```
