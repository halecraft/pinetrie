# S265 — A host can wait for its lanes to be ready before it listens: nothing in their preparation waits on the host

- **Status:** Answered
- **Led to:** ADR-0191

**Question.** A host with tools prepares its lanes in the background
(`prepare`, `apps/pinetrie/host/work/setup.ts`): the lane images, the lane
runtime, links and identity, the slot's shares and grants (which start
lanehost's roles), and the base snapshot. `startHost`
(`apps/pinetrie/host/index.ts`) listens without waiting for it, and a run
waits for it unseen: on 2026-10-19 Duane's runs showed only that the agent
was working while the lane image built, and each restart killed the build.

1. If `startHost` awaits that preparation just before `startHttp`, does
   it finish, or does any of it wait on something `startHost` makes only
   after, or on the HTTP server listening? The base snapshot opens a
   scratch lane, whose link starts pi's helper, registers it with the
   observer and mounts the host's ssh socket; it reads your repo through
   `@pinetrie/jj`.
2. Does it finish the same way with the person's own ssh granted to
   lanes (`lanes.ssh.personal`), and on a restart over the same project,
   whose base snapshot is already there?
3. Once `startHost` returns, does a thread's first turn start its lane
   without waiting for any build?

Read from source before running anything:

- `prepare` runs `prepareImages`, `checkImage`, `ensureRuntime`,
  `gatherLinks`, the project's identity, the runtime's `ready` (the slot
  filled; `sweepProjects`, which opens lanehost's disks role and so
  builds its image if missing), then `refreshBaseNow`.
- The ssh socket's directory is named before the runtime is found, and
  "need not listen yet" (`findProject`'s `hostSocket`): Docker binds it as
  a lane is made.
- The observer is opened from a lane's link (`laneLinkOpener`,
  `apps/pinetrie/host/work/registry.ts`), so a fresh base snapshot opens
  it, and a start whose base snapshot is current does not.

**Kill criterion.** If the start does not return within 15 minutes, or
returns without `lanes of their own are ready` in its log, the wait has a
cycle: the plan must name what `prepare` waits on and move it before the
wait, or the wait cannot go before listening.

**Throw away.** The patch that adds the wait, the probe's project and
suite directories. The patch and probe stay in this spike's folder if a plan builds on
them.

## Answers

1. **It finishes: nothing in the preparation waits on what `startHost`
   makes after lane work, or on the server listening.** With
   `wait.patch` (lane work's `ready()`, awaited just before
   `startHttp`), every start returned with `lanes of their own are
   ready` logged before it, including one whose preparation remade the
   base snapshot through a scratch lane (its helper, the host's ssh
   socket, your repo's reads) and, the observer's image and container
   removed first, built the image and started the role from that lane's
   link.
2. **The same with `lanes.ssh.personal`, and on restarts.** The probe's
   project grants it; the restarts found the base snapshot made, or
   remade it after accepted work moved while no host ran.
3. **A first turn after the start waits for no build:** 2.0 to 3.1 s from
   the send to idle, on the scripted model, and no image or runtime line
   in between.

**Measured** on the Mac's lane VM, 2026-10-19, with `probe.ts` (a
`laneHosts.startHost`, the suite's places, a scripted model) and, for
Duane's own session, `pnpm dev` with the patch:

| start | wait for lanes | `startHost` to return |
|---|---|---|
| fresh project and session; runtime extracted, slot swept (two runs) | 4.3 to 6.0 s | 4.7 to 8.3 s |
| restart, accepted work moved; observer's image and container removed | 4.8 s | 5.1 s |
| restart, nothing changed (two runs) | 0.9 to 1.1 s | 1.1 to 1.3 s |
| Duane's session (231 roots), nothing changed | 1.1 s | 3.3 s to `listening` |

In the fresh project's start, accepted work was set up only after the
host had started (`setUpAccepted`), so its preparation had no base
snapshot to make: the first turn made it. A project whose accepted work
is set up makes it in the preparation, as the moved restart did.

**Read from source:** a preparation that fails rejects `ready`, which
setup logs (`lanes of their own cannot start`); every run then fails at
its lane's start. The kill criterion did not fire.

**Sources,** in this spike's folder: `wait.patch` (the wait, thrown
away) and `probe.ts` (run from `apps/pinetrie/e2e/`).
