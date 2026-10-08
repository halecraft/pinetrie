# S19 — can the host append a chat message to a lane without a run?

- **Status:** Answered
- **Led to:** ADR-0018, ADR-0020, ADR-0048

**Answer: yes, through the lane. And chat is best a pi `CustomMessage`, not a
custom entry,** because then a message that compels the agent can BE the
agent's prompt (part B).

**Part A: `Lane.appendCustomEntry`, never `session.mutate`.** Writing the entry
through `session.mutate`, the way pi's own lane commits, stores it but loses it:
the writer's `Lane` object never sees the moved tip, so its next turn attaches to
the old tip and the chat entry drops out of the path without an error.

## Why it was asked

Humans in the tree (`PLAN-2026-09-26-humans-in-the-tree`) stores each human
message as a `pinetrie.chat` custom entry on its author's lane, appended by the
host with no model run. The host holds one pi `Lane` object per writer for the
life of the process, and S3 warned that a `Lane` is single-writer state that
caches. The question was whether a tip moved outside that object is seen by it.

## Result

Each trial runs one turn on a fresh lane, appends a `pinetrie.chat` entry by one
path, prompts the SAME `Lane` object again, and reads the new user message's
`parentId`. The stack is the real one: `KynetaStorage` over a Kyneta document,
`StorageBackedSession`, `createAgentHarness`, a live model. Two runs, identical.

| append path | entry stored at the old tip | `lane.getTipId()` after the append | next turn's parent |
|---|---|---|---|
| `session.mutate`: `insertEntry` + `setValue(branchTip(lane))` | yes | **the old tip** | **the old tip** (chat entry lost) |
| `lane.appendCustomEntry("pinetrie.chat", data)` | yes | the chat entry | **the chat entry** |
| control: no append | — | the old tip | the old tip |

The control shows the check tells the cases apart: the parent is only ever the
chat entry when the lane itself appended it.

**Navigation.** A chat entry written by `appendCustomEntry` is inside pi's
session, so it is a valid target. A lane created at it
(`harness.lane(name, { createAt: chatId })`) and a lane moved to it
(`navigateTree(chatId)`) both continue from it: each one's next turn has the chat
entry as its parent. Branching from a chat message works.

## Why `session.mutate` loses it

`Lane.command` plans every operation against its in-memory state, not the
stored tip:

```js
// pi-agent-core dist/harness/runtime/lane.js, Lane.command
const decision = await plan(this.state, mutator);
// ...
this.state = decision.next;
```

`this.state.tipId` changes only when the lane itself commits. A write through
`session.mutate` updates the stored `pi.branch.tip` but not `this.state`, so the
next `prompt` parents at the cached tip and overwrites the stored one.

`appendCustomEntry` goes through the same `command`, and commits
`insertEntry` + `setValue(branchTip)` + the lane state with
`next: { ...state, tipId: id }`, so the stored tip and the cached tip move
together.

## Consequences

1. **Chat is appended with `Lane.appendCustomEntry`, never `session.mutate`.**
   Any host write that moves a lane's tip must go through that lane.
2. **An append during the author's own run is queued, not lost.** With an
   operation in progress, `append` stores a pending write and adds it to the
   lane's inbox; the lane chains it in after the run (`lane.js`, `append`). A
   human can type while their own prompt is running.
3. **The silent-loss shape recurs.** Nothing throws: the entry exists in the
   session and is reachable by id, only not on the lane's path. A test must
   check the next turn's parent, not that the entry was stored.

## Part B: chat as a `CustomMessage`, and the compelled run

A custom entry cannot start a run. Every pi run begins with `prompt`, which
appends message entries (`OperationRequest` has no "run from the current tip";
`Lane.resume` only continues an operation already in progress). Compelling the
agent with a custom entry would therefore add a second, synthetic user message.

pi has a built-in `CustomMessage` (`role: "custom"`, `customType`, `content`,
`display`, `details`, in `harness/messages.d.ts`). The default
`toProviderMessages` (`convertToLlm`) sends it to the model as a `user` message
with the same `content`, and `prompt` accepts any `AgentMessage` except a pending
assistant message. So a chat message is a `CustomMessage` with
`customType: "pinetrie.chat"`, `content` the attributed text the model sees
("Alice: …"), and `details` the structured author and text.

Probe: Alice's chat is appended with `lane.appendMessage`; an agent lane is
created at it and prompted with Bob's chat. Two runs, identical:

| check | result |
|---|---|
| `appendMessage` on Alice's lane | one entry, no run; the tip is the chat; stored as a `message` entry, role `custom` |
| `agentLane.prompt(Bob's chat)` | one run; Bob's chat is the prompt entry (exactly one, role `custom`), parented at Alice's |
| the model saw both speakers | reply: "Alice told us the secret word was PLUM." |
| control: Alice's line absent from the path | reply: "I do not have any information about… a secret word." |

Consequences:

4. **No `entryProjectors`.** pi's own conversion puts chat in context; the
   speaker is in `content`, copied at write time.
5. **A compelled message is on the agent's lane.** It is the run's prompt, so
   the agent's lane appends it. A message that compels nobody is on its
   author's lane. Both are children of the position the author was viewing.
6. **One shape for all human messages.** Compelled or not, a chat message is the
   same `CustomMessage`; only the lane that appends it, and whether a run
   follows, differ.

## Method

Two disposable probes in `packages/pi`, not checked in, each run twice with
`node` against a live model. It used only pi's public exports (`@earendil-works/pi-agent-core`,
`@earendil-works/pi-agent-core/harness/session`) plus `createAgentHarness` via
`packages/pi/deep.ts`.
