# Spikes

A spike is an experiment that answers one question before we plan on a
belief. Every spike states a *question*, a *kill criterion*, and what gets
*thrown away*, and ends in a decision. Code written for a spike is
disposable by default.

Each spike is its own file here, so two lanes running spikes at once do not
edit the same file. This directory is the list of them.

**Format.** A file is `S<N>-slug.md`. It starts with a title line
(`# S<N> — …`) that states the question or its answer, then its header, a
list with one field you write:

```markdown
- **Status:** Answered
```

Status is Open, Answered or Moot, with an optional parenthesis.
`pnpm run record` adds **Led to**, the ADRs whose Evidence names the spike
(`docs/adrs/README.md`, The header); no `PLAN-…` goes in the header. Then
the brief, written before the spike runs: **Question**, **Kill criterion**,
**Throw away**. Then **Answers** once it has run, and the evidence: what
was measured, how, and what was read from source rather than run. A spike's
file holds the question, the kill criterion and the answers; long raw output
goes in its folder of sources (below), not in the file.

**Opening and resolving.** Open a spike by writing its brief as a new file.
Resolve it by adding its Answers and setting its Status in the same file. A
spike that decides something leads to an ADR (`docs/adrs/README.md`), which
names it in its Evidence. Open spikes are found by their Status:
`rg -l '^- \*\*Status:\*\* Open' docs/findings`.

**The archive.** A spike stays here while it is Open, or while an ADR in
force names it in its Evidence. Otherwise `pnpm run record` moves it to
`docs/findings/archive/`, with its folder of sources, and moves it back if
an ADR in force names it again. Search skips the archive (`/.ignore`)
unless you name the folder.

**Sources kept beside a spike.** A spike's code is thrown away, unless a
plan builds on it: then the sources go in a folder named as the spike's
file, without `.md` (`docs/findings/S131-share-slots/`), and the spike's
file says what each is. They record what ran; they are not maintained.

**Numbering.** As for ADRs (`docs/adrs/README.md`, Numbering): the next
number free, counting the archive, and a clash caught by
`scripts/numbering.test.ts`.

**Paths** are written from the repo root (`docs/findings/S5-fold-quality.md`,
`packages/client/composer.tsx`), so they read the same from any file.

**Other reports.** `WS1-walking-skeleton.md`,
`WS2-typescript-migration.md` and `kyneta-issues-verification.md` are
reports outside the spike series, carry no number and no header, and live
in `docs/findings/archive/`.
