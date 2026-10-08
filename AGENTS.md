# Working on pine·trie

pine·trie is a collaborative agentic harness: pi's agent core over a Kyneta CRDT
document, where the conversation is a tree. Start with `docs/pinetrie.md` (the
handoff) and `docs/README.md` (the map of the docs). The words for the work
in your repo (accepted work, accept, offer, WIP, publish, catch up) are
`docs/glossary.md`: use them, and no others. What is true now is in the
living docs: `ARCHITECTURE.md`, `docs/01-architecture.md`,
`docs/06-interface.md`, `docs/the-jujutsu-repo.md`, and each package's
`TECHNICAL.md` with its gotchas: read the one nearest the code you change,
before any ADR. Decisions and their reasons are the ADRs, one file each in
`docs/adrs/`, and the spikes they rest on are in `docs/findings/`;
`pnpm run record` writes `docs/record.md`, an index of both by living doc.
`docs/adrs/archive/` and `docs/findings/archive/` hold superseded ADRs and
spent spikes: history, which search skips unless you name the folder.

## Tools and environment

- **pnpm only** (`pnpm@10.18.0`). Read `pnpm install`'s output rather than
  trusting a quiet exit. In a lane, never let pnpm rewrite `pnpm-lock.yaml`:
  the lane's store has only Linux packages, and a rewrite drops every
  macOS one (`@rollup/rollup-darwin-arm64` among them). Install with
  `--frozen-lockfile`; for a new workspace package, add its importer and
  links to the lockfile by hand.
- **Node 24, native type stripping.** TypeScript runs as-is: there is no build
  step for it, and a type error does not stop a run, so check with
  `npx tsc --noEmit`.
- **jj, not git**, for version control. The repo is colocated. Don't commit or
  rewrite history unless asked.
- Lint and format with Biome: `pnpm run lint:fix`. Don't run it over code that
  doesn't parse, or it can mangle it.

## House rules

- The name: `pine·trie` wherever a person reads it (prose, UI, what the agent
  is told), lowercase even at a sentence's start, from `PRODUCT_NAME` in code;
  `pinetrie` in code names (`@pinetrie/core`, `PINETRIE_PORT`); `Pinetrie-`
  only in git trailers (`Pinetrie-Base`), after `Signed-off-by`.
- No backwards compatibility: delete old code rather than keeping it beside new.
  That holds for a thread's history too: a host message stores the code's
  own value, and one stored in an older shape stops decoding
  (`packages/rules/TECHNICAL.md`, "History messages").
- No non-null assertions (`!`).
- Functional core, imperative shell: gather, then plan (pure, returning values),
  then execute. Decisions are values, and tests exercise them without I/O.
- Precise types inside; awkward representations only at the edges (wire,
  storage, pi).
- Decide a label as a value; word it in one function
  (`packages/interface/TECHNICAL.md`, "Words come from values").
- Only `packages/pi` imports pi (ADR-0003). Package boundaries are enforced by
  resolution; `workspace.test.ts` checks the manifests.
- Verify, don't assume: read the source of pi and Kyneta, or measure with a
  disposable probe, before planning on a belief. Record probes in
  `docs/findings/`, one file per spike (`docs/findings/README.md`).
- A decision that lands edits its living doc in the same change, and an ADR
  or spike you add or change is followed by `pnpm run record`, which writes
  every back link and moves what is spent to the archive
  (`docs/adrs/README.md`). Whoever resolves a landing that adds one runs it
  too.

## Gates

| gate | command |
|---|---|
| unit, conformance, e2e, lanes | `pnpm run verify` (its scenarios with lanes need Docker, as `e2e:lanes` does) |
| with a real model | `pnpm run e2e:live` (the `live` scenario alone; needs a model key) |
| in a real browser | `pnpm run e2e:browser` (its scenarios with lanes need Docker, as `e2e:lanes` does; on the Mac, `pnpm --filter @pinetrie/app exec playwright install chromium-headless-shell` once) |
| lanes of their own, in containers | `pnpm run e2e:lanes` under Docker: in a lane whose project grants `lanes.nested` (pine·trie's does), on the Mac the lane VM (`pnpm vm:build` first, in any Docker the first time), on Linux Docker with a btrfs lanes directory. Where Docker cannot run lanes, every scenario with lanes reports SKIP with why |
| deliberate bugs | `pnpm mutate scripts/mutations/<list>.ts [name]` |

A check without a proof it can fail is not yet a check. A new check comes with a
deliberate bug (a mutation in `scripts/mutations/`) that it catches. A
mutation uses a suite only when its check proves what no unit test can: the
behaviour of a container, jj, git, pi, Kyneta or the browser, or
`startHost`'s own wiring. Anything else is a unit mutation, a second or two
against minutes. `pnpm mutate <list> <name> --against <command>` runs a
mutant against another command and lists the checks that catch it: use it to
find a unit test that already proves a rule before writing one.

Each suite is a set of scenarios, one per file (`apps/pinetrie/e2e/TECHNICAL.md`),
and `PINETRIE_SCENARIO=a,b` runs some. A suite mutation names its `suite`,
`scenario` and check, and runs only that scenario until the check it expects
fails (`PINETRIE_STOP_AT`, set by `pnpm mutate`), so one whose check comes late
in a long scenario still takes a minute or two. Every suite check is a
mutation's `expect` (`scripts/proofs.ts`); one no mutation proves yet is in
`scripts/unproven.ts`, which only shrinks. The suites keep to a budget: the
host and lanes scenarios at most √ of the unit tests, the browser's at most √
of those (`scripts/budget.test.ts`). Run unit-test mutations as you
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
