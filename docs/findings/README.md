# Spikes

A spike is an experiment that answers one question before we plan on a
belief. Every spike states a *question*, a *kill criterion*, and what gets
*thrown away*, and ends in a decision. Code written for a spike is
disposable by default.

Each spike is its own file here, so two lanes running spikes at once do not
edit the same file. This directory is the list of them.

**Format.** A file is `S<N>-slug.md`. It starts with a title line
(`# S<N> — …`) that states the question or its answer, then **Status**: Open,
Answered or Moot, naming any ADRs it led to and the plan it served. Then the
brief, written before the spike runs: **Question**, **Kill criterion**,
**Throw away**. Then **Answers** once it has run, and the evidence: what was
measured, how, and what was read from source rather than run. Files written
before this README keep their shape.

**Opening and resolving.** Open a spike by writing its brief as a new file.
Resolve it by adding its Answers and setting its Status in the same file. A
spike that decides something leads to an ADR (`docs/adrs/README.md`), which
cites it as evidence. No other file lists spikes. Open spikes are found by
their Status: `rg -l '^\*\*Status:\*\* Open' docs/findings`.

**Numbering.** As for ADRs (`docs/adrs/README.md`, Numbering): the next
number free, and a clash caught by `scripts/numbering.test.ts`.

**Paths** are written from the repo root (`docs/findings/S5-fold-quality.md`,
`packages/client/composer.tsx`), so they read the same from any file.

**Other reports here.** `WS1-walking-skeleton.md`,
`WS2-typescript-migration.md` and `kyneta-issues-verification.md` are
reports outside the spike series, and carry no number.
