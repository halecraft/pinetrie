# ADR-0186 — Every tag is kebab-case: a union's kind, a literal union's member, an error code, a stored literal and a namespace; the run-end report is migrated to it

Numbered ADR-0184 until 2026-10-19, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `AGENTS.md`, `apps/pinetrie/host/TECHNICAL.md`,
  `packages/rules/TECHNICAL.md`

**Context.**

- **Tags were spelled four ways, with no rule.** Kebab-case held most of the
  wire: host commands, card kinds, record namespaces, custom message types.
  `@pinetrie/interface` and `@pinetrie/lanehost` were camelCase
  (`unqueueAll`, `diskExists`), the error codes snake_case (`not_owner`),
  and three tags held spaces (`"not an image"`). Some unions mixed two
  (`MessageDecision`: `appendToTree` beside `catch-up-first`), and the
  one `errorCode` field carried snake codes and kebab `MoveRefusal`s.
- **The UI translated between two spellings of one idea.** An intent
  `unqueueAll` became the request `unqueue-all`; a level `needsYou` became
  the signal `needs-you` and the attribute `data-level="needs-you"`.
  New features kept adding pairs (`putImages`, `put-images`).
- **One stored record held camelCase:** the run-end report, under
  `pinetrie.runEndReport`, with `modelSaid` and `needsYou`/`worthARead`.
  Everything else camelCase lived only in memory, or crossed a wire whose
  two ends are one build (the page and the host; the host and the lanehost
  server it starts), or was cached by a versioned URL (the review's
  `hostPort`, under `REVIEW_WIRE`).

**Decision.**

- **A tag is kebab-case**, or dot-separated kebab segments for a namespace
  (`pinetrie.run-end-report`). It covers a string literal type that names
  no property, a value of a table its module reads as a union (`ERR`), a
  stored schema's literal (`Type.Literal`, `Schema.string`), and any string
  beginning `pinetrie.`.
- **A spelling that is not ours stays as it is,** listed with its reason in
  `OUTSIDE_TAGS` or `OUTSIDE_TABLES` (`scripts/tag-spelling.ts`): HTTP
  methods, git's status letters, MIME types, pi's names. An entry no tag
  needs any more fails the check, so the lists only shrink.
- **A migration names an old spelling on purpose**, so its files are in
  `OLD_SHAPES` (`scripts/sources.ts`), the list the words check (ADR-0172)
  already kept for a retired name.
- **Stored tags migrate**, as ADR-0172's stored kinds do:
  `0025-run-end-report` moves each run-end report to
  `pinetrie.run-end-report`, respelled, through `rewriteRecords`, which
  now takes the namespace its records move `to`.
- **A value that is a tag is spelled alike everywhere,** so nothing maps one
  spelling to another: a level is a signal (`Signal` holds `Level`), a
  column act that is a host request is declared as that request and sent
  as it is, and `AccessRefusal` is `ERR`'s own codes.
- **`scripts/tag-spelling.test.ts` keeps it so**, over every TypeScript file
  of `packages/`, `apps/` and `scripts/`, tests included.

**Consequences.**

- About 140 tags renamed across `interface`, `web`, `lanehost`, `lanes`,
  `rules`, `core`, `session`, `pi` and the host; a record keyed by a tag
  (`LanehostResults`, the inbox's sections) holds quoted keys.
- A page left open across the host's restart reads an error code it does
  not know as a plain refusal until it reloads.
- `REVIEW_WIRE` moved, so a browser fetches every review again.
- A property name is never a tag: a literal that names one is derived with
  `keyof` (`ReviewPref`, pi's `Field`), and the check skips it in `Pick`,
  `Omit`, an indexed access and `Exclude<keyof …>`.

**Alternatives rejected.**

- **camelCase.** The UI used it, but the wire, the stored kinds, the
  namespaces and the custom message types are kebab, and moving those would
  migrate far more stored data. A kebab tag is never mistaken for a
  property name.
- **Renaming the run-end report without a migration.** Every thread would
  lose its last run's marker until its next run ends.
- **Changing only its values, keeping its namespace.** That keeps the one
  camelCase namespace among 32, and needs an exception for a stored name of
  our own.
- **A check over every string, or every `as const` table.** Those hold
  words, flags and file names; the noise would bury the rule. The check
  reads what is typed as a choice.
- **Listing property-name literals as exceptions** (`listFolded`,
  `usageRows`). Deriving them with `keyof` says what they are.
