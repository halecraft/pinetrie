# ADR-0136 — Code names no decision, a unit mutation lives beside its test, and ADRs are a log with no amendment limit

Numbered 0135 until 2026-10-11, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-11)
- **Area:** `AGENTS.md`

**Context.**

- **Code cited decisions everywhere.** The source of `packages/` and
  `apps/` (533 files, tests apart) held 2,780 ADR ids and 472 spike ids in
  its comments, and 459 of 2,472 test titles ended in "(ADR-NNNN)".
  Comments were 21% of its non-blank lines, many of them a pointer to an
  ADR or a restatement of the name and type below them. No rule asked for
  it: each agent copied the comments around it.
- **The amendment limit met the citations at their worst.** An ADR amended
  more than three times had to be restated, and code citing a superseded
  ADR failed `scripts/record.test.ts`. The ADRs amended most are the
  central ones, cited most: ADR-0126 went over its limit when two threads
  landed amendments at once, and restating it meant moving 360 citations
  in 154 files, with every thread in flight failing on its own.
- **Test titles were copied into mutation lists.** A unit mutation's
  `expect` is the title of the test that kills it, kept in
  `scripts/mutations/`, far from that test. A title edited, or an id
  dropped from it, broke anchors in files nobody else touched.
- **The living docs already say what holds now.** An ADR's place is the
  record of why; the `TECHNICAL.md` nearest the code cites the ADRs it
  rests on, and `pnpm run record` indexes the record by living doc.

**Decision.**

- **Code names no decision.** No ADR, spike or plan id in a comment, a
  test title or a mutation list. Where a reader needs the reason, the
  comment says it in a sentence; the trail from a module to its decisions
  runs through its `TECHNICAL.md`, which cites them.
- **The ids left in code are counted, and the count only shrinks**
  (`scripts/code-citations.ts`, `citationsByArea`): `pnpm test` fails until
  it equals what the code holds, so an id added fails and one removed
  lowers it. They go as code is next changed for its own reasons, and in a
  cleanup pass for each package once the threads in flight have landed.
- **A unit mutation is declared beside the test that kills it**, naming
  that test, not copying its title into a list elsewhere. The lists in
  `scripts/mutations/` keep the suite mutations, whose checks span
  packages. Not yet built: until it is, unit mutations stay where they
  are.
- **ADRs are a log.** An ADR is amended as often as decisions need, each
  amendment a back link `pnpm run record` writes. An ADR is superseded
  only when its decision is overturned, never to consolidate. There is no
  amendment limit, no restatement, and no `scripts/unconsolidated.ts`.

**Consequences.**

- **`scripts/record.test.ts` no longer checks the amendment limit** or
  code citing a superseded ADR. It checks the count of decision ids in
  code instead.
- **ADR-0126 stays in force with its four amendments**, and no citation
  moves.
- **Each change to cited code may lower the count**, and a thread whose
  landing brings in new ids removes them before it lands.
- **A reader following a decision from code goes through
  `TECHNICAL.md`.** A module whose `TECHNICAL.md` says nothing of a
  decision it rests on is a gap in that file.
- **The cleanup is large but mechanical** (most ids are a trailing
  "(ADR-NNNN)"), and runs package by package, each its own revision, so
  that no pass conflicts with every thread at once.

**Alternatives rejected.**

- **Exempting code that cites an ADR superseded only by a restatement.**
  It fixes the check and keeps every citation, and the limit that forces
  restatements of the ADRs most cited.
- **Rewriting every citation at once.** It conflicts with every thread in
  flight; a count that only shrinks gets there without one large edit.
- **A citation in code as the index from code to decisions.** It says
  nothing in place, goes stale when its decision moves, and duplicates
  what `TECHNICAL.md` and the record's index already hold.
