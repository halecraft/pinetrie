# ADRs

An ADR records a decision and its reasons: what we chose, what it costs, and
what we rejected. Each is its own file here, so two lanes writing decisions at
once do not edit the same file. This directory is the record of why; what is
true now is in the living docs (`docs/README.md`), and an ADR names the ones
it changes.

**When to write one.** For a decision that is costly to reverse: a stored
shape, a boundary, what a person sees or does, how pine·trie acts on your
repo. A smaller choice goes into the living doc's text, and its reason into
the commit message.

**Format.** A file is `NNNN-slug.md`. It starts with a title line
(`# ADR-NNNN — …`) that states the decision, then its header, then
**Context**, **Decision**, **Consequences** and **Alternatives rejected**.

**The header** is a list right under the title (and under a renumbering
note, if any). Write these fields, in this order:

```markdown
- **Status:** Accepted (Duane, 2026-10-07)
- **Area:** `docs/06-interface.md`, `packages/web/TECHNICAL.md`
- **Evidence:** S98, S101
- **Supersedes:**
  - ADR-0011: one line on what this replaces.
- **Amends:**
  - ADR-0024: one line on what changes there.
- **Revised:**
  - 2026-10-07 (S135, S136): one line on what changed in place.
```

- **Status** is Proposed, Accepted or Rejected, with an optional
  parenthesis: who decided, and when. A rejected ADR changed nothing, so
  its Supersedes and Amends make no back links.
- **Area** names the living docs the decision changes, required while the
  ADR is in force. One of them cites the ADR (`ADR-NNNN`), in a sentence
  that states what holds now. Accepting an ADR edits its Area doc in the
  same change.
- **Evidence** names the spikes it rests on (`docs/findings/`).
- **Supersedes** and **Amends** name older ADRs, each with one line on what
  changes there. That line is what a reader of the older ADR sees.
- **Revised** lists amendments made in place, without an ADR of their own:
  for a spike that corrects how an accepted decision is built. A change to
  what was decided needs an ADR.
- No `PLAN-…` in a header: plans are spent. `jj log` on a record's path
  finds the commits that added and changed it.

`pnpm run record` (`scripts/record.ts`) writes the rest, and rewrites the
whole header in one layout, so a hand edit to a generated field is lost:

- **Amended by** and **Superseded by** on the older ADR, each item carrying
  the newer ADR's line;
- **Status:** Superseded, once any ADR supersedes this one, keeping the
  parenthesis;
- a spike's **Led to**: the ADRs whose Evidence names it;
- each file's folder (below), and the index, `docs/record.md`, which is not
  tracked.

`pnpm test` fails until the headers are as `pnpm run record` would write
them, and while any header does not parse, names an Area that is not a
living doc, names a record that does not exist, or is in force with no Area
that cites it. It also fails when a tracked file cites a `docs/adrs/` or
`docs/findings/` path that does not exist, and when the decision ids left
in code differ from `scripts/code-citations.ts`, a count by area that only
shrinks: code names no decision (ADR-0135, `scripts/record.test.ts`).

**Never deleted; archived.** An ADR is in force while it is Proposed or
Accepted. A Superseded or Rejected one moves to `docs/adrs/archive/`: the
rejected reasoning is the valuable part, so it stays, but search skips it
(`/.ignore`) unless you name the folder. jj sees the move as a delete and an
add, so an archived ADR's history before the move is under its old path.

**Amendments.** The record is a log (ADR-0135). An ADR is amended as often
as decisions need, by newer ADRs or in place, and its back links show each.
Supersede an ADR only when its decision is overturned, never to gather its
amendments into one text: the living docs say what holds now.

**Numbering.** Take the next number free both on the trunk, counting
`archive/`, and in the plans in flight, which may have written theirs
already. Two files with the same number and different slugs merge without a
conflict, so `scripts/numbering.test.ts` is what catches a clash, in the
first `pnpm test` after both have landed. Whoever finds the clash fixes it:
the file that landed second (by jj ancestry, the one whose adding commit
descends from the other's) takes the next free number, with its title and
every reference to it, and a line "Numbered <old> until <date>, when two
files held that number" goes under its title, since commit messages keep
the old number. Whoever resolves a landing that adds an ADR or a spike runs
`pnpm run record` and `npx vitest run scripts/numbering.test.ts
scripts/record.test.ts` before finishing. Two lanes that amend one ADR
both rewrite its generated **Amended by**, and the second landing
conflicts there: take either side and run `pnpm run record`, which
rebuilds the field from the forward links. Spikes (`docs/findings/`) are
numbered the same way.

**Slugs.** One or two words that name the decision, not the work that
implemented it: `0023-session-json.md`, `0048-cards.md`.

**Paths** are written from the repo root (`docs/findings/S5-fold-quality.md`,
`packages/client/composer.tsx`), so they read the same from any file.
