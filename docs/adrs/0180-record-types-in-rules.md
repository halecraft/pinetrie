# ADR-0180 — A stored shape's type lives beside its spec in rules; core holds the types core or a package below rules names

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `packages/core/TECHNICAL.md`, `packages/rules/TECHNICAL.md`,
  `packages/jj/TECHNICAL.md`, `packages/session/TECHNICAL.md`
- **Evidence:** S252
- **Amends:**
  - ADR-0093: the placement rule the packages' notes share now says where a
    record's type lives; what the page shows is unchanged.
- **Amended by:**
  - ADR-0201: the placement rule stands, with `@pinetrie/threads` between core
    and rules; its rejection of a package between them does not apply, since
    no lane package declares threads.

**Context.** The rule the packages' notes quote says core holds "every
record's type", and that a type `lanes` or `jj` must name lives in core,
since neither can declare `@pinetrie/rules`. Rules' notes call it the
single authority on each stored shape, and two records are typed there
already (`BudgetRecord`, `LaneForkRecord`). No ADR decided the rule: it
came with a refactor, and ADR-0093 restated only its last sentence.

S252 resolved every use of core's exports with the TypeScript checker.
Twenty-two record types, the folder halves of two unions, and 23 types and
constants that are only their parts are named by rules and the packages
above it alone. Each record's spec, decoder and rules are in rules, so a
reader of a record goes to two packages, and core, which every package
loads, carries shapes that only the host and the page read. S252 also
found that `folder`, `schema`, `protocol`, `config`, `docker` and
`lanehost` declare core and not rules, as `lanes` and `jj` do, and
`folder` names three record types.

**Decision.** A type lives in the highest package that all its users can
import. The rest follows from that:

- **A stored shape's type is rules'**: a record's, beside its spec, and a
  pi custom message's, beside its builder, with the types only it uses.
- **Core holds a type that core's own code names, or that a package below
  rules names**: one that declares `@pinetrie/core` and not
  `@pinetrie/rules` (`workspace.test.ts` pins which). Such a record's spec
  stays in rules, over core's type (`LaneRecord`, `JjBaseRecord`,
  `StateRecord`).
- **A union whose halves split is rules'**: `BaseRecord` moves to rules,
  and its `JjBaseRecord` half stays in core: jj builds it, rules decodes
  it, and core is the one package both can import.
- The rule the packages' notes share reads:

  > A type lives in the highest package that all its users can import.
  > Core holds the vocabulary (ids, intents) and the reads of the tree.
  > A stored shape's type is `@pinetrie/rules`', beside its spec, with
  > the types only it uses. A type core's own code names, or one a
  > package below rules must read, write or name (one that declares
  > `@pinetrie/core` and not `@pinetrie/rules`: `lanes`, `jj`, `folder`
  > among them), lives in core instead. What a stored shape says, and how
  > the host changes it, is `@pinetrie/rules`', whoever reads it. One
  > client's own in-flight state (its moves, held roots, slot repair,
  > commands out) is `@pinetrie/session`'s. What a person sees and can
  > do, and its words, is `@pinetrie/interface`'s, for any client; how the
  > page draws it is `@pinetrie/web`'s (ADR-0093).

**Consequences.**

- A new record is typed in its spec's module unless a package below rules
  names it. When such a package starts to name a rules type, that type
  moves down to core, with the types it uses.
- Interface, web, reads, session, pi and the app import the moved types
  from rules, not core. Each already declares rules.
- Core loses about 45 types and two constants (`ICON_SOURCES`,
  `NO_MODEL_REASONS`). The 32 types that fail the same test but are not
  stored shapes (S252 item 7) stay where they are.
- No check enforces the rule: proving it needs the checker's symbols,
  which the repo's TypeScript 7 does not expose to a script. A reviewer
  applies it, and S252's census can be run again.

**Alternatives rejected.**

- **Keep every record's type in core.** It is what the notes say, but not
  what the code does (`BudgetRecord`, `LaneForkRecord`), and it puts a
  shape that only rules decodes and changes in the package every other
  package loads.
- **A `@pinetrie/records` package between core and rules** for the stored
  shapes. A package of types alone, which every rules module would import
  beside core. jj and lanes still could not declare it without pulling in
  shapes they do not read.
- **Move every type that fails S252's test**, stored shapes or not. The
  image store's port and the run reports are used by pi and the app, not
  rules. Where they belong is a separate question.
