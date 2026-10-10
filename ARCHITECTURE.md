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
- **The tree** is entries linked by `parentId`, each naming the thread that
  wrote it (ADR-0125). A branch is a new thread whose first entry has an
  earlier parent. What the model sees is the path to a tip.
- **A lane** is a thread's line of agent work: a Linux container on its own
  disk, where pi's tools run. Every thread's agent works in one; none works
  directly in a directory (ADR-0102). A branch clones its parent's disk. Lanes run
  on Docker, on btrfs snapshots: in pine·trie's own VM on the Mac, on the
  host on Linux (ADR-0130). A host with tools that cannot run them does not
  start. A lane's work
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
| `lanes` | what a lane is and what runs in it: its container's shape, mounts, grants, jj and git, forks, turns and bundles; it defines the `LaneRuntime` port and implements no runtime |
| `docker` | running lanes on Docker: the `LaneRuntime` over the docker CLI, btrfs disks in a helper container, Docker's startup refusals, lanes inside a lane |
| `vm` | a Linux machine on the Mac: the image's build, the launcher, a host's lease on a slot; it knows nothing of lanes |
| `session` | one client's connection to a host, its own documents and what it has in flight |
| `shell` | shell source as structure: a command's words by role, and a one-line command laid out to a width; it declares only `unbash` (ADR-0114) |
| `interface` | what a person sees and can do, decided, for any client: no React, no DOM (ADR-0093). A tool keeps its id for the model and has a word for people (`shell`, `search`), which interface gives; core holds only what a call is (ADR-0114) |
| `web` | the browser page: React and the DOM, drawing what `interface` decides |
| `apps/pinetrie` | the host; its shell is split by responsibility (`apps/pinetrie/host/TECHNICAL.md`). The one place that picks a runtime and wires `vm` to `docker` (`host/work/runtime.ts`) |
