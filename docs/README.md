# Pineta — Plans

A collaborative agentic harness: pi's agent core + Kyneta's CRDT substrate,
with a conversation **tree** as the primary object rather than a transcript.

## Documents

| File | Purpose |
|---|---|
| `00-vision.md` | What we are building and why. Product thesis. |
| `01-architecture.md` | Layer cake, thin waist, data model, evidence base. |
| `adrs/` | ADRs, one file each: decisions already made, with rationale. |
| `04-roadmap.md` | Sequencing: spikes → walking skeleton → v1 demo. |
| `05-stack.md` | Stack decisions and why: TypeScript on Node, pnpm, Vite, React. |
| `06-interface.md` | The interface: columns for reading paths, a rail for the tree's shape. |
| `the-jujutsu-repo.md` | The jj repo the host serves: what Pineta writes there, and how jj and jjui see it. |
| `pineta.md` | Handoff: where the project is, and how to pick it up. |
| `findings/` | Spikes, one file each: the open unknowns with their kill criteria, and the answers with their evidence. |

## How to use this

Nothing stays an open unknown. Every uncertainty is either:

- **a decision** → goes in `adrs/` as an ADR, one file each, or
- **an unknown** → goes in `findings/` as its own file, with a kill criterion.

When a spike resolves, its file gets its answers, and an ADR if it decides
something. How a spike is written and numbered: `findings/README.md`. How an
ADR is written, amended and superseded: `adrs/README.md`.

## Status

The walking skeleton runs end to end and the stack is complete (TypeScript,
pnpm workspace, Vite, React, Vitest, Biome, Playwright). Three spikes are
open, none blocking: S6, S10 and S15. `rg -l '^\*\*Status:\*\* Open' docs/findings`
lists them. Next is the roadmap's thickening sequence in `04-roadmap.md`.

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
