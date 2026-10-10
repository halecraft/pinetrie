# S148 — What a lanehost needs from btrfs and pnpm: read-only snapshots without privilege, `send` from a read-only mount, and a pnpm store carried by reflink

- **Status:** Answered
- **Led to:** ADR-0129, ADR-0131

**Question.** A lanehost that serves the lanes' disks, and a base rebuilt
fresh from its inputs, rest on these beliefs. Which of them hold on the lane
VM?
1. A process with no added capability, on the lanes directory
   (`user_subvol_rm_allowed`), can:
   - make a read-only snapshot;
   - restore from one (a writable snapshot of it);
   - move a read-only `<id>.tmp` into place;
   - delete a read-only snapshot.
2. A process with `SYS_ADMIN` alone, with the lanes directory mounted
   read-only, can `btrfs send --no-data -p` two read-only snapshots. A
   `send` killed halfway leaves nothing behind.
3. A lane's `.pnpm-store` can be carried into a fresh subvolume by
   `cp -a --reflink=always`, without privilege, quickly, with its blocks
   shared.
4. A fresh checkout plus the carried store installs offline in about the
   time of today's incremental refresh, and drops a deleted package's
   `node_modules`.
5. pnpm refuses a `node_modules` made with another store path, so the store
   must stay at `/workspace/.pnpm-store`.
6. Docker tells rootless from rootful in `docker info`, and `send` cannot run
   under rootless Docker.
7. Recorded `send --no-data` streams, with a deletion, a rename, a changed
   file, a mode change, a retargeted symlink and names with a newline and a
   space, can serve as fixtures for a parser.

**Kill criterion.** Any of 1–3 failing: the plan's read-only snapshots, its
privileged role, or its fresh base builds would need another design.

**Throw away.** Items 1, 3, 4, 5 and 6 ran by hand in a pine·trie lane, on
the VM's btrfs, with no added capability: the `disks` role's position. Items
2, 6 (on the VM's own Docker) and 7 ran from the Mac against the VM's Docker
with `docs/findings/S148-lanehost-disks/run.sh`, kept with its
output (`results.txt`) and the streams it recorded (`fixtures/`), which a
parser's tests use.

## Answers

Measured on the lane VM (kernel 6.18.55), in a lane of pine·trie's own repo
(btrfs-progs and pnpm 10.18.0 from the default image).

1. **Read-only snapshots work without privilege, if a delete flips the
   snapshot back first.**
   - `snapshot -r` took 3 to 13 ms.
   - A writable snapshot of a read-only one took 2.7 ms, and is writable.
   - `mv` of a read-only `<id>.tmp` to a free name works. `mv` over an
     existing snapshot fails with ENOTEMPTY, as it does for a writable one,
     so today's order stays: delete the old one, then move.
   - Deleting a read-only snapshot is refused. After
     `btrfs property set <s> ro false` (2 ms), the delete succeeds (1.3 ms).
2. **`send` works from a read-only mount with `SYS_ADMIN` alone, and a
   killed one leaves nothing.** In a container with `--cap-drop ALL
   --cap-add SYS_ADMIN`, no network, and the lanes directory mounted
   read-only:
   - a write to the lanes directory is refused;
   - `send --no-data -p` of an unchanged pair and of a changed pair both
     succeed;
   - a `send` of about 25,000 operations killed after 150 ms exits 143.
     No `btrfs` process is left, and the same `send` again succeeds in
     600 ms.

   Then, in a container with no added capability, every read-only
   snapshot the `send`s read was flipped and deleted. btrfs-progs printed
   two warnings for each (`cannot read subvolume info`, `cannot read
   default subvolume id`): it reads them for its message only.
3. **The store carries in about 300 ms, sharing every block.** A lane's
   `.pnpm-store`, 329 MB and 17,623 files, copied with
   `cp -a --reflink=always` into a fresh subvolume in 272 to 309 ms.
   `btrfs filesystem du` shows 0 bytes exclusive and 285.6 MiB shared.
4. **A fresh install takes 1.15 s.**
   - The disk was a writable snapshot of the lane, with every
     `node_modules` and the store removed, then the store carried in.
   - `pnpm install --frozen-lockfile --offline` took 1,154 ms, and left 13
     `packages/*/node_modules` and no `packages/container/node_modules`:
     the leftover that led to this spike.
   - pnpm cloned by reflink: a package's file has one link, and
     `node_modules` holds 164 KiB of its own, the rest shared.
   - The same install again, on the installed tree, took 450 ms.
5. **The store path must stay the same.** With another `--store-dir`, pnpm
   wants to remove `node_modules` and, with no TTY, stops:
   `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. An agent's `pnpm` in a lane
   has no TTY.
6. **Rootless Docker says so.** A nested lane's Docker reports
   `name=rootless` in `SecurityOptions`. In a container there, with
   `SYS_ADMIN` in its user namespace, `btrfs send` fails with
   `Operation not permitted` (the probe's dry run). The VM's own Docker
   reports `["name=seccomp,profile=builtin","name=cgroupns"]`: no
   `rootless`.
7. **The streams are recorded** (btrfs-progs 6.17.1, stream version 1):
   `no-change.stream` (107 bytes, a header alone), `turn.stream` (each kind
   of change), and `whole.stream` (no parent), with `turn.dump`,
   `receive --dump`'s reading of `turn.stream`. The dump shows what a parser
   must fold:
   - **a deleted directory** is renamed to an orphan (`d` →
     `o257-87862-0`), its subdirectories renamed to orphans of their own,
     then each file unlinked and each directory removed under those names.
   - **a renamed file is a `link` and an `unlink`,** not a `rename`: the new
     name is linked to the inode, then the old one unlinked.
   - **a new file or directory** is made under an orphan name, then renamed
     into place.
   - **a retargeted symlink** is an `unlink` of the path and a new
     `symlink` renamed to it: a delete and an add of one path, which is a
     change.
   - **a changed file** is an `update_extent`; a mode change is a `chmod`.
   - `receive --dump` writes a newline in a name as `\n`. That text is
     ambiguous with a name holding a backslash and an `n`, so a parser reads
     the binary stream.
