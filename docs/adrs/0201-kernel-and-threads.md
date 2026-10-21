# ADR-0201 — Core is the kernel every package names; threads, their messages, commands and cards are `@pinetrie/threads`, which no lane package declares; the shared vocabulary's indexes are written from what is imported through them

Numbered 0199 until 2026-10-20, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-21)
- **Area:** `packages/core/TECHNICAL.md`, `packages/threads/TECHNICAL.md`,
  `packages/rules/TECHNICAL.md`, `packages/interface/TECHNICAL.md`,
  `ARCHITECTURE.md`, `docs/01-architecture.md`
- **Evidence:** S285, S286, S287
- **Amends:**
  - ADR-0180: the placement rule stands, with `@pinetrie/threads` between core
    and rules; its rejection of a package between them does not apply, since
    no lane package declares threads.

**Context.** `@pinetrie/core` was the vocabulary every package loads: 676
exports, `export *` from every module, 75 of them named by no other
package (S285). The lane side (`lanes`, `lanehost`, `docker`, `jj`,
`folder`) names 17 of its 42 modules, but through core's own imports it
reached every one of the conversation's: cards, places, the tree, the
commands, messages and mentions. Four imports and eight names made that
reach, not the vocabulary itself: the refusal codes and the writes were
declared in the commands' module, the trailers took a string helper from
the tree, and the card ids sat beside the ids every package uses.

The rules package does not split the same way. 85% of its lines are on the
side the page's packages load, and 49 of its 54 shared modules hold a
record's shape beside the host's rules about it, which ADR-0180 put
together (S286). And the indexes of rules and interface said they hold only
what another package imports, yet held 134 and 99 names nobody imported:
nothing held them to it.

A check that reads syntax could hold a listed lane side to its list, and
another could hold each index to its imports. `docs/01-architecture.md`
records why pine·trie holds a boundary by resolution instead: a scanner
failed silently three times. And a file can be written from what it follows
from, as `pnpm run record` writes a record's header, so that it cannot
differ from it.

**Decision.**

- **Core is the kernel:** ids, refusals (`refusals.ts`), writes
  (`writes.ts`), and what a lane, its disk and its history are, with the few
  pure helpers several packages share. It declares nothing.
- **Everything else core held moves to `@pinetrie/threads`.** That is the
  conversation and what sits beside it: threads and their messages, the
  commands people send, and cards with their places and moves.
- **Threads depends on core, and nothing in the lane packages depends on
  threads.** So lane code cannot use a card or a command, and core cannot
  use anything in threads.
- **No new check enforces this.** A package can import only what its
  `package.json` declares; TypeScript and Node refuse anything else, and
  `workspace.test.ts` already pins what each package declares.
- **Where a type lives** is still the highest package all its users can
  import (ADR-0180): core, when core's own code or a lane package names it;
  threads, when every package that names it can declare threads; else
  rules, beside its spec.
- **The indexes of core, threads, rules, interface and web-core are written
  by `pnpm run indexes`** (`scripts/indexes.ts`): each name some file
  imports through the index, from the module that declares it, laid out as
  Biome lays it out, under the index's own leading comment.
  `scripts/indexes.test.ts` fails while one differs, and the plan refuses a
  name no module exports, a name two modules export, and an import of the
  whole index. A module exports a name only where another module, or its
  own test, imports it.

**Consequences.**

- The packages above the kernel (`rules`, `reads`, `session`, `interface`,
  `web`, `web-core`, `pi`, `protocol`, `schema`, the app and the terminal
  client) declare threads beside core.
- The lane side's closure is 17 of core's modules and the three new ones;
  splitting the kernel further is a move of modules, with nothing to cut.
- An index changes only when what is imported through it changes, and it
  changes by `pnpm run indexes`, never by hand. Rules' index lost 134 names
  and interface's 99; 219 declarations lost an `export` nothing used, and
  two types nothing named went.
- A test that read every export of a package through its index now reads
  its modules (`RECORD_SPECS` in rules' `records.test.ts`).

**Alternatives rejected.**

- **One core, its lane side held to a listed set of modules by a check
  that reads imports** (S285). Cheaper, but a syntax check of what
  resolution holds, the trade `docs/01-architecture.md` records against.
- **The kernel as the new package, core keeping the conversation.** Every
  lane package's manifest and rule would change, and every package above
  would declare both anyway.
- **Rules split by reader, as a `rules/host` sub-export or a package**
  (S286): the host's side of whole modules is 15% of rules; split by
  export, each of 49 record modules would be cut from its rules.
- **Per-feature sub-exports instead of one index per package** (S287): an
  index edit names several modules about as often as one, edits from
  parallel threads raced 7 times in 158 and never in neighbouring blocks,
  and the one race on the same block would have raced in any file.
- **Hand-kept indexes held by a check.** The check finds drift a written
  index cannot have, and every new import still needs a hand edit.
