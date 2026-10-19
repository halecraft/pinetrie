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
  start. A lane's work reaches your repo as proposed changes, a revision
  or a stack you review before you accept it.

## Packages

| package | role |
|---|---|
| `core` | pure types and decisions; depends on nothing |
| `schema` | the document's shape |
| `pi` | the only package that imports pi: the scribe, the model setup from pine·trie's config, sign-in, and the agent |
| `config` | pine·trie's config: settings declared with their rules, each layer's file decoded against them, and one pure settle; it declares only `core`, and only the app declares it (ADR-0146) |
| `protocol` | the wire contract |
| `rules` | each stored shape and the pure rules about it |
| `reads` | document reads shared by host and client |
| `lanes` | what a lane is and what runs in it: its container's shape, mounts, grants, disks, forks and snapshots; it defines the `LaneRuntime` port and a kind of project's ports (`LaneHistory`), implements neither, and runs no jj |
| `lanehost` | what the host asks of the machine its lanes' disks are on, outside any lane (ADR-0129): one protocol, server and client, a module per role; it declares only `core` and `channel`, and knows nothing of lanes or Docker |
| `channel` | a held channel to a server process, one JSON line per message: lanehost's server and a lane's helper speak it; it declares nothing, since both run it from pine·trie's install |
| `ssh` | a lane's ssh through its host (ADR-0140): settings, the files every lane is given, the agent protocol and the relay's decisions; it declares nothing, and only the app declares it |
| `install` | pine·trie's own install (ADR-0189): its root, whether it runs as the repo's `.ts` or the package's `.js`, the mount lanes see it at, and the registry of scripts it runs in other processes, handed out only as whole commands; it declares nothing |
| `keeper` | one step at a time on a resource that needs exclusive access, in an order the caller can reason about; it declares nothing |
| `jj` | jj's adapter: your repo as the host reads and writes it (its one owner, proposed changes, accepted work and lanes' refs in it), each lane's own repo as a `LaneHistory`, your repo at startup, and every jj name |
| `folder` | a folder project's history as values (ADR-0142): its graph of states and their merge bases, the path merge's plan, and the snapshots kept; it declares only `core`, does no I/O, and lanehost carries out what it decides |
| `docker` | running lanes on Docker: the `LaneRuntime` over the docker CLI, btrfs disks in a helper container, Docker's startup refusals, lanes inside a lane; beside it a folder project's `FolderDisks` |
| `vm` | a Linux machine on the Mac: the image's build, the launcher, a host's lease on a slot; it declares nothing, and knows nothing of lanes |
| `session` | one client's connection to a host, its own documents and what it has in flight |
| `shell` | shell source as structure: a command's words by role, and a one-line command laid out to a width; it declares only `unbash` (ADR-0114) |
| `interface` | what a person sees and can do, decided, for any client: no React, no DOM, no I/O (ADR-0093, ADR-0194); a terminal client, `apps/tui`, proves it. A tool keeps its id for the model and has a word for people (`shell`, `search`), which interface gives; core holds only what a call is (ADR-0114) |
| `web-core` | the web client's own decisions, from the browser's inputs (a pointer, scroll, the clipboard's formats, the URL): pure, declaring only `core` and `interface`, so no React resolves there (ADR-0194) |
| `web` | the browser page: React and the DOM, drawing what `interface` and `web-core` decide; it declares neither `rules` nor `reads` |
| `apps/tui` | a terminal client, declaring only `interface`, `session` and `core`: its tests draw a thread, a digest and the composer from interface alone, so a view leaving interface fails them (ADR-0194). Not shipped |
| `apps/pinetrie` | the host; its shell is split by responsibility (`apps/pinetrie/host/TECHNICAL.md`). The one place that picks a runtime and wires `vm` to `docker` (`host/work/runtime.ts`) |
