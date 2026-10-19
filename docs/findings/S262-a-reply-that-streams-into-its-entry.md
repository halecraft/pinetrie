# S262 — can a streaming reply grow its own entry, by Kyneta's text edits, in place of pi's list of frames?

- **Status:** Answered (how many frames arrive in 100 ms is not measured)
- **Led to:** ADR-0188

**Question.** While a reply streams, pi-agent-core 0.99.2 commits each
frame pi-ai's `AssistantMessageFrameEncoder` makes to a list,
`pi.pending.assistant_frame` (`openFrameProgress`,
`dist/harness/runtime/progress.js`). It deletes the list once the reply's
entry is written whole (`drive/response.js`, `drive/terminal.js`). A frame
is already a diff: a `text_delta` or `thinking_delta` carries only the new
characters, a `toolcall_delta` a piece of the arguments' JSON, and a
block's start and end the block. In S263 (item 8), those appends were
11,539 of a running root's 13,717 stored ops: each one a record of about
0.4 KB, an op in the replica's log until compaction, and a sync to every
tab that holds the root. The reply is then written again whole as its
entry, and streamed a third time through `pinetrie:live`.

`KynetaStorage` already stores pi's tool-output checkpoints as text edits
rather than copies (`packages/pi/checkpoint.ts`). Can it do the same for a
reply: write its frames as Kyneta changes to one growing message, and
answer pi's reads of the list from that message?

1. **What pi needs back.** Recovery reads the list in order
   (`readAssistantFrames`) and folds it (`reduceAssistantMessageFrames`)
   into the message it marks interrupted (`drive/recovery.js`); a lane's
   projection reads it the same way (`lane.js`, `readStreamingMessage`).
   Does any reader need the frames themselves, or only what they fold
   to? Can `KynetaStorage` answer `readList` for this one namespace with
   frames that fold to the same message, while every other list keeps
   the element semantics pi's storage conformance suite checks
   (`dist/harness/session/testing/conformance/storage.js`)?
2. **Which frames map onto edits.** Text and thinking deltas onto a text
   insert; a block's start onto a new block. What does a thinking block's
   end (its signature) need, and a tool call's argument deltas, which are
   JSON pieces parsed only at the end?
3. **Where the growing message lives.** As the reply's own entry, created
   at the reply's start, so pi's final write of the entry finds it already
   there and writes nothing, or only what differs; or as a value of its own
   beside the entries, like a checkpoint's text, folded into the entry when
   pi writes it.
4. **What it costs, on a real reply.** Records, ops and bytes in the root's
   store for one reply each way: today's frames plus the entry; edits into
   one message; and edits held for 100 ms before each write, so a write
   carries several frames.

Measured in a lane with pi's scripted model and real frames: a stream of
replies replayed from frames recorded off a live run, so the deltas have
real sizes, through `KynetaStorage` over an in-memory store and a SQLite
one.

**Kill criterion.** The edits are dropped if any reader of the list needs
frames that a folded message cannot give back, or if recovery from a
crash midway through a reply gives a message other than today's. They are
not worth it if they leave a reply's stored records above a fifth of
today's.

**Throw away.** The probe and its stores. Recorded frames stay in a
folder of sources beside this file if a plan builds on them.

## Answers

Read from pi-ai and pi-agent-core 0.99.2, and replayed in a lane
(`replay.ts`) on a made-up reply of 109 frames: thinking in 60 deltas of
24 characters, text in 30 of 18, a tool call in 12 of 16. Duane's own
frames' shapes (`frames.ts`) came after (item 6). A first run on his Mac (2026-10-19) found no
frames in the four roots with the most records: a run's frames stay in
the store only until its end's compaction, so they are read while a lane
runs.

1. **Every reader needs only what the frames fold to.** Recovery and a
   lane's streaming view read the list in order (`readAssistantFrames`)
   and fold it (`reduceAssistantMessageFrames`); nothing else reads it.
   A folded message, with each block's state (ended or not, a tool call's
   raw JSON), can be given back as a few frames that fold to the same
   message: a start, then for each block its start with the text so far,
   and its end, or a tool call's checkpoint. Replayed, those rebuilt
   frames folded to the same message as the real ones after every one of
   the 109 frames.
2. **Every frame maps onto a change.** Text, thinking and tool-call
   deltas onto a text insert; a block's start and end, its signature and a
   tool call's id, name and arguments onto a small value set beside the
   text. A block's end repeats its whole text (`text_end`,
   `thinking_end` carry `content`); against the grown text it is no edit.
3. **Kyneta's change format does not make a small delta small.** One
   stored write of one frame cost about 300 bytes as a list append and
   about 235 as a text insert, for 18-24 characters of text: the op's
   path, its change's envelope and the record's own fields are most of
   it. Over the reply, edits stored 0.81 of today's bytes, mostly by not
   repeating a block's text at its end.
4. **The number of records follows the writes, not the format.** One
   write per frame is one record per frame either way. Several frames to
   a write cut both alike:

   | frames a write | today's records | edits' records | edits' bytes |
   |---|---|---|---|
   | 1 | 1.00 | 1.00 | 0.81 |
   | 2 | 0.51 | 0.51 | 0.78 |
   | 4 | 0.26 | 0.26 | 0.76 |
   | 8 | 0.14 | 0.14 | 0.75 |

   Frames kept outside the document altogether leave one record a reply,
   its entry: 0.01 of today's records, 0.10 of its bytes.
5. **How many frames a 100 ms window holds is not known.** Stored
   records carry no time. It needs the frames' arrival times from a live
   run.

6. **Duane's own replies agree** (2026-10-19, a second run while lanes
   ran: `mac-output.txt`, `mac-shapes.json`, shapes only). 13 roots held
   deltas; two running lanes' held 16 replies of 3 to 267 frames, 1,323
   frames in all, one stored record each. Most were tool-call argument
   deltas (710, 19 characters at the median: the agent writing files) and
   thinking deltas (526, 15 characters); text deltas were 18. Replayed:

   | way, frames a write | records | bytes |
   |---|---|---|
   | today, 1 | 1,339 (1.00) | 453 KB (1.00) |
   | today, 4 / 8 | 0.26 / 0.14 | 0.94 / 0.93 |
   | edits, 1 | 1.00 | 0.82 |
   | edits, 4 / 8 | 0.26 / 0.14 | 0.76 / 0.75 |
   | frames outside the document | 16 (0.01) | 0.07 |

   The rebuilt frames folded to the real ones' message after every one
   of the 1,323 frames.

7. **A scratch document beside the root holds pi's commits safely, in
   one order** (read from pi-agent-core 0.99.2). A commit that ends a
   reply writes the entry, its usage, the branch's tip and the
   operation's new state together with the frames' delete
   (`drive/response.js`, `settleOperation` in `runtime/lane.js`). A commit
   that adds pending data writes it with the state that points at it: a
   queued message's `pi.pending.entry` with the lane's inbox
   (`lane.js`). So each commit is safe split as the scratch document's
   sets, then the root's writes, then the scratch document's deletes: a
   crash between leaves pending data nothing points at, never a state
   pointing at pending data that is gone.
8. **Which namespaces may go there.** `pi.pending.assistant_frame` and
   `pi.pending.tool_output` belong to an operation, and its cleanup
   deletes them (`operationCleanupWrites`, `drive/terminal.js`).
   `pi.pending.entry` holds a queued message, which can wait in a lane's
   inbox past an operation: it stays in the root.
9. **`KynetaStorage`'s index can span two documents.** Its `seq` is
   local to the replica, never stored, and built by observing the
   document (`packages/pi/arrivals.ts`). One index observing both
   documents, with each write and read routed by namespace, keeps pi's
   seqs as they are. Kyneta's `destroy` deletes a document's records from
   the store and dismisses it to every peer.

**What it points to.** The reply as Kyneta changes works for recovery
and stores each reply's text once, but it does not meet the kill
criterion on its own: what the run's end pays for is records, and
records follow writes. Writing several frames at once meets it for
either format only at five or more frames a write, which depends on how
fast frames arrive. Keeping the frames out of the shared document meets
it outright, with one record a reply, and needs no change to what pi
reads.
