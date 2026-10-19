# ADR-0191 — A host listens once its lanes work, and shows its start as a checklist

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `docs/01-architecture.md`
- **Evidence:** S265, S266, S267, S268

**Context.**

- **A host listened before its lanes could start.** Lane work prepared
  the lane images, the lane runtime, the slot and the base snapshot in the
  background, and each lane's first step awaited them. On 2026-10-19 a
  change to the default image's Containerfile gave it a new tag: each
  start began a build of about 3 minutes, every thread showed only that
  its agent was working, and each restart killed the build.
- **The observer was made by the first lane.** Its tag hashes
  `packages/lanehost`, `packages/channel` and `packages/core`, so most
  changes rebuild it: 0.8 s with BuildKit's cache, 56 s without, and the
  VM's 512 MB cache is smaller than the lane image's layers (S266).
- **Waiting costs a warm start about a second** (S265), and the wait can
  sit inside lane work, before the project's adapter starts, for jj and
  folder projects alike (S268).
- **A cold start is minutes of builds,** and the host can tell before each
  step whether it will build (S267). `pnpm dev` gives the host a TTY.

**Decision.**

1. **Lane work waits for its lanes before anything after it is made:**
   the images, the runtime, the slot served (lanehost's roles), the
   observer connected, and the base snapshot. What it found is a value
   (`Ready`), not a promise, and the observer is reached only through it.
   The agent, `recover` and resumed runs come after; the server listens
   last.
2. **A preparation that fails refuses the start,** as the runtime's own
   refusals do: the host closes what it opened, says which step failed
   and why, and exits 1. A host without tools starts as before.
3. **The start is a checklist.** Every step of this start is listed
   before any runs, one runs at a time, and each ends done, up to date or
   failed. A step that builds says what, with its elapsed time against an
   estimate: the step's last duration in this session, kept apart for a
   start that built, else a default per step. In a terminal the list is
   redrawn in place, and anything written meanwhile prints above it;
   piped, each step's end is a line.

**Consequences.**

- A cold start, or one after an update that changes an image, takes
  minutes before `listening`; `listening` means lanes work.
- Interrupted runs resume only once lanes are ready; a start that fails
  resumes none.
- An image with no git refuses the start, where each lane refused it.
- Each host holds a connection to the machine's observer while it runs.
- `agent ready` follows the lanes' lines.

**Alternatives rejected.**

- **Wait just before the server listens, `Ready` still a promise** (S265's
  placement): every consumer must still await it, and runs resume before
  lanes are ready.
- **Prepare in the background and show the wait in the thread:** a
  listening host still would not work.
- **Build the images in a command of their own:** the tags depend on the
  host's jj version and its files, so the host must check and build all
  the same.
- **Serve without lanes when they fail:** a listening host whose agents
  cannot work.
- **Leave the observer to the first lane:** a cold build, or a kernel its
  loader cannot use, is found at the first turn.
- **lanehost reachable only once served, as the observer is:** every disk
  call of the runtime port goes through lanehost, and the folder adapter
  is given the runtime before the slot is served; that is a split of the
  port of its own.
- **Fixed estimates only:** a build's time follows the network and the
  machine.
