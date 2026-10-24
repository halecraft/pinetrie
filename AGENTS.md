# Working on pine·trie

pine·trie is a collaborative agentic harness: pi's agent core over a Kyneta CRDT
document, where the conversation is a tree. Start with `docs/pinetrie.md` (the
handoff) and `docs/README.md` (the map of the docs). The words for the work
in your repo (accepted work, accept, proposed changes, which people read as
changes, WIP, publish, catch up) are `docs/glossary.md`: use them, and no
others. What is true now is in the
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
- Comments carry what the code cannot: a constraint (an ordering, a caller's
  obligation, a failure mode, a limit) or a reason a reader would otherwise
  undo. Not a restatement of the name and type below, not the module's
  story (its `TECHNICAL.md` holds that), not "Pure." (`/skill:comments`).
- Code names no decision (ADR-0136): no ADR, spike or plan id in a
  comment, a test title or a mutation list. Where a reader needs the
  reason, say it in a sentence; the module's `TECHNICAL.md` cites the
  decisions it rests on. `scripts/record.test.ts` fails on any id in
  code, naming its file.
- A test's title states one behaviour, briefly.
- A check never judges elapsed time. Model what it guards as a value (a
  planned configuration, steps counted, a result or a state); a cost worth
  knowing is a spike's measurement. `scripts/budget.test.ts` fails on a
  clock reading subtracted in a test or scenario.
- A `TECHNICAL.md` states rules, invariants and gotchas, and names the
  module they live in; a function's name in its prose goes stale on the
  next rename. `scripts/prose-names.test.ts` fails on a code name that a
  `TECHNICAL.md`, the glossary or a code comment cites and no code holds; a
  name from outside (Kyneta, pi, OpenSSH) goes in its `OUTSIDE_NAMES`.
- Functional core, imperative shell: gather, then plan (pure, returning values),
  then execute. Decisions are values, and tests exercise them without I/O.
- Precise types inside; awkward representations only at the edges (wire,
  storage, pi).
- Decide a label as a value; word it in one function
  (`packages/interface/TECHNICAL.md`, "Words come from values").
- A function's name says, on its own, what it returns or does: a noun for
  what it builds (`threadLink`, `threadReach`), a verb for what it does
  (`planRelay`), `is` for a yes or no (`isRoundAnswered`). Never end one in
  a bare *of*, *to* or *at* (`linkTo`, `reachOf`) that leans on its
  arguments to finish the phrase. `scripts/function-names.test.ts` fails
  on an exported one; a module's own helper that does is renamed when its
  code is next changed for its own reasons.
- A tag is kebab-case (`move-card`, `not-owner`): a union's `kind`, a
  literal union's member, an error code, a stored schema's literal, a
  namespace after `pinetrie.`. A spelling that is not ours (an HTTP method,
  pi's names) is listed with its reason in `OUTSIDE_TAGS`, and a
  migration's old shapes in `OLD_SHAPES`. `scripts/tag-spelling.test.ts`
  fails on any other.
- No module is in a cycle of the modules it loads: what two modules share
  goes in a third that imports neither. `import { type A }` loads its
  module; only `import type` does not. `scripts/import-cycles.test.ts`
  fails on a cycle outside `ALLOWED_CYCLES`, which holds only one the
  design needs, with its reason, and only shrinks.
- Only `packages/pi` imports pi (ADR-0003). Package boundaries are enforced by
  resolution; `workspace.test.ts` checks the manifests.
- Verify, don't assume: read the source of pi and Kyneta, or measure with a
  disposable probe, before planning on a belief. Record probes in
  `docs/findings/`, one file per spike (`docs/findings/README.md`).
- A decision that lands edits its living doc in the same change, and an ADR
  or spike you add or change is followed by `pnpm run record`, which writes
  every back link and moves what is spent to the archive
  (`docs/adrs/README.md`). Whoever resolves a landing that adds one runs it
  too. ADRs are a log: amend one as often as decisions need, and supersede
  it only when its decision is overturned.

## Gates

| gate | command |
|---|---|
| unit, conformance, e2e, lanes | `pnpm run verify`: `@halecraft/verify` over `verify.config.ts`, every task run whatever another's result; the unit tests this machine cannot run go to a throwaway lane it makes (on the Mac, on the lane VM), and the report says which ran where and what ran nowhere, and why. `pnpm exec verify <key>` runs one task (`checks:unit:lane`); `pnpm run verify:fix` fixes what Biome can |
| everything that can run here | `pnpm run verify:all`: `verify`, and the live, browser and observer suites, each skipped with why where it cannot run |
| with a real model | `pnpm run e2e:live` (the `live` scenario alone; needs a model key) |
| in a real browser | `pnpm run e2e:browser` (its scenarios with lanes need Docker, as `e2e:lanes` does; on the Mac, `pnpm --filter @pinetrie/app exec playwright install chromium-headless-shell` once) |
| lanes of their own, in containers | `pnpm run e2e:lanes` under Docker: in a lane whose project grants `lanes.nested` (pine·trie's does), its Docker at `$DOCKER_HOST`; on the Mac the lane VM, whose image the first lease builds with no Docker engine (ADR-0147), on Linux Docker with a btrfs lanes directory. Where Docker cannot run lanes, every scenario with lanes reports SKIP with why |
| the observer's kernel side and loader, in a QEMU guest | `pnpm run e2e:observer`: needs `qemu-system-aarch64` and an arm64 Docker for the builds (a lane's, or the Mac's lane VM's); without them every scenario reports SKIP with why |
| deliberate bugs | `pnpm mutate scripts/mutations/<list>.ts [name]` |

A check without a proof it can fail is not yet a check. A new check comes with a
deliberate bug (a mutation in `scripts/mutations/`) that it catches. A
mutation uses a suite only when its check proves what no unit test can: the
behaviour of a container, jj, git, pi, Kyneta or the browser, or
`startHost`'s own wiring. Anything else is a unit mutation, a second or two
against minutes. A unit mutation's `pnpm exec vitest run <paths…>` runs
narrowed: only the files holding a test whose name contains its `expect`,
and only those tests (one `vitest list` per batch). So a unit mutation's
command names its package, not a file, and needs no `-t` of its own. Its
command first runs once with nothing mutated; if it fails there, its
mutants read BASELINE and run nothing: a test that passes only after
another in its file fails alone, and would otherwise read KILLED. A test
names what it needs of the place it runs in as a Vitest tag (`linux`,
`flock`, `btrfs-checkout`, `mac-host`; `apps/pinetrie/e2e/TECHNICAL.md`),
never a condition of its own; a mutant whose tests all skip here runs in
a throwaway lane when this machine can make one, or reads NOT-HERE.
`pnpm mutate <list> <name> --against <command>` runs a mutant against
another command, whole, and lists the checks that catch it: use it to find
a unit test that already proves a rule before writing one.

Each suite is a set of scenarios, one per file (`apps/pinetrie/e2e/TECHNICAL.md`),
and `PINETRIE_SCENARIO=a,b` runs some. A suite mutation names its `suite`,
`scenario` and check, and runs only that scenario until the check it expects
fails (`PINETRIE_STOP_AT`, set by `pnpm mutate`), so one whose check comes late
in a long scenario still takes a minute or two. Every suite check is a
mutation's `expect` (`scripts/proofs.ts`); one no mutation proves yet is in
`scripts/unproven.ts`, which only shrinks. Run unit-test mutations as you
write them. Run the suite-level ones once, in a batch at the end of the work,
after the suite itself passes:
one `pnpm mutate` call per name (it takes one name substring, or none for the
whole list; a substring that names no mutation exits 2), one after another. While writing,
`npx vitest run scripts/mutations.test.ts` checks that every anchor still
matches, in seconds, and `pnpm run proofs:unit` (a step of `verify`) that
every unit mutation's `expect` still names a test its command runs: a
test renamed or deleted under it would leave its kill reading ELSEWHERE.
Rename a test, and move its mutations' `expect` with it. A run you interrupt leaves its mutant in the file: check
the file and put the line back.

## Plans

Plans live in `.plans/`, named `YYYY-MM-DD-slug.md`, and are referred to as
`PLAN-YYYY-MM-DD-slug`. Mark each task 🔴/🟡/✅/⛔ as it moves. A plan cites
`docs/` and source paths, never `.plans/` or `.jj/`. `.plans/` is untracked,
and shared read-write with every thread's lane (ADR-0035), so an agent in a
lane reads and writes plans at the same path.

A plan is what we implement once its risks are found and settled; it is not
a sequence of steps that branches on what it finds. So the spikes come
before it: each belief a plan would rest on that no spike has measured is a
spike of its own in `docs/findings/`, run and answered first. The plan then
cites the answers as evidence. It holds no spike phase, and no task whose
shape depends on an answer still to come ("if this fails, Phase N
changes").
