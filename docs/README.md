# Pineta — Plans

A collaborative agentic harness: pi's agent core + Kyneta's CRDT substrate,
with a conversation **tree** as the primary object rather than a transcript.

## Documents

| File | Purpose |
|---|---|
| `00-vision.md` | What we are building and why. Product thesis. |
| `01-architecture.md` | Layer cake, thin waist, data model, evidence base. |
| `02-decisions.md` | ADR-0001..0008. Decisions already made, with rationale. |
| `03-spikes.md` | Open unknowns as falsifiable, time-boxed experiments. |
| `04-roadmap.md` | Sequencing: spikes → walking skeleton → v1 demo. |

## How to use this

Nothing stays an open unknown. Every uncertainty is either:

- **a decision** → goes in `02-decisions.md` as an ADR, or
- **an unknown** → goes in `03-spikes.md` with a kill criterion.

When a spike resolves, it becomes an ADR and is struck from the spike list.
When an ADR is reversed, it is superseded in place, never deleted — the
rejected reasoning is the valuable part.

## Status

Pre-implementation. No code written. Spikes S5, S2, S7 are the gate.

## ⚠️ Note on location

These plans live in `docs/`, and `.gitignore` excludes `.jj`. **They are
not tracked by jj and will not be versioned, shared, or backed up.** That is
fine for scratch planning, but if these are meant to be durable or
collaborative, move them to `docs/plans/` or `plans/` at the repo root.
See `04-roadmap.md` § Open process questions.
