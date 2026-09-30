# Working on Pineta

Pineta is a collaborative agentic harness: pi's agent core over a Kyneta CRDT
document, where the conversation is a tree. Start with `docs/pineta.md` (the
handoff) and `docs/README.md` (the map of the docs). Decisions and their
reasons are the ADRs, one file each in `docs/adrs/`. Each package has a
`TECHNICAL.md` with its gotchas: read the one nearest the code you change.

## Tools and environment

- **pnpm only** (`pnpm@10.18.0`). Read `pnpm install`'s output rather than
  trusting a quiet exit.
- **Node 24, native type stripping.** TypeScript runs as-is: there is no build
  step for it, and a type error does not stop a run, so check with
  `npx tsc --noEmit`.
- **jj, not git**, for version control. The repo is colocated. Don't commit or
  rewrite history unless asked.
- Lint and format with Biome: `pnpm run lint:fix`. Don't run it over code that
  doesn't parse, or it can mangle it.

## House rules

- No backwards compatibility: delete old code rather than keeping it beside new.
- No non-null assertions (`!`).
- Functional core, imperative shell: gather, then plan (pure, returning values),
  then execute. Decisions are values, and tests exercise them without I/O.
- Precise types inside; awkward representations only at the edges (wire,
  storage, pi).
- Only `packages/pi` imports pi (ADR-0003). Package boundaries are enforced by
  resolution; `workspace.test.ts` checks the manifests.
- Verify, don't assume: read the source of pi and Kyneta, or measure with a
  disposable probe, before planning on a belief. Record probes in
  `docs/findings/`.

## Gates

| gate | command |
|---|---|
| unit, conformance, e2e | `pnpm run verify` |
| with a real model | `pnpm run e2e:live` |
| in a real browser | `pnpm run e2e:browser` (its tools section needs `container` running; on the Mac, `pnpm --filter @pineta/app exec playwright install chromium-headless-shell` once) |
| lanes of their own, in containers | `pnpm run e2e:lanes` (needs Apple's `container` running, outside the sandbox; `PINETA_LANES_SECTION=main,images,contract` runs some) |
| deliberate bugs | `pnpm mutate scripts/mutations/<list>.ts [name]` |

A check without a proof it can fail is not yet a check. A new check comes with a
deliberate bug (a mutation in `scripts/mutations/`) that it catches. A
mutation uses a suite only when its check proves what no unit test can: the
behaviour of a container, jj, git, pi, Kyneta or the browser, or
`startHost`'s own wiring. Anything else is a unit mutation, a second or two
against minutes. `pnpm mutate <list> <name> --against <command>` runs a
mutant against another command and lists the checks that catch it: use it to
find a unit test that already proves a rule before writing one.

A mutation runs its command until the check it expects fails
(`PINETA_STOP_AT`, set by `pnpm mutate`), so one whose check comes late in
`e2e` or `e2e:browser` still takes minutes. Run unit-test mutations as you
write them. Run the suite-level ones once, in a batch at the end of the work,
after the suite itself passes:
one `pnpm mutate` call per name (it takes one name substring, or none for the
whole list; a substring that names no mutation exits 2), one after another. While writing,
`npx vitest run scripts/mutations.test.ts` checks that every anchor still
matches, in seconds. A run you interrupt leaves its mutant in the file: check
the file and put the line back.

## Plans

Plans live in `.plans/`, named `YYYY-MM-DD-slug.md`, and are referred to as
`PLAN-YYYY-MM-DD-slug`. Mark each task 🔴/🟡/✅/⛔ as it moves. A plan cites
`docs/` and source paths, never `.plans/` or `.jj/`. `.plans/` is untracked,
and shared read-write with every thread's lane (ADR-0035), so an agent in a
lane reads and writes plans at the same path.
