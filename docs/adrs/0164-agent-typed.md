# ADR-0164 — Every new thread that asks the agent says so with `@agent ` typed; no column asks with nothing typed

- **Status:** Accepted (Duane, 2026-10-17)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`,
  `packages/rules/TECHNICAL.md`
- **Amends:**
  - ADR-0021: Start Agent is gone: a thread with no lane asks the agent only
    through a mention.
  - ADR-0138: ＋'s agent thread past a canvas's last column opens with `@agent
    ` typed, as a new canvas's thread does.
  - ADR-0158: a new canvas and ＋'s agent thread start the same way.

**Context.**

- **Two ways to ask from a thread with no lane.** A branch from an agent
  thread and a new canvas's thread (ADR-0158) open with `@agent ` typed, so
  the message itself asks. ＋'s agent thread past a canvas's last column
  carried a flag instead (`asksAgent`, ADR-0021's Start Agent): a message
  naming no one asked the agent, though nothing in it said so.
- **The flag reached every layer**: the intents, the stored layout, the
  column, the send's options, the wire, and the host's rule for who a
  message is for (`agentByDefault`), for the one column that set it.
- **A message that asks unseen surprises a reader.** Another person reading
  the thread sees a message with no mention that the agent answered.

**Decision.**

- **＋'s agent thread opens with `@agent ` typed** (`AGENT_PREFILL`), as a
  new canvas's thread and a branch from an agent thread do. Deleting it
  makes the thread a chat. ＋'s ▾ chat opens with nothing typed.
- **A message with no mention asks the agent only in a thread with a lane**
  (`agentByDefault`), and never in a branch or at the root. Everywhere else
  the agent is asked by `@agent`, or by a command.
- **`asksAgent` is removed**: from the send, the wire, the session's send
  options, the column, the stored layout and `NewColumn`, whose thread is
  made as `{ opens: "agent" | "chat" }`.
- **The WIP line leaves out a leading `@agent `**: it says only who was
  asked, and every new thread's first message now starts with it.

**Consequences.**

- **Every message that asks the agent shows it**: `@agent`, a command, or a
  reply in an agent thread.
- **A first message reads `@agent fix it`** in its column, its canvas's
  title prompt and its search. A scenario names a message by what it typed
  after the prefill (`idOfText`, the e2e harness).
- **A layout stored by an earlier build is dropped by its version** (`v:
  10`, `packages/interface/layout.ts`), with any `asksAgent` it held: each
  tab's folds start fresh once.

**Alternatives rejected.**

- **Keeping `asksAgent` for ＋'s agent thread alone**: a second mechanism,
  through six layers, for one button, and a message that asks unseen.
- **Stripping `@agent ` from a first message as it is sent**: the message
  would ask while its text did not say so, the same surprise.
