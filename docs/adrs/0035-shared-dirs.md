# ADR-0035 — Chosen directories are shared read-write with every lane, and never branched

- **Status:** Accepted
- **Area:** `packages/lanes/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S41, S45
- **Amends:**
  - ADR-0034: a new kind of grant: a host directory shared read-write into
    every lane.
- **Amended by:**
  - ADR-0103: on the Mac, a shared directory is a read-write entry of its
    host's slot in the lane VM, shared when the host starts.

**Context.** ADR-0034 gives each lane its own disk, and a branch clones it.
That is right for a project's files, and wrong for the person's own working
notes, above all plans. An agent must always be able to create a plan and
usually update it, and a plan is the person's, not a branch's: every thread,
and the person, should see one copy, live. Under ADR-0034 a lane could only
read plans, through `/mnt/host-working-copy`, at a path its instructions
don't name. And a change to a lane's container never reached an existing
lane: its mounts, grants and image were fixed when the container was made.

**Decision.**
- **A shared directory** is a directory of your working copy, named relative
  to the project's root. It is mounted read-write at the same relative path
  under `/workspace` in every lane of its own, so paths in `AGENTS.md` work
  the same there and in your working copy. It is a mount, not part of the
  lane's disk, so it is never snapshotted, cloned, committed or landed (S45
  items 1 and 5). What a lane writes there is yours on the host, visible at
  once (S45 items 2 and 3).
- **Two levels, merged:** the person's lane config,
  `$XDG_CONFIG_HOME/pinetrie/config.json` (only its `lanes.shared`), for
  habits that follow them into every project; and the project's
  `pinetrie.json`, for directories everyone on it needs. The person's come
  first.
- **Refused, with the reason logged:** absolute paths; paths that leave the
  project; anything in `.git`, `.jj`, `.pinetrie` or `node_modules`; a path
  holding files jj tracks. The rest still apply. A missing directory is
  created.
- **No repo tracks a shared directory.**
  - In a lane, the host names a generated ignore file, listing each shared
    directory, as git's `core.excludesFile`, through `GIT_CONFIG_*`
    variables on the container. jj reads it too, so every repo in the lane
    ignores it from the container's first moment (S45 item 7).
  - In your repo, one nothing already ignores is added to
    `.git/info/exclude`. Your global git ignore counts.
- **A container is disposable; the disk is the lane.** Each container is
  labelled with a hash of its arguments. A container made from another
  spec is recreated on the same disk at its next start (S45 item 6). So
  changed shared directories, grants or links, and a rebuilt image, reach
  existing lanes.
- **The system prompt** names each shared directory as shared with the
  person and every other thread, live, and never part of a branch.

**Consequences.**
- With `.plans` shared, agents create and update plans in
  `/workspace/.plans`, and you see them at once. This repo's plans live in
  `.plans/`.
- A shared directory is a channel between lanes, and from lanes to your
  machine. Grant only data you want every thread to write.
- Two lanes writing one file at the same moment: the last write wins. No
  merge.
- Recreating a container costs about a second, once per spec change. Every
  lane made before labels is recreated once.
- Storing a plan in the plans tool's refs (`refs/plans/`) still happens on
  your side: a lane's refs never reach your repo.

**Alternatives rejected.**
- Keeping plans read-only at `/mnt/host-working-copy`: agents must create
  them.
- A symlink from `/workspace/.jj` or `.git` to your repo: S41's problems with
  one repo across lanes, and a way for a lane to write your repo.
- A host-side plans tool: it covers plans only. A directory is general, and
  the agent's own tools work in it.
- Tracking plans in the repo: a plan would fork with a branch and need
  merging back.
- Each lane repo's `.git/info/exclude`: it works only if written before jj
  first snapshots with the mount present (S45 item 4), so every start, fork
  and base would need a step in the right order, and a mistake commits
  shared files silently.
- `XDG_CONFIG_HOME` for the whole lane: it would move every tool's
  configuration to a read-only place.
- Inferring shared directories from `.gitignore`: `node_modules` is ignored
  and must stay per lane.
- Marker files in the directory: invisible, and easy to create by accident.
- One configuration level: project level alone makes every repo configure a
  person's habit; user level alone gives a project no way to share.
