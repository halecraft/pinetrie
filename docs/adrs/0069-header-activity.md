# ADR-0069 — The header counts only what needs you, in one activity menu

**Status:** Accepted (Duane, 2026-10-04). Implemented by
`PLAN-2026-10-04-header-activity`. Amends ADR-0030 (`@` becomes the
activity menu's mentions, and its count part of the menu's badge) and
ADR-0061 (the ⇣ trigger goes; its threads are the menu's "Ready to add").
Amended by ADR-0076: the project's trigger counts unpublished commits, and
no longer marks your files being behind.

**Context.** Using the header alone, with the agent working most of the time,
Duane found its right end noisy and unclear:

- **The agent's ✦ pulsed almost always.** It borrowed the rail dot's
  `pulse` keyframes (`scale(1.8)`), sized for a 6 px dot, on a 22 px circle.
  The same run already shows on its tab (`.tab.running`), its column's mark
  (ADR-0054) and the rail (`.rail-dot.pulse`).
- **Its count was never seen.** The rail's `.here-count` positions its count
  absolutely; the header's rule of the same name set only font and colour,
  so the header's count was drawn over the circle.
- **Up to seven triggers**, each drawn alike: people, the agent, ⇣N, the
  project, `@`, you, and the inventory. A status ("the agent works") had the
  weight of something that needs you ("work to add", "a mention"). ⇣ and the
  project were full blue buttons, the page's default.
- **"Offers" named the mechanism.** The menu said "Work ready to add to the
  project" (ADR-0061); the trigger was a bare `⇣N`.
- **`@` was always empty alone.** Only other people's chat mentions you.
- **The ⇣ count was too high**, counting archived and empty offers. ADR-0061
  and ADR-0067 fixed that; this ADR relies on `openOffers` being right.

**Decision.**

- **Status belongs where the work is; the header counts what needs you.**
- **One activity menu** (`packages/client/activity.ts`, drawn by
  `ActivityMenu` in `packages/client/header.tsx`) replaces the agent, ⇣ and
  `@` triggers. Its sections, each shown only with rows, in this order:
  - **Ready to add**: the threads with an open offer, each opening its thread.
  - **Mentions of you**: the inbox as ADR-0030 has it, with its filter and
    "mark all seen". It is shown only once someone has mentioned you, so
    never alone.
  - **The agent is working in**: its runs in every root (`runsHere`, ADR-0063),
    each opening its thread. The header is the only place that lists runs in
    roots you have no tab on, so they stay here.
- **The badge counts open offers plus unseen mentions**, and nothing else.
  Running work is a steady count beside the ✦, which is muted while nothing
  runs. The trigger is not drawn when nothing is in the menu; a seen mention
  keeps it, so the inbox stays reachable.
- **Nothing in the header animates.** The tab's dot, the column's mark and
  the rail keep their pulses.
- **An open menu keeps the sections it opened with** until you close it
  (ADR-0030, principle 6). One that empties says so: "The agent has
  finished", "Nothing left to add to the project.", "No one has mentioned
  you."
- **The project stays apart**, as a place you act on, not a notice. Its
  trigger reads "◆ project ↓" when the project has commits your files don't,
  with the count in its title. That is not counted in the badge.
- **Your inventory and you are utilities**, grouped at the far right
  (`.header-tools`), you last.

**Consequences.**

- Alone, with nothing waiting, the right end is the activity ✦ (while the
  agent works), the project, the inventory and you, and nothing moves.
- A run's end in a root with no tab open is no longer announced by anything
  moving; the steady count drops.
- The badge has two kinds of item. More kinds (a run you have not looked at,
  the agent waiting on you) would need a per-device seen state for runs, as
  mentions have.
- The browser suite checks that nothing in the activity trigger animates
  while the agent works.

**Alternatives rejected.**

- **Hide `@` only while you are alone.** It keeps three triggers and the
  pulse.
- **Count running work in the badge.** It would be on almost always, which is
  the noise this removes.
- **Fold the project into the activity menu.** Its actions move your files
  and the line; a notification list is the wrong place for them, and its
  state ("behind") is not a request.
- **Rename offers "Ready to merge".** A take is not a merge in jj's sense,
  and ADR-0061's verb is "add to the project".
