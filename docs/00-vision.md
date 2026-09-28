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
*Superseded by ADR-0032 and ADR-0034: every agent lane is a Linux container
on its own disk, holding its own jj repo, and a branch clones its parent's
disk at the turn it branched from. So every agent lane is a Worktree and an
Aside is a conversation thread. Its effect merge is a jj merge whose
conflicts the agent resolves (ADR-0033).*

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

## Humans in the tree

People working with an agent also talk to each other, and that talk belongs in
the tree: a human message is an entry, and a thread is a branch. That puts it
in E, and in no agent's T until an agent is asked.

The distinction that organises it is **obligation**, not identity. A
*collaborator* may reply when they choose, human or bot. A *compelled
responder* must reply, and only an agent can be one: nobody can make a person
answer. `@agent` compels the agent; `@alice` addresses Alice, and leaves the
agent out.

A thread's mode is whether the agent works in it. Where it does, it answers
every message that names no one else; in a **conversation** it answers when
mentioned. Nothing sets the mode: it is whether the agent has been asked there
(ADR-0021). Each step up in cost is deliberate: a message costs nothing, asking
the agent spends time and money, and a workspace spends disk. So a session
begins with a choice, **Start Chat** or **Start Agent**, and a branch starts as
a conversation.

The composer says what will happen **before** sending: whether the agent will
reply, or who the message is for. Writing alone or together is a
separate choice from who must answer; a note is just a message that compels
nobody.

## v1 scope

**In:** browser client over Kyneta against a local pi host; tree visualisation
and navigation; Aside and Scout branches running concurrently; references as a
first-class entry type; multi-writer composer and references.

**Out:** Worktree branches and effect merge; remote/team networking (designed
for, not shipped); replacing pi's TUI.

**Designed for but not built:** fold. The tree must be able to *represent* a
merge node (`fromId` alongside `parentId`) from day one — retrofitting a second
parent edge is painful; allowing it now is free.

## What the tree adds, stated precisely

Two sets:

- **E** — every entry that exists in the conversation.
- **T** — the entries on the current tip path, which is exactly what is sent to
  the model on the next turn. `T` is always a subset of `E`.

In a normal chat tool these are identical: if a message exists, the model sees
it. There is no way to have something exist without it costing tokens and
steering the next reply.

Pineta's purpose is to let them differ, and to let you control what moves
between them. An Aside is an entry in `E` but not in `T` — real, shared,
durable, costing the trunk nothing. A fold is the deliberate act of moving part
of `E` into `T`.

**A transcript forces "exists" and "is in context" to be the same thing;
Pineta separates them.**

Everything else serves that. The CRDT makes `E` shared across people and
devices. `parentId` defines which subset counts as `T`. ADR-0010's three-way
fold is the rule for moving something from `E` into `T` well. The UI draws `T`
onto `E` so the boundary is visible before you spend anything.

## The v1 demo

Two browser windows, one pi host, one conversation tree. Window A runs a long
task on trunk. Window B branches an Aside off an assistant message three turns
back, asks a clarifying question, gets an answer, attaches a reference — and it
appears live in Window A's tree **without a single token entering A's context.**

Multi-writer, live presence, concurrent lanes, and context isolation, all in one
frame. Reachable without solving merge.
