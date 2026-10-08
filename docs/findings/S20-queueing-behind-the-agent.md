# S20 — can a compelled message wait its turn behind the agent?

- **Status:** Answered
- **Led to:** ADR-0020, ADR-0026

**Answer: yes, with pi's own queue: `Lane.followUp`, with the harness option
`followUpMode: "one-at-a-time"`.** A chat message queued while the agent is
replying waits in the document, where every replica can see it, then runs by
itself after the current reply, at the thread's new end, as the prompt itself.
With the default mode, several queued messages are answered together in one
reply instead.

## Why it was asked

ADR-0019: a busy agent queues; it never grows more lanes. A compelled message
that finds the agent answering someone else must wait its turn on the same line
of work, and the people waiting must be able to see the queue. The question was
whether pi's queue does this with a chat message (a pi `CustomMessage`, S19) as
the prompt, or whether the host must keep its own.

## Result

Each trial: the agent lane runs Alice's compelled chat; while it runs, Bob's is
queued. The real stack: `KynetaStorage`, `StorageBackedSession`,
`createAgentHarness`, a live model. Two runs, identical.

| | `nextRun` | `followUp` |
|---|---|---|
| accepted while the agent runs | yes | yes |
| visible while waiting | yes: a `pi.pending.entry` value in the document | yes: the same |
| runs by itself after the current reply | **no**; `prompt([])` then runs it | **yes**, in the same operation |
| attaches at | Alice's reply (the thread's new end) | Alice's reply |
| entries for Bob's message | exactly one, role `custom` | exactly one, role `custom` |

Two messages queued behind Alice (Bob, then Carol), with `followUp`:

| `followUpMode` | the path |
|---|---|
| `"all"` (pi's default) | `Alice, reply, Bob, Carol, reply`: one reply to both |
| `"one-at-a-time"` | `Alice, reply, Bob, reply, Carol, reply`: each answered, in order |

The mode is a harness option (`AgentHarnessOptions.followUpMode`, default `"all"`
in `runtime/harness.js`); `selectAcceptedInbox` in `runtime/lane.js` takes one
follow-up per turn under `"one-at-a-time"`.

## Consequences

> **Superseded in part by S21.** A thread's messages must reach a running lane
> in send order, plain ones included, and a plain message appended to a running
> lane lands somewhere that depends on timing. The host therefore keeps one
> ordered outbox per thread and writes to a lane only when it is idle, instead
> of queueing with `followUp`. The measurements below still hold.

1. **Queue with `followUp` and `followUpMode: "one-at-a-time"`.** Each person who
   compelled the agent gets their own reply, in the order they queued, with the
   earlier exchanges in context. Batching would answer several people with one
   reply, which breaks the promise each composer made.
2. **The queue is already shared state.** Waiting messages are `pi.pending.entry`
   values in the replicated document, so every window can show who is waiting
   without the host keeping a second record.
3. **`followUp` queues where the agent's lane IS.** It is the right queue only
   when the waiting message belongs to the thread the agent is answering in. A
   message compelling the agent in another thread cannot use it: it would run
   in the wrong thread. That case needs a host-side wait: hold the message, and
   when the agent is free, attach its lane there and run (ADR-0019: one line of
   work, answering one thing at a time).
4. **`nextRun` is the wrong tool here.** It waits for someone to start the next
   run, so the host would have to notice the end of every run and call
   `prompt([])`, which `followUp` does by itself.

## Method

A disposable probe in `packages/pi`, not checked in, run twice with `node`
against a live model, using pi's public `Lane.followUp` and `Lane.nextRun` and
the `followUpMode` harness option.
