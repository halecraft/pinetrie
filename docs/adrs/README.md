# ADRs

An ADR records a decision and its reasons: what we chose, what it costs, and
what we rejected. Each is its own file here, so two lanes writing decisions at
once do not edit the same file. This directory is the list of them.

**Format.** A file is `NNNN-slug.md`. It starts with a title line
(`# ADR-NNNN — …`) that states the decision, then **Status**, **Context**,
**Decision**, **Consequences** and **Alternatives rejected**.

**Status.** Proposed or Accepted, with its evidence (findings in
`docs/findings/`) and the plan that implements it. An ADR that a later one amends or supersedes is marked
in place ("Amended by ADR-NNNN: …", "Superseded by ADR-NNNN"), never deleted:
the rejected reasoning is the valuable part.

**Numbering.** Take the next number free both on the trunk and in the plans
in flight, which may have written theirs already. Two files with the
same number and different slugs merge without a conflict, so
`scripts/numbering.test.ts` is what catches a clash, in the first
`pnpm test` after both have landed. Whoever finds the clash fixes it: the
file that landed second (by jj ancestry, the one whose adding commit
descends from the other's) takes the next free number, with its title and
every reference to it, and a line "Numbered <old> until <date>, when two
files held that number" goes under its title, since commit messages keep
the old number. Whoever resolves a landing that adds an ADR or a spike runs
`npx vitest run scripts/numbering.test.ts` before finishing. Spikes
(`docs/findings/`) are numbered the same way.

**Slugs.** One or two words that name the decision, not the work that
implemented it: `0023-session-json.md`, `0048-cards.md`.

**Paths** are written from the repo root (`docs/findings/S5-fold-quality.md`,
`packages/client/composer.tsx`), so they read the same from any file.
