# pine·trie — the docs

A collaborative agentic harness: pi's agent core + Kyneta's CRDT substrate,
with a conversation **tree** as the primary object rather than a transcript.

## Documents

| File | Purpose |
|---|---|
| `00-vision.md` | What we are building and why. Product thesis. |
| `01-architecture.md` | Layer cake, thin waist, data model, evidence base. |
| `adrs/` | ADRs, one file each: decisions already made, with rationale. |
| `05-stack.md` | Stack decisions and why: TypeScript on Node, pnpm, Vite, React. |
| `06-interface.md` | The interface: columns for reading paths, a rail for the tree's shape. |
| `the-jujutsu-repo.md` | The jj repo the host serves: what pine·trie writes there, and how jj and jjui see it. |
| `pinetrie.md` | Handoff: where the project is, and how to pick it up. |
| `releasing.md` | Releasing pine·trie to npm: what the package build makes, and the checklist. |
| `glossary.md` | The words: accepted work, accept, proposed changes, WIP, publish, catch up, base (ADR-0100). |
| `findings/` | Spikes, one file each: the open unknowns with their kill criteria, and the answers with their evidence. |
| `record.md` | Not tracked: the index of the ADRs in force by living doc, the open spikes, and the archive, written by `pnpm run record`. |

## How to use this

Two kinds of document, kept apart:

- **The living docs say what is true now:** `ARCHITECTURE.md`, `AGENTS.md`,
  `00-vision.md`, `01-architecture.md`, `05-stack.md`, `06-interface.md`,
  `the-jujutsu-repo.md`, `glossary.md`, and every package's `TECHNICAL.md`.
  They are edited in place whenever a decision lands. Read the living doc
  first.
- **The record says why:** ADRs in `adrs/` and spikes in `findings/`. A
  record's body is not edited to follow later changes. An ADR names the living docs
  it changes, and they cite it. A superseded ADR, and a spike no ADR in force
  rests on, move to `archive/`, which search skips unless you name it.
  `pnpm run record` writes `record.md`, an index of the record by living
  doc.

Nothing stays an open unknown. Every uncertainty is either:

- **a decision** → an ADR, one file each, or
- **an unknown** → a spike, its own file, with a kill criterion.

When a spike resolves, its file gets its answers, and an ADR if it decides
something. How a spike is written and numbered: `findings/README.md`. How an
ADR is written, amended, restated and archived: `adrs/README.md`.

## Status

Four spikes are open, none blocking: S6, S100, S154 and S197.
`rg -l '^- \*\*Status:\*\* Open' docs/findings` lists them. What is built,
and what is not yet, is in `pinetrie.md` § 6.

## Where documents live

Two tiers, with different lifetimes:

| | | |
|---|---|---|
| `docs/` | **tracked** | Architectural reference. Vision, architecture, ADRs, spike findings, stack decisions. Long-lived: these explain *why the system is shaped as it is*. |
| `.plans/` | untracked | Implementation plans, one per change, named `YYYY-MM-DD-slug.md`. Short-lived: they describe *work to be done* and are spent once done. Shared read-write with every thread's lane (ADR-0035). |

An implementation plan may cite anything in `docs/` or any source path. It must
**not** cite anything under `.plans/` or `.jj/`, since neither is in the
repository: a plan has to be readable by someone who only has the repository.

`.gitignore` excludes `.plans/`, so plans are deliberately not versioned here.
`@halecraft/plans` will later store them in their own VCS namespace.
