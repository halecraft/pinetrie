# S336 — Which await can keep a machine sample from ending, and what bound does each need?

- **Status:** Open (the incident's hang is answered by S338: a deadlock
  through the documents' keeper; the bounds on every other await are still to
  measure)
- **Led to:** ADR-0212

**Why.** On 2026-10-24 the host's last machine sample ended at 12:17:44
and none ended after it for an hour, until the host was restarted (S334).
The gate kept the rung that sample planned, holding every start, and the
Machine page served that reading as current. A sample is a step on the
manager's keeper and never runs beside another, so one that does not end
stops every later one. The lanehost disks role was idle; the host held one
connection to the VM's Docker API, the events stream's or a hung
request's. The host's log has no times, so the incident cannot say which
await it was.

A sample awaits (`packages/machine/manager.ts`;
`apps/pinetrie/host/machine/sensor.ts`, `importance.ts`, `repair.ts`):
the running lanes and services (Docker's API); lanehost's `machine-sample`
(a call over the disks role's channel); the store's `statfs`; the service
kills' watch (`take`, which opens the events stream, asking the daemon's
time, when none is open); at rung 2 and above, the lanes' ranking, which
leases each lane's root and awaits its `ready`; and the repair's state, on
the Mac. Neither `request` (`packages/docker/api.ts`) nor a channel's
`call` (`packages/channel/client.ts`) has a bound.

**Question.**

1. With a stand-in for each dependency that accepts a call and never
   answers, which of them keeps a sample from ending? Docker's socket
   accepting and never answering; lanehost's channel never answering one
   call; a root whose `ready` never settles; the events stream's daemon
   time.
2. The observer killed and made again while a sample awaits (the
   incident's 13:02): does any await the sample makes depend on it?
3. What does each await take when the VM thrashes (S309's load in the
   spike VM), so a bound is set above it: the slowest of many samples, not
   a guess?
4. What should a sample whose await passes its bound do: fail and leave
   the next sample to try (the manager already tells `slow`), or keep what
   it read? And what should the gate do while no sample has ended for a
   number of samples: let go of its holds, so a stale reading never holds
   a lane?

**Kill criterion.** No stand-in keeps a sample from ending: then the hang
was elsewhere (the keeper itself, a step before the sample), and the spike
says where it looked.

**Throw away.** The stand-ins and the probe; kept in this spike's folder
of sources if a plan builds on them.

## Answers so far

**The incident's hang was not a call that never answered.** The 12:17:44
sample recorded its decision and set its reading, then awaited the
health's write, a step of the documents' keeper held by a get-the-latest
that waited at the gate for a sample: a deadlock, reproduced with the real
manager (S338, answer 2). Questions 1 to 3 still stand for every other
await a sample makes: none has a bound, and a sample never runs beside
another, so any one that never answers freezes the gate the same way.
Question 4 is sharper: a sample must never await a step that may wait on
the gate, and the gate must let go of a reading no sample has replaced.
