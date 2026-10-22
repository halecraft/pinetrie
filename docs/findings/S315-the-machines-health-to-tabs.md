# S315 — The machine's health reaches every tab as one session record written when it changes; its samples suit a request the Machine page makes while it is open

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** A footer indicator in every tab, and a Machine page while one
is open, need the host's view of the machine: a health value (a state, its
causes, what can be done) and, for the page, recent samples. Which of the
ways the host already reaches tabs fits each, without writing samples
into stored history?

**Kill criterion.** None: read from the source and the living docs. A
channel is rejected for a stated rule it would break.

**Throw away.** Nothing was written.

## Answers

Read on 2026-10-21.

1. **Presence does not fit.** It is ephemeral, scalars and records only,
   and per peer: who reads which thread (`docs/01-architecture.md`, the
   documents' table). Kyneta's ephemeral store does not notify on a remote
   arrival (ADR-0014), so a tab would not learn of a change.
2. **The health value fits a session record.** The host writes its
   records (`pinetrie.*`) into the session document, which every tab
   holds, and which the upkeep compacts. `pinetrie.setup`, what the host
   read of its config, is one value written by the host and drawn by the
   Setup page (`packages/rules/setup.ts`, `packages/reads/index.ts`). A
   `pinetrie.machine` value written only when the health value changes,
   with thresholds to enter and leave each state so it does not flap,
   costs a few writes an hour.
3. **Samples fit a request, not a document.** Samples every few seconds
   written into the session would grow its op log between compactions,
   for a view only an open page needs. The host already serves reads by
   request behind its admission (`/blob/`, `/review/`:
   `apps/pinetrie/host/routes.ts`), and the page could ask for the current
   samples and a short window while it is open; the host need sample more
   often only then.
