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

## Two kinds of thread

Branches are not one thing. Cost and machinery follow from *capability*:

| Kind | Context | Tools | Workspace | Merge |
|---|---|---|---|---|
| **chat** | its path | none | none | fold-in (optional) |
| **agent thread** | its path | full | a lane of its own | fold-in **+** its proposed changes |

A chat is people talking in the tree, with no agent asked there;
it costs nothing. An agent thread has a lane (ADR-0032, ADR-0034): a
Linux container on its own disk, holding its own copy of your repo, and a
branch clones its parent's disk at the turn it branched from. Its file
changes come back as proposed changes, which you review and accept; a
catch-up that conflicts is resolved by the agent, or by you (ADR-0033).
There is no read-only kind between the two: every agent's lane has its own
copy, so none needs a shared one.

## Merge is three problems, not one

This distinction drives the whole architecture:

1. **Structural merge** — two peers append under different parents; the tree
   converges. *Free from CRDTs. Not where the work is.*
2. **Context merge** — what text enters the model's context when a branch
   lands. *The actual product problem.* Solved by a destination-aware,
   LLM-mediated three-way fold (see `01-architecture.md` § Fold).
3. **Effect merge** — filesystem/world side effects of a branch that ran tools.
   Each agent's thread works in its own lane, and its work reaches your repo
   as proposed changes; catching up merges what moved on, by jj, or by
   pine·trie's own path merge in a folder project (ADR-0142). Coupling a
   file merge to a fold's context merge waits for fold.

## References, not annotations

A conversation should be able to point at anything discussed — a span of an
earlier message, a file range, an image region, a URL, another branch. This
makes the conversation a **hypertext**, not a transcript.

Two orthogonal graphs over the same nodes:

- `parentId` — *causal* lineage (what followed what)
- references — *semantic* links (what concerns what)

Most of the interesting UI lives in the second.

The first implementation, a cite tool whose references showed only as counts,
was withdrawn (ADR-0043): nothing read them. Semantic links wait for fold,
which will say what it needs to point at.

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
every message that names no one else; in a **chat** it answers when
mentioned. Nothing sets the mode: it is whether the agent has been asked there
(ADR-0021). Each step up in cost is deliberate: a message costs nothing, asking
the agent spends time and money, and a lane spends disk. So a new canvas's
thread begins with `@agent ` typed, which a person deletes to make it a
chat, and a branch from a chat starts as a chat (ADR-0158).

The composer says what will happen **before** sending: whether the agent will
reply, or who the message is for. Writing together is a separate choice
from who must answer: a note, in a note column on the canvas, is
read by everyone in the canvas and by no agent (ADR-0116).

## Scope

**Built:** a browser client over Kyneta against one pi host; the tree,
drawn as a rail beside columns; threads of people and agents running at
once, each agent's in a lane of its own; their proposed changes, reviewed
and accepted into accepted work; a team's board of canvases, live across devices.

**Out:** replacing pi's TUI. Hosted, authenticated teams are designed for
and not shipped: today the invite key decides who gets in.

**Designed for but not built:** fold, which ADR-0168, proposed, would
shelve. The tree can *represent* a merge
node (`fromId` alongside `parentId`): retrofitting a second parent edge
would be painful, allowing it was free. References were built and
withdrawn (ADR-0043), so nothing points into the tree yet.

## What the tree adds, stated precisely

Two sets:

- **E** — every entry that exists in the conversation.
- **T** — the entries on the current tip path, which is exactly what is sent to
  the model on the next turn. `T` is always a subset of `E`.

In a normal chat tool these are identical: if a message exists, the model sees
it. There is no way to have something exist without it costing tokens and
steering the next reply.

pine·trie's purpose is to let them differ, and to let you control what moves
between them. A side conversation is an entry in `E` but not in `T` — real, shared,
durable, costing the trunk nothing. A fold is the deliberate act of moving part
of `E` into `T`.

**A transcript forces "exists" and "is in context" to be the same thing;
pine·trie separates them.**

Everything else serves that. The CRDT makes `E` shared across people and
devices. `parentId` defines which subset counts as `T`. ADR-0010's three-way
fold is the rule for moving something from `E` into `T` well. The UI draws `T`
onto `E` so the boundary is visible before you spend anything.

## The demo

Two browser windows, one pi host, one conversation tree. Window A runs a long
task on trunk. Window B branches off an assistant message three turns back,
asks a clarifying question and gets an answer, and it appears live on
Window A's rail **without a single token entering A's context.**

Multi-writer, live presence, concurrent lanes, and context isolation, all in one
frame, with no merge.
