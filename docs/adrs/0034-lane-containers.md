# ADR-0034 — A lane is a Linux container on its own disk, and a branch clones that disk

**Status:** Accepted. Implemented by `PLAN-2026-09-28-lane-containers`.
Evidence: S38, S39, S40, S41, S42, S43, S44. **Amended by ADR-0038
(proposed):** work reaches your repo as an offer, and a lane's history as
remote bookmarks. **Amended by ADR-0065:** a lane's bundle is imported into
your repo by its owner, as the host's operation. **Amended by ADR-0046:** a lane's agent is told what
holds in every lane, and no port proxy is built. Amends ADR-0032:
replaces its jj workspace per lane, the rewrite of the history the model is
sent, the refusal of other lanes' paths, and dependency setup. Keeps its turn
revisions, its fork-point rule, landing, working directly, and your working
copy being yours.
**Amended by ADR-0060:** the base snapshot is the integration line's
commit, and work reaches your repo by a forward bookmark move.
**Amended by ADR-0064:** the lane runtime carries rg, fd and sd beside
jj, and the agent's `grep` and `find` tools run them.

**Context.** ADR-0032 gave each lane a jj workspace on the host and made a
branch's inherited history read as if it had always worked there, by
rewriting other roots' paths to the lane's before every model request. S38
found the rewrite cannot be made true:
- it points paths at things the workspace does not carry (`.jj/`, ignored
  files, your uncommitted changes), and it misses paths in forms it does not
  recognize;
- state that is not files (a server on a port, a database, a process) is the
  host's, shared by every lane;
- it rewrote a root lane's own reads of your working copy, which had nothing
  inherited, so the lane's history contradicted itself;
- left out for people's messages, it sent a real model to write your working
  copy through `bash`, which the refusal does not cover.

A lane can only have its own files, ports and processes in a VM: macOS has no
per-process mounts or network namespaces. Apple's `container` runs each
container in its own lightweight VM with its own IP address (S39):
- it starts in under a second; `exec` into a running one takes 50–70 ms;
- two lanes served `:5173` at once;
- a read-only mount refused writes in the kernel, `bash` included;
- every lane saw its directory at the same path, and nothing of the host's;
- the unit suite ran at host speed once dependencies were on the lane's own
  disk (3.2–3.6 s; 15.6 s with them on a virtiofs mount).

A lane's disk is one sparse file on APFS, so cloning it is copy-on-write
(S40): 0.3–0.6 s, stable at any depth, sharing every unchanged block. A fork
then inherits everything in the directory at that moment, whatever the
language: tracked files, dependencies, caches, build output.
- A clone taken while the lane writes is consistent only on a journaled
  filesystem. `container`'s default volume has none: 0 of 70 mid-write
  clones were consistent, with shared blocks and corrupt directories. With
  `--opt journal=ordered`, 687 of 687 were (S41).
- Without a `sync` first, files the lane wrote but had not flushed come out
  empty in the clone (S41 item 1).

A clone also carries the lane's jj state. With one repo shared by every lane
over virtiofs and a workspace per lane (S41), a clone claims to be its
parent's workspace, must be re-registered before jj runs in it, and several
VMs write one jj operation log over a shared mount. With the whole repo on
the lane's disk (S42), a clone is a complete fork of repo and working copy,
and lanes exchange commits the way separate clones do.

**Decision.**
- **A lane is a Linux container with its own disk.** The disk is a
  journaled ext4 volume (`container volume create --opt journal=ordered`)
  holding the lane's whole directory: a jj repo (a `jj git clone` of yours,
  colocated), its working copy, and everything ignored. It is mounted at the
  same path in every lane, `/workspace`, so every path any lane's history names
  is a path in every lane that inherits it. Nothing is rewritten.
- **Your working copy is mounted read-only at `/mnt/host-working-copy`.** A lane can read it
  and cannot write it, by any tool. Directories that links leave the project
  for (Pineta's `link:` dependencies on Kyneta) are mounted read-only where
  the links resolve. Nothing else of the host is mounted.
- **The lane's tools run in its container.** The host cannot read an ext4
  disk, so pi's `read`, `write`, `edit` and `bash` run in the lane: pi's own
  `NodeExecutionEnv`, in a helper process the host starts with one
  `container exec -i` per running lane, answers the host's proxy
  environment. Calls take 0.3–1 ms; `bash` output streams; a timeout or an
  abort kills the command's process group in the guest (S43 items 1 and 2).
  The container runs with `--init`, so killed processes are reaped (S39 item
  6). The system prompt names `/workspace` and `/mnt/host-working-copy`. Context files and
  skills are still read from your working copy on the host (ADR-0022,
  ADR-0033).
- **A turn: commit, sync, snapshot, fetch.** At the boundary where ADR-0032
  records a turn, the lane:
  1. commits the turn if tracked files changed (`jj commit`, as ADR-0032);
  2. runs `sync`, so what the tools wrote is on the disk;
  3. is cloned, copy-on-write, into a snapshot.

  The host then fetches the lane's commit into your repo as `pineta/<lane>`,
  and the turn's `pineta.revision` record names both the commit (null when
  nothing tracked changed) and the snapshot. Every turn with tool calls gets a
  snapshot, because ignored state changes without a commit. A turn's
  snapshot runs alongside the next model request; the next tool call waits
  for it. A turn is pi's unit, not a tool call: pi runs a turn's calls in
  parallel unless told otherwise (`toolExecution` defaults to `"parallel"`
  in `harness/runtime/harness.js`), so there is no state between them.
- **A branch clones the snapshot at its fork point.** A lane created at entry
  E takes the nearest record at or above E (ADR-0032's rule), clones its
  snapshot into a new disk, and starts a container on it. Before anything else
  runs there, the lane:
  1. runs `jj new <the record's commit>`, so it has its own working-copy change;
  2. marks everything at or above its fork point immutable in its own config,
     a file on its disk (`JJ_CONFIG`) that applies only to the lane's repo,
     so forks inherit it (S50).

  A clone always carries someone else's working-copy change; without step 1,
  its first turn is that change, divergent from its parent's (S42 item 2).
  Branches of branches are the same operation.
- **A root lane clones the project's base disk.** The host keeps one disk per
  project: your repo cloned and its dependencies installed in Linux. A root
  lane clones it, fetches your `@-` from `/mnt/host-working-copy` by commit id, and runs
  `jj new` on it; it installs only if its lockfile differs from the base
  disk's. That is the only install; a branch never installs. The id is
  given, not looked up: your `@-` is on no bookmark, and a colocated repo's
  git `HEAD` is detached, so a clone alone checks out nothing (S43 item 5).
- **Work moves between repos as commits.** The host fetches from a lane by
  bundle: the lane writes `git bundle create -` to the host through
  `container exec`, and the host fetches from it (about 0.1 s, S43 item 3).
  No lane can write your repo, and your repo's configuration is unchanged. A
  lane fetches your `@-`, or another lane's commits, from `/mnt/host-working-copy`, which is
  read-only and gains nothing (S43 item 4). Landing is ADR-0032's: the lane
  merges your `@-` into itself, ADR-0033 resolves, and you take the merge with
  `jj rebase -r @ -d <merge>`. A fold's file merge is a merge in the target
  lane of commits it fetched. `bookmarks(glob:"pineta/*")` stays in your
  repo's `immutable_heads()`.
- **A container runs only while its lane runs.** A VM keeps the most memory
  its guest ever touched until it stops (S39 item 7), so the host stops a
  lane's container when its run ends and starts it for the next (0.3 s and
  0.7 s; the disk keeps everything). After it stops, the host trims its disk
  in a separate short-lived container with `CAP_SYS_ADMIN`, so the disk gives
  back space the lane deleted (S40 item 8); the lane's own container never
  has that capability.
- **Snapshots last as long as their root.** Any visible turn of an open root
  can be branched from, so its snapshot is kept. Archiving a root (ADR-0029)
  deletes its lanes' disks and every snapshot but each lane's newest, in the
  background (deleting a clone takes about 280 ms, S40 item 4). Restoring a
  lane clones its newest snapshot.
- **The image is the project's.** A lane runs the project's `Containerfile`
  if it has one, else Pineta's default image: Debian trixie, Node, git (2.41
  or later: jj's push and fetch need it, S42 item 7), and jj. `container build`
  makes it once per change.
- **One interface for lanes' disks and containers,** with operations: create
  from the base disk, snapshot, fork, exec, stop, trim, delete. It has one
  implementation, Apple's `container`, which needs macOS 26 on Apple silicon.
  Where it is missing, lanes work directly (ADR-0032) and the host says so at
  startup.
- **The container is the boundary, and what crosses it is a grant.** Your
  home directory is not mounted, so pi's `auth.json`, your git and npm
  credentials and your ssh keys are out of a lane's reach (S43 item 7). A
  project declares its grants, and a lane gets nothing else:
  - forwarding your ssh agent (`--ssh`), for git over ssh;
  - named environment variables;
  - further read-only mounts;
  - shared directories, read-write, from the project or the person's own
    config (ADR-0035);
  - tools that run on the host (an MCP server, an extension's tool). Pineta
    exposes none today; a tool that runs on the host acts outside the lane,
    with your access, so it runs in the lane unless declared.

  `/mnt/host-working-copy` includes your repo's `.git/` and `.jj/`, read-only:
  a token in a remote's URL in `.git/config` is readable in a lane.

  The network is not yet a grant: a lane reaches the internet and every
  host service bound to all interfaces, at the gateway (`192.168.64.1`); your
  Playwright server on `:3100` answered. Services bound to the host's
  loopback are unreachable directly. A browser server on the host is a
  route to them and to the host's files: a lane that drives its browser
  opens the host's loopback and reads `file://` URLs (S52 item 5). No gate
  needs one since ADR-0041.
- **A person's path to your working copy is shown as `/mnt/host-working-copy`.** When a
  message is sent, a path under your working copy's root becomes the same
  path under `/mnt/host-working-copy`, in the text everyone then sees, before the model reads
  it. What people see and what the model reads are the same text.

**Consequences.**
- **A lane's history is true in every lane that inherits it.** The
  `transform_context` rewrite, the refusal of other lanes' paths, and S38's
  question of what to rewrite are gone.
- **No agent can write your working copy**, through any tool, except a lane
  set to work directly there. Hot reload stays on.
- **No agent can read your credentials** unless the project grants them, and
  a lane cannot use the network to anything but the internet and the host's
  services on all interfaces. Those stay open until the network is a grant.
- **Branching from any visible turn branches everything in the directory**:
  a branch's `node_modules` and `.vite` are its parent's at that turn, byte
  for byte, and its writes never reach its parent (S40 item 1, S42).
- **Each lane has its own ports and processes.** A lane's dev server is at
  the lane's IP. *Amended by ADR-0046:* the host does not proxy it, and the
  host stops a lane's container when its run ends, so a lane's processes,
  dev servers included, end with the run.
- **The host sees a lane's work once per turn,** when it fetches, not live.
  People see a lane's files through its revisions (`jj diff`, `jj file show`)
  or through the host, not in their own editor.
- **Costs per turn: 250–300 ms** on Pineta's own repository (S43 item 6): a
  commit (84–110 ms), a `sync` (52–73 ms), a clone (5–9 ms on a fresh disk,
  up to 0.6 s on one churned for minutes, S40), and a fetch (98–131 ms). The
  clone overlaps the next model request. **Per branch:** a clone, a container start (under 1 s), and `jj new`
  (93 ms, S42). **Memory:** about 1.2 GiB per running lane (S40 item 6), none
  for a stopped one.
- **Disk grows only with what lanes write**; a lane that reinstalls its
  dependencies pays their full size (S40 item 7).
- **A clone is a disk image written into a volume `container` created.** That
  is not an API of `container` at 1.4.1: a volume is its `entity.json` and an
  image, read by path (S40, "Not measured"). A contract test runs the S41 soak
  in small (clones taken mid-write, then `e2fsck` and content checks) on every
  upgrade of `container`, with a deliberate bug that drops the journal.
- **Pineta needs `container` for lanes of their own.** Other hosts, and Linux,
  work directly until the interface has another implementation (reflinked
  images on btrfs or XFS, S40 discussion).
- **ADR-0032's host-side jj workspaces, `workspace/` in the repo, its
  dependency setup and its re-pointing of links are removed.** Nothing in
  your working copy's tree is created for a lane.
- **Not measured:**
  - the helper under a turn's parallel tool calls;
  - restricting a lane's network;
  - a large repository: the base disk's clone (1.2 s for this one), and
    `git gc` on disks forks keep cloning;
  - clone time against a disk's fragmentation;
  - tens of thousands of snapshots over a long session;
  - the e2e and browser suites in a lane;
  - a project `Containerfile`, or `devcontainer.json`;
  - the host proxying a lane's ports (not built, ADR-0046);
  - whether your machine reaches a server at a lane's IP.

**Alternatives rejected.**
- Rewriting paths in the history the model is sent (ADR-0032; S38: untrue
  wherever the workspace does not carry a path, blind to forms it does not
  match, and silent to the people reading the same thread).
- Rewriting only inherited messages (S38: people's paths reached the model
  literally, and it wrote your working copy through `bash`).
- A virtual root translated at the tool boundary on the host (servers, ports
  and processes stay shared, and a path computed in `bash` escapes it).
- Seatbelt (`sandbox-exec`) alone (it can refuse writes, but gives a lane
  neither its own paths nor its own ports).
- macOS VMs (Tart, Virtualization.framework guests: at most two at once per
  host).
- Colima, OrbStack or Docker Desktop (every lane shares one VM's kernel;
  `container` gives each its own VM and address).
- Dependencies on a virtiofs mount (4.5 times slower, S39 item 4).
- A shared pnpm store on a named volume (a volume attaches to one running VM
  at a time, S39 item 4), or any per-tool cache (a disk clone needs none).
- `container`'s default volumes (no journal: mid-write clones corrupt, S40
  item 2, S41 item 2).
- Overlay layers per turn or per tool call (a small change to a large file
  copies it whole, lookups slow with depth, and sealing a layer means
  remounting under running processes; layers remain the export format for
  moving a lane to another machine).
- A snapshot per tool call (pi runs a turn's calls in parallel) or per run (a
  branch from mid-run would get the wrong files).
- One repo shared over virtiofs with a jj workspace per lane (S41: a clone
  must be re-registered before any jj command, `jj workspace update-stale`
  in an unregistered clone makes its parent's change divergent, and several
  VMs share one operation log).
- Cloning ahead of a fork to avoid `jj new` (a clone always carries a
  working-copy change someone else has).
- Lanes pushing into your repo (a lane could write any ref there; the host
  fetches instead).
- Fetching over git's `ext::` transport (it works, S43 item 3, but needs
  `protocol.ext.allow` in your repo, which lets any `ext::` remote URL there
  run a command).
- A `container exec` per tool call (50–70 ms each, S39; a helper answers in
  under a millisecond).
- Driving Virtualization.framework directly, or waiting for a clone command in
  `container` (months; the contract test guards the image swap meanwhile).

**As implemented** (`PLAN-2026-09-28-lane-containers`). Where the build adds
to or differs from the text above:
- **The paths are `/workspace` and `/mnt/host-working-copy`** (`WORKSPACE_ROOT`
  and `HOST_WORKING_COPY` in core). They are named for what they hold: the
  lane's own copy, and the person's working copy on the host. The findings
  (S39–S44) measured them as `/project` and `/yours`.
- **A project's image** is `pineta.Containerfile` at its root. It needs only
  a POSIX `sh` and git 2.41 or later; the host refuses to start lanes on an
  image without them, naming what it lacks. Pineta's default image is Debian
  trixie with Node 24, git 2.47, pnpm through corepack, and jj pinned to the
  host's version.
- **The lane runtime.** Node, with its libraries and glibc's loader, and a
  static jj, copied out of Pineta's default image into
  `.pineta/runtime/<image tag>/` and mounted read-only at `/pineta-runtime` in
  every lane. The helper runs on that Node through that loader, so it needs
  nothing of the project's image (S44).
- **Grants** are `pineta.json`'s `lanes` key: `ssh`, `env` (names), `mounts`
  (read-only). The same key's `install` and `installWhen` name the base
  snapshot's install command and its lockfile; a repo with `pnpm-lock.yaml`
  installs with pnpm by default.
- **Snapshots** are files, `.pineta/snapshots/<entry id>.img`, one per
  revision record; the base snapshot is `base.img`, with `base.json` naming
  its commit and lockfile hash. `/.pineta/` is added to git's exclude file.
- **A fetch by id** puts the commit on a branch, and every git fetch into a
  colocated repo ends with `jj --ignore-working-copy git import` (S44 items 7
  and 8). A new base disk is `git init` and `jj git init --colocate`, not
  `jj git clone`, which refuses a volume's `lost+found`.
- **A lane from before lane containers**, with a record and neither a disk
  nor a snapshot, is retired: its tools fail, saying so and to branch from it.
  A branch from it starts from the base snapshot at its nearest commit.
- **Commands the host runs carry `PINETA_GIT=1`**, which a git shim that
  refuses writes in a jj repo when an agent is driving lets through: fetching
  lanes' bundles into your repo is a git write.
- **Skills** listed by path from your home directory were not readable in a
  lane, since your home directory is not mounted. ADR-0036 mounts their
  files read-only at `/mnt/host` and their host path.
