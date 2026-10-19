# Working in a pine·trie lane

You are an agent in a pine·trie lane: a Linux container on a disk of its own,
where you run as root. This note is true of every lane, whatever the
project. The project's own `AGENTS.md` says what is particular to it.

Each fact names the code it comes from in an HTML comment, so whoever
changes pine·trie can keep this note true. You can skip them.

## Where things are

- `/workspace` is your own copy of the project: a jj repo, colocated with
  git, on the lane's disk. <!-- packages/core/lane-env.ts WORKSPACE_ROOT -->
- `/mnt/host-working-copy` is the person's working copy, read-only,
  including its `.git` and `.jj`. A path under their working copy that
  someone writes in a message reaches you as the same path under
  `/mnt/host-working-copy`. <!-- packages/core/lane-env.ts HOST_WORKING_COPY -->
  <!-- packages/rules/work.ts showHostWorkingCopy -->
- A shared directory, such as `/workspace/.plans` when the person shares
  it, is their own directory mounted read-write. Your edits there are
  visible to them and to every other thread at once, are never committed,
  and cannot be undone through jj. <!-- packages/lanes/plan.ts planMounts -->
- `/pinetrie` is the install of pine·trie that runs this lane, read-only. It
  looks like a pine·trie checkout, and it is not your project, even when your
  project is pine·trie: its code can differ from yours.
  <!-- packages/install/index.ts PINETRIE_MOUNT -->
- A dependency the project links from outside itself (`link:`) is mounted
  read-only at its own path. <!-- packages/lanes/plan.ts planLinks -->
- A skill's files are at `/mnt/host` followed by their path on the
  person's machine, read-only. <!-- packages/core/lane-env.ts hostPathInLane -->
- `/pinetrie-runtime`, `/pinetrie-git` and `/workspace/.pinetrie-lane/` are
  pine·trie's own. Leave them alone. <!-- packages/lanes/plan.ts RUNTIME_MOUNT -->
  <!-- packages/lanes/plan.ts IGNORE_MOUNT -->
  <!-- packages/lanes/plan.ts LANE_CONFIG_DIR -->

## How your work is recorded

- After each of your messages whose tool calls changed tracked files,
  pine·trie runs `jj commit` in `/workspace`. The revision is titled with the
  message's first line, and carries `Pinetrie-Entry` and `Pinetrie-Lane`
  trailers. <!-- packages/jj/lane/revisions.ts commitTurn -->
- So after a turn, `jj st` shows an empty working copy. Your work is below
  it:
  - `jj log -r 'immutable_heads()..'` lists your revisions;
  - `jj diff --from 'heads(immutable())'` shows all of it as one diff.
- Revisions from before this thread began are immutable here: jj refuses to
  rewrite them. <!-- packages/jj/lane/plan.ts forkConfig -->
- You need not commit. If you do, with jj or git, on top of your work, your
  commit is the turn's revision: pine·trie moves the lane's bookmark to it, and
  the person's copy of your work and any branch from that message hold it.
  It keeps your description.
  <!-- packages/jj/lane/plan.ts planTurnCommit -->
- Don't rewrite revisions you or pine·trie already made (`squash`, `rebase`,
  `abandon`, `describe` of an earlier one) unless a pine·trie message asks you
  to. pine·trie records each turn by the commit id of its revision, and a
  rewrite leaves those records naming commits no longer in your history.
  <!-- packages/rules/work.ts planTurnRecord -->
- `JJ_EDITOR` is `false`, so a jj command that would open an editor fails.
  Always pass `-m`, and don't use interactive commands such as `jj split` or
  `jj diffedit`. <!-- packages/core/lane-env.ts NO_EDITOR -->
- Ignored files, such as `node_modules` and build output, stay on the disk,
  and a branch gets them. The person's copy of your work never includes them.
- Nothing installs the project's dependencies or builds it for you: run
  `pnpm install`, a build, as you would in a fresh clone. pine·trie watches
  what each command reads and writes, and keeps a recipe for each that made
  ignored files from tracked ones (`/workspace/.pinetrie-lane/recipes.json`).
  When getting the latest changes a file a recipe read (a lockfile, a
  `package.json`), pine·trie removes what that recipe made, so nothing a
  deleted package installed stays behind; caches such as pnpm's store
  stay. The message after getting the latest names what went, the file
  that changed, and the last command seen writing there: a hint, since that
  is a whole tool call (`pnpm install && pnpm test`) and may not be the one
  to run. Make the rest again as you would after a pull.
  <!-- apps/pinetrie/host/work/disk.ts removeStaleOutputs -->
  <!-- packages/rules/disk.ts planStaleOutputs -->
  <!-- packages/rules/removals.ts removalsText -->
- Each turn's record classes what its commands wrote: derived (made from
  source, under `.gitignore`), local (ignored, made from nothing tracked),
  directories made from source that `.gitignore` misses, and source files
  jj left out of the commit. The person sees how many.
  <!-- packages/rules/disk.ts classifyWrites -->

## What the person gets

- Your work reaches the person as one commit on their accepted work, where
  finished work goes (`pinetrie-accepted`, unless they named it otherwise),
  or on the unfinished work's bookmark this thread started from, bookmarked
  `pinetrie-proposed/<thread name>`: this thread's proposed changes. They
  accept them when they choose. <!-- packages/jj/lane/names.ts proposedBookmark -->
- This thread started from accepted work, or from a copy of that unfinished work: the
  commit in your history whose message carries `Pinetrie-Base`. Leave it as it
  is. <!-- packages/core/trailers.ts baseMessage -->
- While you work, the proposed changes are described `WIP (<thread name>):
  <first message>`. When a run ends, another agent writes its description; you
  don't need to. <!-- packages/core/trailers.ts unfinishedDescription -->
- The person can ask for the proposed changes as a stack of revisions. A
  pine·trie message then asks you to build it, and says how.
  <!-- packages/rules/stack.ts planStack -->
- The person sees your work only through the proposed changes, which
  pine·trie brings up to date after each turn. Nothing you write appears in their editor.

## What lasts

- The container stops when a run ends, and the next message to this thread
  starts it again. Dev servers, watchers and other background processes end
  with it. <!-- apps/pinetrie/host/work/containers.ts runEnded -->
- `/workspace` is snapshotted after each turn. A branch from any of your
  messages starts from the disk as it was at that message.
  <!-- packages/lanes/plan.ts planSnapshot -->
- Everything outside `/workspace`, such as `/tmp`, packages from `apt`, or a
  global `npm` install, is on the container's own file system. A branch
  never gets it, and pine·trie recreates the container when the image, mounts
  or grants change. <!-- packages/lanes/plan.ts planContainer -->

## The environment

- pine·trie's default image is Debian with Node 24, pnpm, git, jj, curl,
  python3, and Chromium's headless shell in `$PLAYWRIGHT_BROWSERS_PATH`. A
  project with its own `pinetrie.Containerfile` runs that image instead, with
  only what it installs. <!-- packages/lanes/image/Containerfile PLAYWRIGHT_BROWSERS_PATH -->
  <!-- packages/lanes/image/Containerfile python3 -->
  <!-- packages/lanes/image.ts projectContainerfile -->
- Whatever the image, `jj`, `rg`, `fd` and `sd` are in `/pinetrie-runtime/bin`,
  last on your `PATH`: static builds pine·trie brings, so an image's own
  version of one comes first. <!-- packages/core/lane-env.ts RUNTIME_PROGRAMS -->
  <!-- packages/lanes/plan.ts RUNTIME_BIN -->
- Besides `read`, `write`, `edit` and `bash`, you have `grep` and `find`
  tools, which run that `rg` and `fd` in the lane. They skip what
  `.gitignore` ignores, such as `node_modules` or a shared `.plans`, unless
  you name that directory as their `path`. <!-- packages/pi/search.ts grepTool -->
  <!-- packages/pi/search.ts findTool -->
- A lane has 4 GiB of memory. <!-- apps/pinetrie/host/work/setup.ts LANE_MEMORY -->
- There is no `gh`, and no container runtime unless the project grants its
  lanes lanes of their own (`lanes.nested` in `pinetrie.json`): then a
  rootless Docker answers at `$DOCKER_HOST`. There is no
  `/var/run/docker.sock`: point a tool that assumes it at `$DOCKER_HOST`.
  Before building or running images there, read
  `/pinetrie/packages/pi/lane-docker.md`.
  <!-- packages/lanes/plan.ts LaneGrants -->
  <!-- packages/docker/plan.ts INNER_DOCKER_HOST -->
  <!-- packages/lanes/lane.ts nestedLaneDockerNote -->
- The person's machine's own services (bound to its loopback) are out of
  reach, but for ports the project grants (`lanes.hostPorts`): those are at
  `$PINETRIE_HOST`, and `$PINETRIE_HOST_PORTS` lists them.
  <!-- packages/docker/plan.ts HOST_ENV -->
- There is no model key: pi's `auth.json` is not in the lane.
- There are no credentials: the person's home directory is not mounted. A
  project grants its lanes an ssh agent, named environment variables, or
  read-only mounts in `pinetrie.json`'s `lanes` key.
  <!-- packages/lanes/plan.ts LaneGrants -->

## The network

- The internet is reachable.
- The person's services on their machine's loopback are not.
- Their services listening on all interfaces are at `192.168.64.1`.
  <!-- docs/adrs/0034-lane-containers.md 192.168.64.1 -->

## ssh

- `ssh` goes through the host. `ssh <alias>` works for the aliases the
  person's ssh config and their service folder's name: the host resolves
  the name and connects, and you check its host key against the
  `known_hosts` you are given. An alias you write in your own
  `~/.ssh/config` wins. <!-- packages/ssh/lane-files.ts planLaneSsh -->
- `SSH_AUTH_SOCK` lists the identities you hold, service ones first. A
  service identity signs at once. Your owner's own signs only once they
  approve this lane, and only for the hosts their config allows, which your
  guidelines name. <!-- packages/ssh/relay-step.ts relayStep -->
- "agent refused operation" means one of these, and the access row of your
  column's header tells your owner which:
  - your owner has not answered yet: refused at once, and a note in your
    run says they were asked. Do not retry: finish what you can, and end
    your turn saying you wait for their approval. Their approval wakes you
    to try again. <!-- packages/rules/access.ts planPersonalSign -->
    <!-- packages/rules/ssh-news.ts planSshNews -->
  - they refused it, or took it back: a note says so. Do not ask again.
  - the host is not one they allow: refused at once, without asking them.
    The host matches a host by its key, under the name ssh checks it as.
    <!-- packages/ssh/resolve.ts checkedHostName -->
  - the key is not one you hold.
- Do not turn off host key checking (`StrictHostKeyChecking`, a
  `known_hosts` of your own): the host key is how your owner's limit
  holds, and a key you accepted yourself is not one they allowed.
- `Match` blocks and hosts reached through a `ProxyCommand` are not
  carried into a lane. <!-- packages/ssh/lane-files.ts CARRIED -->
- A project's own image needs `openssh-client` and the line
  `Include /pinetrie-ssh/config` in `/etc/ssh/ssh_config.d/`.
  <!-- packages/lanes/image/Containerfile 10-pinetrie.conf -->

## People

- Several people may write in one thread. Each message you read begins with
  the name of the person who wrote it. <!-- packages/rules/message.ts attributed -->
- When someone gets this thread the latest, pine·trie merges the thread's
  base into `/workspace`: accepted work's newest commit, or a fresh
  copy of the unfinished work it started from. A note tells you what changed. What they
  want done with it comes after, as their message.
  <!-- packages/jj/lane/merge.ts mergeBase -->
- If the merge conflicts, a pine·trie message asks you to resolve it. Then
  use `ask_about_conflict` when the two sides of a conflict meant different
  things. You always have the tool, but it asks only while this copy has a
  conflict; otherwise it answers that there is nothing to ask about.
  <!-- packages/rules/land.ts LAND_TYPE -->
  <!-- packages/core/tools.ts CONFLICT_TOOL -->
  <!-- packages/pi/lanes.ts NO_CONFLICTS -->

## This thread's base

- When the thread's base (accepted work, or the unfinished work it started from) has
  moved on, a pine·trie note says so, before the person's message or between
  your tool calls: which files would change, which of them you changed too,
  and whether your proposed changes conflict with it. <!-- packages/rules/behind.ts behindContent -->
- `catch_up` merges that work into `/workspace` now; with `from: parent`,
  the newest work of the thread this one branched from. It acts only when
  there is something new, and only as the one tool call in its turn: a call
  beside another is refused. A conflicted merge answers with the conflicts,
  to resolve here. <!-- packages/rules/agent-commands.ts planGetLatestCall -->
  <!-- packages/core/tools.ts GET_LATEST_TOOL -->
- `split_proposed_changes` asks for this thread's proposed changes to be
  split into a stack of reviewable revisions. The split runs after your run, as a run of its own.
  <!-- packages/rules/agent-commands.ts planSplitCall -->
- `propose_branches` proposes new threads that branch from the end of
  this run, each a title and a brief its own agent starts from. A person
  starts or opens them from the proposal once your run ends, and a note
  here says when; nothing starts on its own.
  <!-- packages/rules/proposal.ts parseProposal -->
- Accepting your work is the person's: you propose changes, they accept them. A note
  in the thread says when they do. <!-- packages/rules/fact.ts factContent -->

## When the lane can't do something

Some work needs what a lane lacks: a container runtime (unless the
project grants `lanes.nested`), a model key, the person's credentials, or
their localhost. Say what you could not run and
why, and leave it to the person. Don't work around the lane's limits.
