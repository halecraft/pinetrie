# ADR-0118 — A thread works on sources: folders registered with the host, each branched, live or read-only

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/the-jujutsu-repo.md`, `packages/lanes/TECHNICAL.md`,
  `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S130, S131, S140, S141
- **Amends:**
  - ADR-0086: the host serves sources, not one project, and keeps its session
    outside them.
  - ADR-0034: a source is a grant, and a lane may have several disks.
  - ADR-0035: a shared directory is a live part of its branched source.
  - ADR-0121: a lane is told its sources.
  - ADR-0103: a host's slot holds its sources.
  - ADR-0100: accepted work is a branched source's.
  - ADR-0104: accepted work, WIPs and publish are per branched source.
  - ADR-0105: a thread has an offer in each source it changed.

**Context.**

- **A host serves one project** (ADR-0086): one repo, which every lane
  clones, where every offer lands, and whose `.pinetrie/` keeps the
  session.
- **Work needs other folders.** A web project's repo and a folder of notes
  elsewhere on the same machine; a second repo; reference material.
- **What reaches a lane now:** its own copy of the repo; the repo's shared
  directories, read-write (ADR-0035); read-only grants (ADR-0034); the
  roots of pi's commands, read-only (ADR-0036).
- **Nothing works directly in a directory** (ADR-0102). A read-write mount
  of files a repo tracks would be exactly that.
- **On the Mac, a host's directories fill its slot in the lane VM once**,
  when the host starts (ADR-0103).

**Decision.**

*A source is a folder registered with the host.*

- **The host's owner registers it**: in `sources` of
  `$XDG_CONFIG_HOME/pinetrie/config.json`, or as the folder `pnpm host`
  names. Each has a name, unique in the host (its folder's base name
  unless given), and a path.
- **The host reads its sources when it starts**, as it reads shared
  directories (ADR-0035). A source registered later is the host's after a
  restart.
- **Registering is a grant.** People in the session choose among
  registered sources, and name no path of their own.
- **Refused, with the reason logged:** your home directory, `/`, pi's agent
  directory, a path with both a comma and a colon (ADR-0036).

*Three modes.*

| mode | for | the lane gets | its work goes back as |
|---|---|---|---|
| **branched** | a colocated jj repo | its own copy, on a disk of its own, forked with the lane | an offer |
| **live** | a folder no repo tracks | a read-write mount, never snapshotted, branched or offered | itself, at once |
| **read-only** | any folder | a read-only mount | nothing |

- **A source's registration says the most it allows**: a repo, branched or
  read-only; a folder, live or read-only. A thread may take less.
- **A live source refuses tracked files**, as a shared directory does
  (ADR-0035): a mount of them would be working directly.

*A thread chooses its sources.*

- **At its start, from its task's defaults.** A task lists sources and
  their modes; a new task takes the host's first source, branched. A branch
  inherits its parent's.
- **A thread can add a source later.** It reaches the lane at its next
  start (ADR-0035). A branched source stays for the thread's life.

*Where they are in a lane.*

- **The thread's first branched source is its home, at `/workspace`**, as
  now, with its working copy read-only at `/mnt/host-working-copy`.
- **Every other source is at `/sources/<name>`**: a branched one on a disk
  of the lane's own, so it lasts and forks with the lane; a live or
  read-only one as a mount. A branched one's working copy is read-only at
  `/mnt/sources/<name>`.
- **A thread with no branched source** has a `/workspace` of its own that
  lasts and offers nothing.
- **The agent is told each source**, its mode and its path, in its lane
  guidelines (ADR-0121).

*The words for your repo are said of one source.*

- **Accepted work, WIP, publish and catch up are per branched source**,
  configured by that repo's `pinetrie.json`. The glossary's words do not
  change.
- **A thread has an offer in each source it changed**, under
  `pinetrie-offer/<name>` in that repo. The work strip shows a line per
  source, each accepted on its own. A turn records a revision in each
  source it changed.

*The session leaves the project.*

- **A host keeps its session in `$XDG_DATA_HOME/pinetrie/<session>/`**,
  named for its first source unless `PINETRIE_SESSION` names it.
  `PINETRIE_STORE` still overrides.
- **Each branched source's `.pinetrie/`** keeps only what its lanes need,
  excluded from its repo as now (ADR-0086).

**Consequences.**

- **Records that name your repo name a source**: a lane's base, its offer,
  its accepted offers, the ledger (ADR-0104, ADR-0105). One owner writes
  each repo, as one writes your repo now (ADR-0065).
- **A turn snapshots every branched disk of its lane**, in the lane's one
  queue, so a fork at a turn forks them together.
- **A person's path under any source's folder** becomes its lane path in
  what the model reads (ADR-0034).
- **The footer's publish** is per source with accepted work ahead
  (ADR-0090).
- **A live source ties its lane to its machine** (ADR-0119), and choosing
  one says so.
- **On Linux, a source added to a thread reaches its lane at the lane's
  next start**: its mounts change its container's spec hash, so the
  container is recreated on the same disk (ADR-0035).
- **On the Mac, a host's sources are in its slot of the lane VM**, filled
  once, at its lease, as now (ADR-0103). A source a thread chooses later
  is among them already.
- **Deferred: registering a source while the host runs.** On the Mac it
  would refill the host's slot once none of its lanes' containers runs: a
  refill cuts running lanes' mounts into the slot (S130, S131), and leaves
  stopped ones working when they start again (S140), so a host with a
  refill waiting would hold new runs' starts until the running ones end.
  Not a second slot beside the first: through two slots at once, appends
  to one file lose lines and a new file can be refused (S140, S141).
- **What a live source promises:** lanes' writes to one file are all kept,
  appends included. On the Mac, a file the Mac appends to while a lane
  appends to it keeps the lane's lines and loses most of the Mac's (S141),
  as in a shared directory now; on Linux it keeps both. Whole-file writes
  are last-write-wins everywhere.
- **A file card** (ADR-0116) shows a live or read-only source's file as it
  is on disk, and a branched source's as accepted work has it.
- **An existing store moves** to the session's directory, once.

**Alternatives rejected.**

- **One host per project, and a task across hosts.** The notes folder on
  the same machine would need a host of its own, and every task across
  them would wait for federation (ADR-0119).
- **Anyone in the session names a path.** A collaborator could mount the
  owner's home.
- **A live mount of a repo's tracked files.** That is working directly,
  which ADR-0102 removed.
- **Every source at `/workspace/<name>`.** It moves every lane's paths,
  and nests repos inside one.
- **A mode fixed per source.** One thread may write the notes while
  another, trusted less, only reads them.
- **Sources per task only.** One column on the web repo and another on the
  notes, in one task, need a choice per thread.
