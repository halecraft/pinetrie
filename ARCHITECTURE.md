# Architecture

pine·trie is a coding agent whose conversation is a tree. People branch from any
message, work in the same tree together, and take the agent's file changes
when they are ready. The detail is in `docs/01-architecture.md` and the ADRs
in `docs/adrs/`.

```
browser ──commands (Kyneta Line)──▶ host ──▶ pi agent core
   ▲                                  │
   └──── session document ◀───────────┤ (pi's Storage, over Kyneta)
                                      │
                                      └──▶ lanes: a container, disk and jj repo each
```

- **The host** runs the one pi harness and is the only writer of the session
  document. Clients read the document and send commands.
- **A command** is decoded, planned by a pure function into a decision, and
  executed in one serial step.
- **The tree** is entries linked by `parentId`. A branch is a new entry with an
  earlier parent. What the model sees is the path to a tip.
- **A lane** is a thread's line of agent work: a Linux container on its own
  disk, where pi's tools run. A branch clones its parent's disk. A lane's work
  reaches your repo as an offer, a single commit you can review first.

## Packages

| package | role |
|---|---|
| `core` | pure types and decisions; depends on nothing |
| `schema` | the document's shape |
| `pi` | the only package that imports pi: the scribe, the person's pi setup, and the agent |
| `protocol` | the wire contract |
| `rules` | each stored shape and the pure rules about it |
| `reads` | document reads shared by host and client |
| `lanes` | containers, disks, jj and git |
| `client` | the browser UI |
| `apps/pinetrie` | the host; its shell is split by responsibility (`apps/pinetrie/host/TECHNICAL.md`) |
