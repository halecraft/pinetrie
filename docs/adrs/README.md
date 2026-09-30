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

**Numbering.** Take the next number free on the trunk. If two lanes take the
same one, whichever lands second renumbers its file and its references.

**Slugs.** One or two words that name the decision, not the work that
implemented it: `0023-session-json.md`, `0048-cards.md`.

**Paths** are written from the repo root (`docs/findings/S5-fold-quality.md`,
`packages/client/composer.tsx`), so they read the same from any file.
