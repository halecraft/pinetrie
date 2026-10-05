# S26 — notes and fold

**Answers.**
1. **A `json` session and Yjs note documents live on one Exchange.** Two people
   typing into one note at once merge on the host and on both clients. The
   session's record of the note reaches clients. The note's document exists
   before any entry does (a draft). A restart over one SQLite store brings back
   both the session and the note's text.
2. **Per-document write permission works through a Kyneta policy.** A
   `canAccept` gate that refuses the session and allows `note:` documents kept a
   client's write to the session off the host. The client still shows its own
   refused write locally, so the rule protects the host, not the client's view.
3. **Who wrote a note's text is carried by the text itself.** Kyneta derives
   each peer's Yjs `clientID` from its peer id (`hashPeerId`, FNV-1a), so every
   operation names its author, relayed or not. The host, watching its own copy
   of a note, attributes each change and each character to a writer. The
   transport is the wrong place: a changeset says only `origin: "sync"`, and
   `canAccept` fires for every peer that syncs, readers included (see the
   addendum).
4. **A fold can enter a lane two ways, and both work:**
   - **pi's own merge message:** a lane accepts a `branchSummary` message
     through `appendMessage`, with no run. pi stores its `fromId` in the message,
     and the model sees *"The following is a summary of a branch that this
     conversation came back from: …"*. That wording is pi's, written for
     returning from a branch;
   - **a pine·trie chat message** run as the prompt (S19's path), whose details keep
     the source's `fromId`. The model sees the fold text, and replies.
5. **pi already computes a common ancestor and writes merge summaries.**
   `collectEntriesForBranchSummary` finds the deepest common ancestor of two
   tips; `generateBranchSummary` summarizes entries with custom instructions. pi
   writes a `branch_summary` entry only while navigating a lane, which pine·trie
   never does (ADR-0020).
6. **A model can use a note's changes as hunks.** With a live model, told a
   note's changed paragraphs (each with the paragraph before it), it named what
   changed and what to do differently, 2 of 2 runs. So did the whole revised
   note, 2 of 2. At this size hunks save tokens; they matter more as notes grow.

## Why it was asked

Notes are collaborative messages: any message can be opened for editing, and a
thread's next instruction can be drafted together. Their text lives in a Yjs
document per note; their state (draft, open, done), in the session. A fold
brings what one line has and another lacks into it, synthesized by the agent.
Each needed checking against Kyneta and pi before the design was committed.

## Result

**Probe A (Kyneta).** A host `Exchange` with a SQLite store and a policy; three
clients over the bridge transport (in which every peer reaches every other).

| check | result |
|---|---|
| a client sees the session's record of a note | yes |
| two clients typing at once into a note | merged on host and both clients |
| a client's write to the session | refused by `canAccept`; still shown on that client |
| restart over the same store | session record and note text both restored |
| `canAccept` calls, before anyone edits | one per peer that syncs, the reader included |
| a changeset imported by sync | `origin: "sync"`, no sender |

**Probe B (pi, scripted model recording its context).**

| route | stored as | the model sees | run |
|---|---|---|---|
| `lane.appendMessage(branchSummary)` | a message entry; `message.fromId` set, the entry's `fromId` column null | pi's "summary of a branch that this conversation came back from" | none |
| a `pinetrie.chat` message as the prompt | a message entry; `details.fold.fromId` | the fold text | yes, the agent replies |

**Probe C (live model, `cerebras/qwen-3.8-27b`).** A lane took a note's first
version, then was folded its second, where one paragraph reversed a decision.

| sent | right | prompt |
|---|---|---|
| changed paragraphs, each with the one before | 2 / 2 | 487 chars |
| the whole revised note | 2 / 2 | 524 chars |

## Consequences

1. **The substrates split as ADR-0023 says**, with no new mechanism: notes are
   Yjs documents on the host's Exchange and store; the session holds their
   records; a policy keeps clients to note documents.
2. **A note's contributors come from its own operations:** the host maps each
   `clientID` that changes back to a writer by hashing the peer ids it knows. No
   command and no Kyneta change are needed, and it is right under relays.
   Attribution is as trustworthy as peer identity, which clients choose today; a
   peer can write under another's `clientID`, as it can claim another's peer id.
   A first-hop check needs the sender of each import, which Kyneta knows
   (`fromPeerId` in `sync/doc-imported`) but does not expose; it belongs with
   authenticated identity.
3. **Fold has two parts: synthesis, and landing on the lane.** pi offers both:
   `collectEntriesForBranchSummary` and `generateBranchSummary` for the
   synthesis, a `branchSummary` message for landing it without a run. Or the
   fold lands as a chat message the agent runs on. Which is the plan's decision;
   pi's wording for the summary message is written for a different situation.
4. **pi's common ancestor is not enough on its own.** It follows parent edges
   only. After one fold, the next must also follow `fromId` edges (pine·trie's set
   difference), so repeated folds take only what is new.
5. **Hunks are worth sending**, with the paragraph around each change; a small
   note can be sent whole.

## Addendum: authorship in the operations

A fourth probe, D: a host and three clients on one Yjs note.

| check | result |
|---|---|
| each peer's `clientID` equals FNV-1a of its peer id | yes, all three |
| the host, on its own note (`afterTransaction`), counts whose clocks moved | ada 16, bea 15: exactly their insertions |
| who wrote which text, from the document's items | "Ada wrote this. " → ada, "Bea wrote this." → bea |
| attribution survives relays (every bridge peer reaches every other) | yes |
| a peer that sets another's `clientID` and writes | accepted as that peer's |

Kyneta's `createDocAs` documents the intent: "the document's operations will
be exported and attributed to a named peer". Probe A's conclusion that the
transport cannot say who edited stands; it is simply the wrong layer.

## Addendum 2: a refused write to a note

Measured through pine·trie's host, once notes were built (`PLAN-2026-09-27-notes`):
a client writes to a note that is done, which the host's policy refuses; the
note is reopened; the same client writes again.

| check | result |
|---|---|
| the refused write, on the host | absent |
| the refused write, on the client that made it | present |
| that client's next write, after reopening, on the host | absent: it builds on the refused one |

A refused write splits that client's replica of the note from the host's for
good. The screen never offers a done note for editing, so this needs a client
that writes directly.

## Not tested

- Yjs rich text through Kyneta (notes start as plain text).
- A client-to-host topology: the bridge let every peer reach every other.
- A fold's synthesis quality on a real branch of messages (S5 measured fold
  quality; the new part here is notes).

## Method

Three disposable probes, not checked in: A through Kyneta (a host `Exchange`
with a SQLite store and a policy, clients over the bridge transport); B through
pi's harness with a scripted model that recorded the context it was given; C
through pi's harness with a live model. Each check ran at least twice.
