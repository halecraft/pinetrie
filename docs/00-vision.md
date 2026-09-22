# Vision

## The problem

Every mainstream coding agent models a conversation as an **append-only linear
transcript**. That single design choice creates the friction we actually feel:

- You cannot ask a clarifying question without polluting the main context.
- You cannot explore a tangent without abandoning or derailing the trunk.
- You cannot edit an earlier message without destroying what came after.
- Two people cannot work in the same conversation at all.

The underlying interaction is *already* tree-shaped — every edit, retry, and
tangent is a branch. The interface just refuses to admit it.

## The thesis

Make the tree the primary object, and make it **multi-writer**.

1. **Local bifurcation.** Branch from any point. Run multiple branches
   simultaneously. Explore without cost to the trunk.
2. **Multiplayer.** The same tree, live, across devices and teammates.
3. **Merge.** When an exploration proves valuable, fold it back into the trunk
   — mediated by an LLM with full access to both divergent branches.

## Branch kinds

Branches are not one thing. Cost and machinery follow from *capability*:

| Kind | Context | Tools | Workspace | Merge |
|---|---|---|---|---|
| **Aside** | full prefix | none | none | fold-in (optional) |
| **Scout** | full prefix | read-only | shared, read-only | fold-in |
| **Worktree** | full prefix | full | isolated (jj) | fold-in **+** file merge |

Aside and Scout are pure conversation-tree operations and need no effect-merge.
They cover most daily use. **Worktree is deliberately out of v1.**

## Merge is three problems, not one

This distinction drives the whole architecture:

1. **Structural merge** — two peers append under different parents; the tree
   converges. *Free from CRDTs. Not where the work is.*
2. **Context merge** — what text enters the model's context when a branch
   lands. *The actual product problem.* Solved by a destination-aware,
   LLM-mediated three-way fold (see `01-architecture.md` § Fold).
3. **Effect merge** — filesystem/world side effects of a branch that ran tools.
   *Genuinely hard.* Requires isolated workspaces and a real jj merge, coupled
   atomically to the conversation merge. **Out of v1.**

## References, not annotations

A conversation should be able to point at anything discussed — a span of an
earlier message, a file range, an image region, a URL, another branch. This
makes the conversation a **hypertext**, not a transcript.

Two orthogonal graphs over the same nodes:

- `parentId` — *causal* lineage (what followed what)
- references — *semantic* links (what concerns what)

Most of the interesting UI lives in the second.

## v1 scope

**In:** browser client over Kyneta against a local pi host; tree visualisation
and navigation; Aside and Scout branches running concurrently; references as a
first-class entry type; multi-writer composer and references.

**Out:** Worktree branches and effect merge; remote/team networking (designed
for, not shipped); replacing pi's TUI.

**Designed for but not built:** fold. The tree must be able to *represent* a
merge node (`fromId` alongside `parentId`) from day one — retrofitting a second
parent edge is painful; allowing it now is free.

## The v1 demo

Two browser windows, one pi host, one conversation tree. Window A runs a long
task on trunk. Window B branches an Aside off an assistant message three turns
back, asks a clarifying question, gets an answer, attaches a reference — and it
appears live in Window A's tree **without a single token entering A's context.**

Multi-writer, live presence, concurrent lanes, and context isolation, all in one
frame. Reachable without solving merge.
