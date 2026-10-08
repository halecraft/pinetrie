# S21 — conversation threads with no lane, and a lane that is running

- **Status:** Answered
- **Led to:** ADR-0020, ADR-0026, ADR-0056, ADR-0080, ADR-0106

**Answers.**
1. **A message appended with no lane is a full member of the tree.** Another
   lane can navigate to it, a lane can be created there, and that lane's agent
   reads it.
2. **"Late goes after" is atomic when the thread's end is read inside
   `session.mutate`.** Five replies sent at once to one end form a chain;
   reading the end before the barrier (the control) makes five siblings.
3. **Never write to a lane while it runs.** A plain message appended through a
   running agent lane lands in one of three places, depending on timing: inside
   the agent's turn, as a prompt the agent answers, or after the reply while a
   queued question is never answered.

## Why it was asked

The design after ADR-0019: lanes exist only where agent work is wanted, never
move, and belong to threads rather than people. Conversation-only threads have
no lane, so the host appends their messages at the session level and must place
a late reply after an earlier one itself. In a thread with an agent lane, every
message goes through that lane so its cached tip stays true (S19). Three things
were unmeasured: whether a lane-less entry is a full member of the tree; whether
the host can append atomically; and what a person's message does to a lane that
is running.

## Result

The real stack: `KynetaStorage`, `StorageBackedSession`, `createAgentHarness`
with `followUpMode: "one-at-a-time"`, a live model. Q1 and Q2 were identical in
all three runs.

**Q1 — a lane-less thread, then the agent.** Two messages appended with
`session.mutate` + `insertEntry` and no lane ("the secret word is MANGO", then
"noted"):

| check | result |
|---|---|
| another lane navigates to the lane-less entry | ok |
| a lane is created at it | ok |
| that lane's first prompt is parented at it | yes |
| its agent answered from the lane-less messages | yes (it named MANGO) |

**Q2 — five replies at once to the same end.**

| where the end is read | most children of any entry |
|---|---|
| inside `session.mutate`, then insert | **1**: a chain |
| before the barrier (control) | **5**: five siblings |

`SessionMutation` is an exclusive barrier for the whole session, and lanes
commit through the same `mutate`, so a read and a write inside one callback
cannot be interleaved with any other pi write. The reader has no child lookup
(`scanBranch` walks up), so the end was found from the document's own index,
read inside the barrier.

**Q3 — Bob's plain remark appended through the agent lane while it answers
Alice, with Carol's compelled question queued by `followUp`.** Three runs:

| Bob's message arrived | path | wrong because |
|---|---|---|
| at run start (first run) | Alice → Bob → reply → Carol → reply | Bob is inside the agent's turn |
| at run start (runs two and three) | Alice → reply → Bob → reply → Carol → reply | the agent answered a message that compelled no one |
| mid-stream (runs two and three) | Alice → reply → Bob | Carol's question was never answered |

A write queued during an operation is taken into that operation's inbox
(`selectAcceptedInbox` accepts every `write`), so the agent loop may treat it as
input, and where it lands depends on the turn boundary it meets.

## Consequences

1. **Conversation threads need no lane.** The host appends their messages with
   `session.mutate`, finding the thread's end inside the barrier and writing
   after it. When agent work is first wanted, a lane is created at the end,
   and the lane-less messages are its context.
2. **A lane is written only when it is idle.** While a thread's lane runs, the
   host holds every message for that thread, plain and compelled, in send
   order, and drains them when it is idle: a plain message is appended through
   the lane; a compelled one is run, and its run completes before the next is
   taken. That one ordered outbox replaces both `followUp` (S20) and appending
   during a run, whose outcome depends on timing.
3. **The outbox is shared state.** Every window must see who is waiting, so the
   held messages belong in the document as pine·trie values, keyed by message id
   (ADR-0016), read in id order.

## Method

A disposable probe in `packages/pi`, not checked in, run three times with
`node` against a live model.
