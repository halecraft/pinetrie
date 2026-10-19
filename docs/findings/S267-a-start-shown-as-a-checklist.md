# S267 — A start's phases take a second or two each, except the images, which take minutes cold and which the host can tell beforehand

- **Status:** Answered
- **Led to:** ADR-0191

**Question.** A host that waits for its lanes before it listens may take
minutes after a change that rebuilds an image. Duane asks for a checklist
in the terminal, drawn before anything is done: every phase of the start,
each ticked as it ends, with what each is expected to take.

1. Which phases does a start have, in order, and which can be skipped or
   run at once? The host logs a lap for each phase of a second or more
   (`startupLaps`, `apps/pinetrie/host/startup-lines.ts`), and lanes'
   preparation logs nothing until it ends.
2. What does each take, cold (nothing built or cached) and warm (a
   restart with nothing changed), on the Mac's lane VM?
3. Before a phase starts, can the host tell whether it will be slow:
   whether an image's tag is in Docker, the lane runtime is extracted, the
   VM's image is built, the base snapshot is at accepted work? Is a past
   duration, kept from an earlier start, a better estimate than a fixed
   one per phase?
4. What does the terminal allow: is stdout a TTY under `pnpm dev`
   (`pnpm --filter … run dev` pipes its child's output), and do the
   host's other log lines (`[vm]`, `[lanehost]`, Vite's) interleave with
   a redrawn checklist?

**Kill criterion.** If stdout is not a TTY under `pnpm dev`, the
checklist cannot redraw in place there, and it prints a line per phase
as it ends instead. If no phase is slow but the image builds, the
checklist is two lines and is not worth its code.

**Throw away.** The probe's timings, kept in this file; its scripts.

## Answers

1. **The phases, in order** (`startHost`, `apps/pinetrie/host/index.ts`,
   and `prepare`, `apps/pinetrie/host/work/setup.ts`): the project and the
   lane VM (its image built if missing, booted if not running, a slot
   leased); the store, opened and migrated; the session loaded; the
   project and its config; pi's setup; the roots a crash interrupted;
   lane work started; then the lanes' preparation: images, the runtime,
   the slot's shares and grants (lanehost's roles), the base snapshot,
   and the observer once the plan makes it ready. All are in sequence
   today except the preparation, which runs beside the rest of the start.
2. **What each took on the Mac, 2026-10-19:**

   | phase | warm | cold |
   |---|---|---|
   | the lane VM | 0.1 s (running) | 1.8 s to boot; its image about 20 s to build (ADR-0147) |
   | store, migrations, session | 0.4 s for Duane's 1 GB store | migrations not measured |
   | project, config, pi's setup | 0.3 s | — |
   | lane work started | 0.3 s | — |
   | the lane image | 0 (tag present) | 137 s with no cache (21 s apt, 60 s Playwright and Chromium, 37 s Docker's binaries, 17 s export); 112 s for Playwright alone in another build |
   | the lane runtime | 0 (extracted) | within S265's fresh start, 4.3 to 6.0 s |
   | shares, grants, lanehost | 1.1 s | lanehost's image not measured |
   | the base snapshot | 0 (current) | about 4 s for a small project (S265) |
   | the observer | 0.3 s (image present) | 0.8 s warm build, 56 s cold (S266) |

   Duane's warm start reached `listening` in 3.3 s with the wait. Cold, the
   images are all but the whole start.
3. **The host can tell, before each slow phase, whether it will run:**
   an image's tag is in Docker (`imageExists`, one API call; the tags
   come from `planImages` and `observerVersion`, read from files and
   `jj --version`), the runtime's directory is complete
   (`runtimeComplete`), the VM's image is built (`packages/vm` already
   says "building the lane VM's image, about 20 s" first), the base
   snapshot is at accepted work (what `refreshBase` decides). So a
   checklist can mark a phase as nothing to do before it starts.
   For an estimate, a fixed one per kind of build is what the VM's line
   already uses; a build's last duration, kept per image, would follow
   the network and the machine better. A build that comes rarely (the
   lane image) has a stale last duration as often as not; neither
   estimate is measured against the other here.
4. **`pnpm dev` gives the host a TTY.** Under `script` (a pseudo-terminal),
   a script run through `pnpm dev` → `pnpm --filter … run dev` → `node`
   saw `process.stdout.isTTY` true; piped, it was undefined. So a
   checklist can redraw in place in a terminal, and must fall back to a
   line per phase when piped (the suites, a log file). Read from the
   start's log: other lines interleave with the phases (`[vm]`, the
   config report, `[lanehost]`'s timings, Vite's re-optimizing, the
   stall watcher), so a redrawn checklist owns the terminal only if those
   lines print above it, or wait until it is done.

**Kill criterion.** Neither fired: stdout is a TTY under `pnpm dev`, and
a cold start has two builds of a minute or more (the lane image, the
observer's), the VM's image of about 20 s, lanehost's (not measured)
and the base snapshot.

**Thrown away:** the tag `pinetrie-lane:s267-cold`, the TTY probe's
workspaces, and the lap threshold lowered to 0 for the timings.
