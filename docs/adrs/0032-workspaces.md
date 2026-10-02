# ADR-0032 — A lane works in its own jj workspace, and each turn that changes files is a revision

**Status:** Accepted. Evidence: S36. Implemented by
`PLAN-2026-09-27-workspaces`. Amends ADR-0019 (the trunk is no longer
a line of work on the main working copy), ADR-0021 (a workspace is no longer
its own step) and ADR-0022 (the agent no longer works in the repo the host
runs from). Changes the vision's branch kinds (`docs/00-vision.md`): every
agent lane is a Worktree. **Amended by ADR-0034:** its workspaces, the
rewrite of the history the model is sent, the refusal of other lanes' paths,
and dependency setup are replaced by a container per lane on its own disk.
Amended in place (`PLAN-2026-09-29-send-button`): where a new lane works is
said by a chip beside the send button, not by the button.
**Amended by ADR-0038:** a lane with no revision above its fork
point starts from a copy of your `@`, not your `@-`, and lanes' bookmarks
leave your repo's config. **Amended by ADR-0040:** a direct lane's column no
longer says where it works and that the directory is shared; its work strip
says where its changes land, and warns only while another lane runs there.
Amended in place (`PLAN-2026-09-30-agent-commits`, S56): a commit the
agent made itself in a turn is that turn's revision.
**Amended by ADR-0060:** a lane with no revision above it starts at the
integration line, or a copy of a WIP bookmark, not your `@-`.
Amended by ADR-0061: where a new thread's agent works is a line left of
the send button, saying what it does to your files, and its menu marks the
choice.

**Context.** The agent's tools run in the repo the host runs from, so two
threads running tools at once share one directory and can collide. ADR-0022
accepted that until each lane had a workspace. ADR-0019 said a work lane would
own a jj workspace, created with the lane. ADR-0021 then made the workspace
its own step, taken deliberately, because it spends disk and CPU.

S36 measured that cost. `jj workspace add` takes 0.2 s for this repo. The
expensive part is dependencies: `pnpm install --offline` from pnpm's store
takes 2–3 s and about 7 MB, and a copy-on-write clone of every `node_modules`
about 6 s and 11 MB on APFS. Creating the workspace at
the agent's first write instead would save that for read-only threads. But
writes through `bash` cannot be detected without a sandbox, and the agent
would see its directory change mid-run: a symlink swap cannot hide the real
path (S36 item 8).

A branch reads everything above it, so a lane forked from an agent's message
should also start with the files as they were at that message. jj already
records file states as revisions, and a jj merge takes only what is new, as a
fold does (S36 items 11 and 12).

**Decision.**
- **Every lane has its own jj workspace, created with the lane.** The
  directory is `workspace/<lane>` in the repo, and the jj workspace has the
  lane's name. The host lists `/workspace/` in `.git/info/exclude`, so no
  tracked file changes (S36 item 16). Nothing stored maps a lane to its
  workspace. Setup runs alongside the model's first turn, and a tool call that
  arrives first waits for it. A conversation thread has no lane, so it has no
  workspace. A host started without tools creates none. A lane that works
  directly (below) has none either.
- **Where repos are is asked of jj, never inferred from the file system.**
  A secondary workspace's `.jj/repo` is a file, not a directory, and from
  inside a jj workspace nested in another repo, git names the outer repo
  (S36 item 17). Every lane's workspace has that shape. So:
  - the project is `jj workspace root --ignore-working-copy`, run from the
    host's directory;
  - the lanes' directories come from `jj workspace list`;
  - "your working copy" is the workspace the host runs from, which need not
    be `default`.

  No code looks for `.jj` or `.git` itself. Every jj command the host runs
  takes `-R <root>`, never relying on its own working directory, since a
  command run from the wrong directory acts on whatever repo surrounds it.
  The host acts on each command's exit status, never on its printed output
  (S36 item 28). `jj git init` is the one exception: it runs with the
  directory as its working directory, because `-R` needs an existing repo
  (S36 item 24).
- **A project with no jj repo is initialized.** Only when jj finds no repo
  does the host ask git (`git rev-parse --show-toplevel`):
  - **git names a repo:** `jj git init --colocate` at its top level. git keeps
    working, and removing `.jj` undoes it.
  - **git finds none:** `jj git init` in the host's directory, which creates
    both (S36 item 15).
  - **your home directory or `/`:** never initialized, whichever step would
    initialize there. A home directory that is a dotfiles repo would
    otherwise be what git names; lanes then work directly.

  jj's own init is the last word: if it refuses, the host reports why, and
  lanes work directly. In a git worktree it refuses to colocate (S36
  item 24). The host says at startup what it found and what it
  did. A directory that a lane names to work in is never initialized.
- **A lane can instead work directly in a directory.** A lane's workspace
  setting is either:
  - **own copy** (the default): the workspace this ADR describes;
  - **directly in a directory**: the tools run in a directory you name, your
    working copy by default, repo or not, with no workspace and no revisions.

  The setting is chosen when the lane is created, at the send that first asks
  the agent (ADR-0021). A chip beside the send button says where: "on a copy
  ▾", and its menu says what each choice means ("on a copy · you take its
  changes", "in your working copy · edits your files"). A new lane inherits the setting, and
  the directory, from the lane above its fork point. A root lane takes the
  host's default: own copy, unless `PINETA_WORKSPACES=0` or the project could
  not be initialized. The setting never changes on an existing lane, since
  the files and the conversation would then disagree (the reason lanes never
  move, ADR-0020): to work differently, branch and choose again. So it is
  stored, in a host-written value per lane, written once. A lane that works
  directly records its prompts with no commit, so a lane of its own copy
  branched below it starts from the nearest revision above, or `@-`.
- **Your working copy is yours.** No agent writes to it, except a lane you set
  to work directly there. Otherwise the host's code and the page it serves
  never change under a run, so hot reload comes back on (off while a lane
  works directly in your working copy), and "run `jj new` first" is no
  longer needed. Context
  files and skills are still read from your working copy (ADR-0022), not the
  lane's.
- **A lane starts with the files at its fork point.** A revision is recorded
  against every run's prompt (the files the run starts with) and against
  every message whose tool calls changed files (below). A lane created at
  entry E starts its workspace from the nearest revision at or above E. The
  nearest record above E also names the lane E belongs to, which is where a
  new lane inherits its setting from. With no revision above, a lane starts
  from `@-`, resolved when the lane is created: everything
  you have committed, not what you are still editing. After `jj new`, that is
  exactly your files. When your working copy has changes, the composer says
  the agent will not see them.
- **A turn revision per assistant message whose tool calls changed files.**
  pi calls an assistant message and its tool results a turn. When a message's
  tool calls finish, the host snapshots the lane's workspace. If anything
  changed, the host commits it (`jj commit`), described with the message's
  first line, with the entry id and lane as trailers. It records the commit id
  against the message's entry in a host-written `pineta.revision` value, keyed
  by the entry's id. A message whose calls changed nothing gets no revision; a
  branch from it starts from the nearest one above. A run's prompt always gets
  a record: changes made in the lane's directory between runs are committed
  as their own revision, and otherwise the prompt records the lane's newest
  revision.
  *Amended (S56):* when the agent committed in the turn itself, with jj or
  git, `@` is empty and its one parent descends from the lane's bookmark.
  That commit is the turn's revision: the bookmark moves to it, and it is
  recorded, so the offer holds it and a branch at the turn starts on it.
  It keeps the agent's description, with no trailers. A parent on another
  line, such as a split's stack, or a merge, is not adopted
  (`planTurnCommit`).
- **Revisions a lane builds on are immutable.** The host keeps a local
  bookmark per lane, `pineta/<lane>`, at its newest revision (the only place
  that revision is stored), and extends
  `immutable_heads()` in the repo's config with `bookmarks(glob:"pineta/*")`.
  jj treats every ancestor of an immutable head as immutable. So no agent,
  and not you without `--ignore-immutable`, can rewrite a revision a lane
  builds on, including the `@-` a lane started from. Workspace-level config
  would protect only from commands run in that workspace (S36 item 10).
- **Staleness is prevented, not repaired.** A workspace goes stale only when
  something outside it rewrites its history. Immutability covers what is
  committed, and folds and landing are merges, which rewrite nothing (S36
  item 11). `jj workspace update-stale` runs only as a guard at a run's start,
  after the previous run's end committed everything. It is a no-op unless
  someone overrode immutability. Repairing a stale workspace mid-run can take
  uncommitted edits off its disk (S36 item 7).
- **A lane's tools see only its workspace.** The run's `Context` carries the
  lane's workspace. pi's `toolContext` and system prompt are functions of it
  (`harness/runtime/drive/tools.js`), so the tools run there and the prompt
  names it (S36 item 18). Every call that drives a lane carries it, `resume`
  as well as `prompt`: after a crash, a lane is `LaneBusy` until resumed, and
  the resumed run's tools use the directory in `resume`'s `Context`. The host
  resumes such a lane itself. `packages/pi/agent.ts` currently assumes
  `LaneBusy` cannot arise. As a backstop to the rewrite below, pi's file
  tools refuse a path in your working copy or in another lane's workspace, and
  the error names the same path in the lane's own. Paths elsewhere are
  allowed. `bash` is not covered until it is sandboxed (ADR-0022). The lane's
  environment sets `JJ_EDITOR`, `VISUAL` and `EDITOR` to a command that fails:
  a jj command that opens an editor would otherwise hang a shell with no
  terminal until its timeout. With it, such a command fails in under a
  second (S36 items 13 and 21).
- **The model sees its history as if it had always worked in its own
  workspace.** A branch reads everything above it, and the parent's messages
  name the parent's paths (`read …/workspace/t-A/packages/core/index.ts`),
  while the branch works in `…/workspace/t-B`. pi's `transform_context`
  hook runs before every model request, on pi's messages before they are
  converted for the provider, and its event names the lane
  (`harness/runtime/drive/generation.js`). There the host replaces every other
  lane's workspace root, and your working copy's root, with this lane's root,
  in everything the model is sent: its text, tool-call arguments, tool
  results and summaries.
  - **The rewrite is true.** A lane starts from the revision at its fork
    point, so each path the parent named had, at that point, the content the
    same relative path has in the branch. The model is not told of a switch:
    as far as it can see, there was none.
  - **The tree keeps what happened.** Entries are immutable (ADR-0004), so
    the column shows the paths as they were written. Only what the model is
    sent changes.
  - **Only lanes with their own copy are rewritten.** A lane that works
    directly does not start from its fork point's files, so the rewrite would
    be false there; its history is sent as written.
- **Setup installs dependencies, then re-points links that leave the
  workspace.** After `jj workspace add`:
  - **A pnpm repo** (a `pnpm-lock.yaml`) gets
    `pnpm install --offline --frozen-lockfile` from the store
    `pnpm store path` names in your working copy. It takes 2–3 s here,
    installs from the lane's own lockfile, and imports copy-on-write where
    the platform can (S36 item 27). If the store lacks a package, the offline
    install fails at once, and the host installs online.
  - **Any other repo** gets a clone of every `node_modules` from your working
    copy. Only `cloneTree(src, dst)` differs by platform: `/bin/cp -c -R` on
    macOS, and `cp -R --reflink=auto` on Linux, which clones on btrfs or XFS
    and copies in full on ext4. The host checks at startup whether cloning
    is copy-on-write and says so.

  Either way, the host then re-points each symlink whose relative target
  leaves the workspace, resolved from your working copy's matching location
  (S36 items 5 and 27). What to install or clone and which links to re-point
  are planned purely; only the commands are effects.
- **A fold merges files too.** Beside ADR-0010's fold of the tree, folding a
  source into a target runs `jj new <target's newest revision> <source's
  revision at the folded tip>` in the target's workspace. It runs at the start
  of the fold's run, so the target is idle and ADR-0020's queueing applies.
  jj records conflicts in the merge rather than failing, and ADR-0033
  resolves them.
- **Landing: the lane merges your work in, and you take the result.** To bring
  a lane's work into your working copy, the lane merges your `@-` into itself
  (`jj new <lane's newest revision> <your @->`), in its own workspace, and
  resolves any conflicts there (ADR-0033). Only a resolved merge is offered
  to you. Taking it is one action, `jj rebase -r @ -d <merge>` in your working
  copy: your uncommitted changes stay in `@`, now on top of the lane's work.
  It is the only time the host writes to your working copy, and only when you
  ask.
- **A workspace exists whenever its lane runs.** Before every run, the host
  makes sure the workspace is there. It recreates a missing directory at the
  lane's newest revision and runs setup. Crashes, restarts and deleted
  directories take this one path.
- **Archiving a root removes its lanes' workspaces** (ADR-0029): `jj
  workspace forget`, the directory, and the lane's bookmark, so its revisions
  become ordinary commits again. Nothing in the repo is lost. Restoring sets
  each bookmark again, and a lane's next run recreates its workspace.

**Consequences.**
- **Branching from any message of agent work also branches its files.** Every
  message whose tool calls changed files has a revision, so it can show its
  own diff (`jj diff -r`).
- **ADR-0022's collision is gone for pi's file tools.** `bash` can still reach
  outside its workspace until it is sandboxed.
- **The vision's branch kinds collapse.** Aside is a conversation thread,
  which has no lane; every agent lane is a Worktree, and Scout's shared
  read-only workspace is not needed. The vision's third merge problem, effect
  merge, becomes a jj merge and ADR-0033.
- **`jj log` holds every lane's revisions**, one per file-changing message,
  under `pineta/<lane>` bookmarks. `jj git push --all` would push those
  bookmarks too (S36 item 23); push by name.
- **A turn revision costs about a tenth of a second** per message: 84 ms when
  nothing changed, 144 ms with a commit (S36 item 26).
- **While a lane builds on your `@-`, jj refuses to rewrite it.** A `squash`
  into it, or a `describe` of it, is refused; `jj new` and editing `@` are
  not affected (S36 item 19). After landing, the merge under your `@` is
  immutable in the same way (S36 item 20). Overriding with `--ignore-immutable` while that lane runs is
  exactly the hazard of S36 item 7.
- **A lane costs 2–3 s and about 7 MB with pnpm's store.** A clone costs
  about 6 s and 11 MB on APFS, and a full copy of `node_modules` on ext4. A
  cloned lane has your installed dependencies, which may not match its base's
  lockfile until it installs.
- **Lanes can run the test suites at once:** the whole `verify` gate passed
  in a workspace, and e2e ran in a workspace and in your working copy at the
  same moment without a port collision, since its host takes `port: 0` (S36
  item 25). A lane starting the development host needs `PINETA_PORT=0`, or
  it collides on 7391.
- **Taking a landing changes the host's own files.** Host code needs a restart
  to take effect, as today.
- **Pineta's own `link:` dependencies on Kyneta** are relative, so they need
  the re-pointing step. That step handles any repo's links that leave it.
- **A host started from one of its own lanes' workspaces finds the right repo
  and workspace,** because jj answers, not a directory check.
  `.git/info/exclude` applies in a secondary workspace too (S36 item 22).
- **Initializing changes a project that had no jj**, once, and says so. In a
  git repo, git keeps working beside jj.
- **A lane that works directly gives up what a workspace gives:** branching
  does not branch its files, a fold does not merge them, there is nothing to
  land, and two such lanes in one directory can collide, as before this ADR.
  Its column header says where it works and that the directory is shared. In
  your working copy, it turns hot reload off while it works, for ADR-0022's
  reason: its edits to the client would reach an open page mid-run.
- **An isolated lane already works outside its workspace** wherever that is
  not your working copy or another lane's workspace (for example
  `~/halecraft/kyneta`). Working directly is for tasks that must change your
  working copy, or that happen where no repo is.
- **A message that means another lane's workspace is rewritten too,** for
  example one comparing two branches' files. That is rare. A lane can still
  reach another lane's files through its revisions (`jj file show -r`).
- **Not measured:**
  - the browser suite inside a workspace (it needs a Playwright server
    outside the sandbox);
  - installing or cloning on Linux;
  - the `transform_context` rewrite reaching the model (read in pi's
    source, not run).

**Alternatives rejected.**
- A workspace as its own step (ADR-0021): a person would have to decide at send
  time whether the agent will write, for a cost S36 put at seconds and
  megabytes.
- Creating the workspace at the agent's first write (`bash` writes cannot be
  detected without a sandbox, and the switch is visible mid-run).
- A symlink swapped from the repo to a workspace (the agent sees the real path
  at its first command, S36 item 8).
- Symlinking `node_modules` back to your working copy (pnpm's relative links
  resolve to your packages, so a lane would test your code, not its own; S36
  item 3).
- Node's `fs.cp` as the portable clone (a full copy on macOS, S36 item 14).
- Cloning `node_modules` in a pnpm repo (slower than pnpm's offline install,
  and the dependencies would be yours rather than the lane's lockfile's; S36
  item 27).
- Forking root lanes from `trunk()` (here `main` is nine commits behind your
  work).
- A frozen copy of your working copy (landing conflicts wherever you keep
  editing the changes it copied).
- Your live `@` (every snapshot of your working copy rewrites it and would
  rebase every lane on it).
- One revision per run (a branch from a message mid-run would get the files
  from the previous run's end).
- Snapshots recorded without committing (the commit ids are rewritten on the
  next snapshot, and old ones survive only until `jj util gc`).
- Immutability in each workspace's config (it protects only from that
  workspace, and it outlives the workspace).
- `update-stale` as a routine sync (it can take uncommitted edits off the
  disk).
- Merging a lane into your working copy directly (its conflicts would land
  where agents never write).
- Landing by rebasing or squashing a live lane (it rewrites the lane's history
  and stales it).
- Mapping a foreign path in a new tool call silently to the lane's own (a
  refusal that names the right path is visible, and the agent corrects it).
  Rewriting the history the model is sent differs: it states what was true
  at the fork point, and it prevents the wrong path rather than catching it.
- Telling the model at a branch's start that it has moved workspaces (the
  note puts the old path back in front of the model, which copies what it
  sees, and it relies on the model's understanding where a rewrite does
  not).
- Only the refusal, without the rewrite (each inherited path costs a failed
  call before the agent corrects it, and `bash` is not covered).
- Finding repos by looking for `.jj` or `.git` in each ancestor (wrong in a
  secondary workspace, and wrong again for git inside a nested one; S36
  item 17).
- Adding `/workspace` to the project's `.gitignore` (a tracked change the
  person did not make; `.git/info/exclude` is local).
- Initializing any directory a lane names (a lane asked to work in `/tmp/x`
  should not leave a repo there).
- Switching an existing lane between its own copy and working directly (its
  files would stop matching its conversation).
- Turning workspaces off only for the whole host (a task outside the repo
  would force every thread to give them up).
