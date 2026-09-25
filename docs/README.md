# Pineta — Plans

A collaborative agentic harness: pi's agent core + Kyneta's CRDT substrate,
with a conversation **tree** as the primary object rather than a transcript.

## Documents

| File | Purpose |
|---|---|
| `00-vision.md` | What we are building and why. Product thesis. |
| `01-architecture.md` | Layer cake, thin waist, data model, evidence base. |
| `02-decisions.md` | ADR-0001..0018. Decisions already made, with rationale. |
| `03-spikes.md` | Open unknowns as falsifiable, time-boxed experiments. |
| `04-roadmap.md` | Sequencing: spikes → walking skeleton → v1 demo. |
| `05-stack.md` | Stack decisions and why: TypeScript on Node, pnpm, Vite, React. |
| `06-interface.md` | The interface: columns for reading paths, a rail for the tree's shape. |
| `pineta.md` | Handoff: where the project is, and how to pick it up. |
| `findings/` | Spike and probe results, each with its evidence. |

## How to use this

Nothing stays an open unknown. Every uncertainty is either:

- **a decision** → goes in `02-decisions.md` as an ADR, or
- **an unknown** → goes in `03-spikes.md` with a kill criterion.

When a spike resolves, it becomes an ADR and is struck from the spike list.
When an ADR is reversed, it is superseded in place, never deleted — the
rejected reasoning is the valuable part.

## Status

The walking skeleton runs end to end and the stack is complete (TypeScript,
pnpm workspace, Vite, React, Vitest, Biome, Playwright). All twelve spikes are
resolved. Next is the roadmap's thickening sequence in `04-roadmap.md`.

## Where documents live

Two tiers, with different lifetimes:

| | | |
|---|---|---|
| `docs/` | **tracked** | Architectural reference. Vision, architecture, ADRs, spike findings, stack decisions. Long-lived: these explain *why the system is shaped as it is*. |
| `.jj/plans/` | untracked | Implementation plans, one per change, named `YYYY-MM-DD-slug.md`. Short-lived: they describe *work to be done* and are spent once done. |

An implementation plan may cite anything in `docs/` or any source path. It must
**not** cite anything under `.jj/`, since that is not shared — a plan has to be
readable by someone who only has the repository.

`.gitignore` excludes `.jj`, so plans are deliberately not versioned here.
`@halecraft/plans` will later store `.jj/plans/` in its own VCS namespace.
