# Working on Pineta

Pineta is a collaborative agentic harness: pi's agent core over a Kyneta CRDT
document, where the conversation is a tree. Start with `docs/pineta.md` (the
handoff) and `docs/README.md` (the map of the docs). Decisions and their
reasons are the ADRs in `docs/02-decisions.md`. Each package has a
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
| in a real browser | `pnpm run e2e:browser` (needs `pnpm exec playwright run-server --port 3100` running outside the sandbox, and `container` running) |
| lanes of their own, in containers | `pnpm run e2e:lanes` (needs Apple's `container` running, outside the sandbox; `PINETA_LANES_SECTION=main,images,contract` runs some) |
| deliberate bugs | `pnpm mutate scripts/mutations/<list>.ts [name]` |

A check without a proof it can fail is not yet a check. A new check comes with a
deliberate bug (a mutation in `scripts/mutations/`) that it catches.

Each mutation runs its whole command, so one checked by `e2e` or `e2e:browser`
takes minutes. Run unit-test mutations as you write them. Run the suite-level
ones once, in a batch at the end of the work, after the suite itself passes:
one `pnpm mutate` call per name (it takes one name substring, or none for the
whole list), one after another. While writing,
`npx vitest run scripts/mutations.test.ts` checks that every anchor still
matches, in seconds. A run you interrupt leaves its mutant in the file: check
the file and put the line back.

## Plans

Plans live in `.jj/plans/`, named `YYYY-MM-DD-slug.md`, and are referred to as
`PLAN-YYYY-MM-DD-slug`. Mark each task 🔴/🟡/✅/⛔ as it moves. A plan cites
`docs/` and source paths, never `.jj/`.
