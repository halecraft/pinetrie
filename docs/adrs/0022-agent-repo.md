# ADR-0022 — The agent works in its own repo, visibly, with the person's models

**Status:** Accepted. Evidence: S22, S23. Implemented by
`PLAN-2026-09-27-agent-tools`. Amended by ADR-0023:
the session is compacted, on `json.bind`. Amended by ADR-0032: the agent's
tools run in its lane's workspace, never in the repo the host runs from. Amended
by ADR-0042: admission also checks where a request comes from. Amended by
ADR-0044: a stream no longer closes when its message or tool ends. Amended by
ADR-0086: the repo the host runs from is the default project; `pnpm host
<folder>` names another.

**Context.** To use Pineta to build Pineta, its agent needs pi's editing
abilities: read, write, edit, and run commands. Pineta is shared, streamed and
now persisted, so those abilities must be safe to expose, visible while they
work, and cheap to store. The agent's model should be the person's own, which
for a Claude subscription works only through a pi extension (S23).

**Decision.**
- **The agent works in the repo it runs from.** pi-agent-core's `read`,
  `write`, `edit` and `bash` run in the repo root through `NodeExecutionEnv`.
  The development host gives them by default, since an agent without them
  cannot do the work it is asked for; `PINETA_TOOLS=0` turns them off. A host
  started from code (`startHost`) has none unless given a directory, so no
  suite runs commands by accident. There is no second
  checkout: Node loads the host's code once, jj keeps the agent's edits in a
  reviewable change, and hot reload is off, so the agent's edits to the client
  never reach an open page mid-run.
- **Loopback by default; an invite key anywhere else.** The host binds to
  `127.0.0.1` unless `PINETA_BIND` says otherwise. Off loopback, nothing gets
  in without the key: no page, no file, no WebSocket. The key comes as an
  invite link (`?key=`), which sets an `HttpOnly` cookie and redirects to the
  page without it. Hot reload runs on loopback only, because Vite's socket
  would bypass admission. *Since ADR-0042, a request whose `Origin` names
  another host is refused, key or no key, and a loopback host refuses a
  `Host` that is not a loopback name: without a key, any page in the
  person's browser could otherwise open the WebSocket.* Two limits:
  - The key decides who gets in, not who is who. A person is the email their
    client names (ADR-0037), unverified, so a collaborator can pose as
    another. Per-person invites are for the presence work.
  - The key crosses a network in the clear. That is fine on a trusted network
    or a tunnel; the open internet needs a TLS-terminating proxy.
  - With tools on, anyone with the link can run commands on the machine as the
    host's user. The host says so at startup.
- **Models come from the person's pi setup.** pi's own `SettingsManager` and
  `DefaultResourceLoader` load the person's packages, and only the extensions'
  provider registrations are applied to Pineta's `ModelRuntime`. The settings'
  default model is used unless `PINETA_PROVIDER`/`PINETA_MODEL` override it.
  The system prompt is pi's `buildSystemPrompt`, with the repo's `AGENTS.md`
  and the person's skills. Suites never use this: they name their model, or
  script one.
- **Replies and tool output are one kind of stream, written as text edits.** A
  stream is a record (`streams`) and a text (`streamText`), keyed by a fresh id.
  A reply stream opens on its message's first text and closes when the message
  ends; a tool's opens and closes with the tool. *Since ADR-0044, neither
  closes when it ends: a stream goes once its entry is written.* A tool's output arrives as
  snapshots of a view that keeps only the tail, and is written with `tailEdit`:
  cut the front, append the end. pi's own tool-output checkpoints are stored the
  same way (`checkpointText`).
- **A stop control** ends a thread's running turn (`lane.abort`); messages
  waiting for the lane are then taken as usual.
- **The session persists** in a Kyneta SQLite store over `node:sqlite`
  (`.pineta/pineta.db` by default). A starting host clears every stream and run,
  then drains held messages. A later change to the document's root schema
  cannot open an existing store: migrate it, or start a new file.

**Consequences.**
- While a tool runs, its output is in the document twice: as the live stream,
  and as pi's checkpoint; compaction clears both when the run ends (ADR-0023).
  The two could share one text if pi's `tool_update` carried the checkpoint's
  key (`operationId`/`invocationId`); that is an upstream request.
- Kyneta's store repeated bytes when a commit landed while another was being
  written (S22 addendum: 133 KB of 345 KB in one run). Fixed in Kyneta and
  verified from Pineta; until `compact()` works on a live Loro substrate, every
  tool run still grows the store for good.
- Two threads running tools at once share the repo and can collide. Accepted
  until a workspace per lane (ADR-0019). A sandbox for `bash` is a later step.

**Alternatives rejected.** pi-coding-agent's tools and `AgentSession` (they
bring the coding agent's session and extension runtime). A second checkout
(turning hot reload off gives the same safety with one). Whole-value streams
(S22: 45× the bytes). Loading extensions fully (only providers are needed).
Suppressing pi's checkpoints (they are its crash recovery). Loopback only, with
tunnels for sharing (a collaborator on the network should need only a link).
