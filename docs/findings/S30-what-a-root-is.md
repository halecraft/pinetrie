# S30 — what a root is, for a thread started at the root

**Answers.**
1. **A thread started at the root is rooted at its first message**, whether
   it is a conversation or agent work (measured). Start Chat appends the chat
   at `ROOT`; Start Agent creates the thread's lane at `ROOT` and runs the chat
   as its prompt. Either way, the chat is the entry with no parent, and
   `indexTree` reports it among `roots`. Three threads gave three roots, each
   a `pinetrie.chat` message.
2. **pi writes nothing above it** (read from pi's source). Creating a lane
   writes only the `pi.branch.tip` value, with no entry. `model_change` and
   `thinking_level_change` appear only in pi-agent-core's legacy v3 JSONL
   reader (`dist/harness/session/jsonl/legacy-v3.js`). The harness appends
   every entry under a lane's tip.
3. **So a root tab can be keyed by the root entry's id**, and labelled by the
   first message in its tree (ADR-0029). The first rail row of the tree is
   that message, even if some later build puts a non-message entry at the
   root, since `projectRail` passes through non-message entries.

## Why it was asked

ADR-0029 gives each root its own tab. If pi wrote a shared entry at the root,
such as a session header, every thread would hang under one root and a tab per
root would be a single tab. If it wrote a per-lane bookkeeping entry, the
tab's key and its label would come from different entries.

## Result

| thread | root entry | in `roots` |
|---|---|---|
| Start Agent ("first agent thread") | the chat, role `chat` | yes |
| Start Chat ("a chat at the root") | the chat, role `chat` | yes |
| Start Agent ("second agent thread") | the chat, role `chat` | yes |

Five entries in all: three chats and two agent replies, each reply the only
child of its chat. Two lanes, each with its tip at its reply. No orphans.

## Not tested

- A real model, or the person's pi setup. Both go through the same
  `harness.lane(name, { createAt })` and `run` path as the scripted model.
- Compaction entries (ADR-0023) and `branch_summary` from fold. Both are
  written under an existing tip, not at the root.

## Method

`sandbox/s30-roots/probe.ts`, copied into `apps/pinetrie/e2e/` to run (the
workspace resolves `@pinetrie/*` only from a package that declares them) and
deleted afterwards. It starts a host with a scripted model, sends Start Agent,
Start Chat and Start Agent at `ROOT` from one client, waits for the runs, then
prints `readTreeIndex(host.doc)`'s roots with each tree below them.
