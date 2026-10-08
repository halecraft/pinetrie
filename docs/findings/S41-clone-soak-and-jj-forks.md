# S41 — a soak of mid-write clones, and forking a lane's jj workspace with its disk

- **Status:** Answered
- **Led to:** ADR-0034, ADR-0035

S40 found a lane's disk image can be cloned at a turn boundary, and that
clones taken mid-write are consistent on a journaled image (8 of 8). Two
questions remained before building on it:

1. Volumes attach with the host's cache on (`container` 1.4.1,
   `Filesystem.volume`, `cache: .on, sync: .fsync`). Is crash consistency
   solid over hundreds of clones, not eight?
2. A clone of a lane's disk carries the lane's jj workspace state
   (`.jj/working_copy`), so it claims to be its parent's workspace. Can a fork
   be made its own workspace, so that anyone can branch from any turn, build
   on it, and never clobber the parent, recursively?

**Answers.**

1. **687 of 687 mid-write clones were consistent.** A writer ran for 150 s on
   a volume made by `container volume create --opt journal=ordered --opt
   size=8G`: an `fsync`ed, checksummed log (44,460 records), npm's package
   tree (1,926 files) deleted and re-extracted 2,223 times, and a
   rename-replaced `state.json`. The host cloned the image back to back, with
   no `sync` and no pause (687 clones, about 4.7 a second). For each clone:
   - the journal was replayed (`e2fsck -fy`), and the only repairs were the
     superblock's free block and inode counts, which ext4 does not journal
     and every unclean stop leaves stale;
   - a second `e2fsck -fn` found nothing;
   - every record the writer had reported `fsync`ed before the clone was
     present, and no record failed its checksum;
   - `state.json` was always a whole version with a valid checksum;
   - no churned file held anything but its own bytes: 2,748 whole, 1.32
     million empty (created, data not yet written back: ext4's delayed
     allocation without `fsync`), none partial, none foreign.
2. **The check can fail.** The same soak on `container`'s default volume (no
   journal) gave 0 consistent clones of 70: every one needed real repairs
   ("directory corrupted", "Missing '.' in directory inode 13"). An earlier
   control run lost `fsync`ed records in 2 of 90 clones. The first version of
   the check counted only a second `e2fsck` pass, which the first had
   already repaired, and passed them: it was fixed to classify each repair.
3. **A fork becomes its own jj workspace in about 150 ms, and then nothing it
   does reaches its parent.** In a throwaway repo, with each lane's
   directory on its own journaled volume at the same guest path and the repo
   shared at `/r` over virtiofs:
   - lane A took two turns (tracked edits, and ignored `node_modules/`,
     `.vite/`), and its disk was cloned after turn 1;
   - fork B, from that clone, was re-registered: a fresh workspace
     `lane-b` created with `--ignore-working-copy` (it lands at the root
     commit), `jj new <turn 1>` run inside that fresh workspace, and its
     `.jj/working_copy` copied over the clone's (156 ms). `jj st` in B: no
     changes. B's files and ignored state were A's at turn 1 (`.vite` A1,
     not A's later A2);
   - B took a turn; fork C, from B's clone, was re-registered the same way
     and took a turn;
   - after all of it: each lane's files, ignored state and `jj st` were its
     own; the log was `base` → A1 → {A2, B1 → C1}; no change was divergent.
4. **An unregistered clone is refused, and jj's suggested fix does the
   damage.** A clone of turn 1 used without re-registering: every jj command
   failed with "The working copy is stale". `jj workspace update-stale`, the
   command jj suggests, made the clone adopt lane A's identity: it
   overwrote the clone's edit with A's latest file, left a stray commit, and
   made A's turn 2 divergent. A's files were untouched (its own disk); its
   history was not. This is S36 item 7 again.
5. **`jj workspace add` cannot check out with `--ignore-working-copy`**
   ("This command must be able to update the working copy"), and without it
   jj snapshots the workspace it runs from. From a clone, that is the parent's
   identity. So the fresh workspace is created with the flag and then checked
   out from inside itself.

## What this means for the design

- A fork, at any visible turn: clone the disk snapshot recorded at that turn,
  then re-register it before any jj command runs there. The fork's tracked
  files, ignored state and caches are the turn's; its jj workspace is its own.
- pine·trie never runs `jj workspace update-stale` in a lane: in a clone it is
  the one command that reaches the parent.
- Re-registering checks the fork's revision out in full in a scratch
  directory (cost grows with the repo's size), and the fork's first `jj st`
  re-hashes every file (the copied state's modification times are the
  scratch directory's).
- Lane volumes are made with `--opt journal=ordered`.

## Not measured

- Re-registering in a large repository; a sparse scratch checkout
  (`--sparse-patterns empty`) might avoid writing its files.
- `data=journal` or `writeback` modes; cloning with the host cache off.
- pine·trie's own repository, the host's `turnDone` and the landing flow on
  this layout.

## Method

`sandbox/s41/` in lane `t-01a0e616-…`'s workspace (ignored).
- `soak.sh LABEL SECONDS [ordered|none]`: a writer container (`writer.js`)
  on a fresh 8 GB volume, clones taken back to back into files, then checked
  four at a time in one container by `check.sh` (`e2fsck -fy`, then `-fn`,
  `debugfs` to extract, `verify2.js`). Results kept until summarized.
- `jjlib.sh`: lanes with a throwaway colocated repo at `/r` (virtiofs) and
  the lane's volume at `/r/workspace/lane`; `turn` does what the host's
  `commitTurn` does; `rebind` re-registers a clone. jj 0.44.0 (musl,
  aarch64) at `/opt/bin`; identity from `JJ_USER`/`JJ_EMAIL`, since jj 0.44
  keeps per-repo config beside the user's config, which the guest lacks.
- All containers, volumes, clones and the throwaway repo were removed after.
