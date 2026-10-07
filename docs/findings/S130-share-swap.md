# S130 — Replacing a virtiofs share while the VM runs breaks every container's bind mount into it; a bind of the share's root survives

**Status:** Answered. Follows S128. Serves `PLAN-2026-10-07-lane-runtime`,
before its launcher phase.

**Question.** The plan runs one lane VM per user. Each host's directories
(the working copy, pine·trie's install, the runtime, grants, shared
directories) are named entries of one virtiofs share. The launcher
replaces that share (`setShare:` on the running device) whenever a host
leases or leaves. S128 showed the guest's own mount sees a replaced share
at once. It did not show what happens to a **container's** bind mount of
an entry, or of a directory inside one, across the replacement:
- whether it can still be read and written;
- whether a file it holds open keeps being written;
- whether the Mac and the container still see each other's new files.

The cases:
1. adding an entry;
2. the same entries in another order, with one more;
3. removing the others;
4. removing the bound entry, then adding it back.

Four containers are bound to the share throughout:
- one read-write on an entry, holding a file open and writing it every
  0.2 s;
- one read-only on the same entry;
- one on the whole share;
- one on a directory inside an entry.

**Kill criterion.** A container's bind mount of an entry that stays in the
share stops working, or starts showing another directory, after a
replacement. Then the plan cannot replace the share under running lanes.

**Throw away.** The probe's folder (`s130-share-swap/` in the shared plans
folder): the launcher's variant, the kernel and first stage copied from
S128, the script and its results. The data disk and test folders, which the
script deletes.

## How it ran

Duane ran it once on the Mac (macOS 26.7.1, docker CLI 29.8.1), with S128's
trimmed image (`system-trim2-lz4hc`) under a variant of S128's launcher.
The share tagged `extra` was a `VZMultipleDirectoryShare` of named
directories, replaced on `SIGUSR1` through `setShare:` on the running
device. The guest mounted it at `/mnt/extra`. Docker answered in 1,453 ms.

Before any replacement, all four containers worked:
- `l1`, read-write on `k1`;
- `l2`, read-only on `k1`;
- `l3`, on the whole share;
- `l4`, on `k1/sub`.

`l1`'s write reached the Mac, and the Mac's reached `l1`.

## Answers

1. **The first replacement broke every bind mount into an entry**, in
   `l1`, `l2` and `l4`: "ls: /w: No such file or directory". It only
   *added* `k2`, and `k1` kept its name and its source.
   - `l1`'s held file stopped growing at 45 bytes.
   - Neither side's new files reached the other.
   - A container started after the replacement, on `k2`, read it, and
     its write was refused ("Operation not permitted": read-only on the
     Mac's side).
2. **Nothing brought them back:**
   - the same entries in another order, with one more;
   - removing the others;
   - removing `k1`, then adding it back.

   The broken mounts stayed broken, and the held file stayed at 45 bytes.
3. **A bind of the share's root survived every replacement:** `l3` listed
   the share's entries as they changed (`k1`; `k1 k2`; `k0 k1 k2`; `k1`;
   `k2`; `k1`), as the guest's own mount did (S128).
4. **The guest's kernel logged nothing** but the devices found at boot: no
   error or stale handle.

## What this means

- **Kill criterion met:** a share cannot be replaced under running lanes
  whose mounts are inside it. Replacing it cuts every lane bound into it,
  even to an entry the replacement kept, and leaves no error in the guest.
- **A container may only bind a share whose contents never change while
  it runs.** Binding the root survives, but a lane would then see every
  entry: other projects' working copies, with one VM per user.
- **What holds instead** (S131): a share device per host ("slot"), filled
  when the host leases and not replaced while it runs. Replacing one
  device's share leaves binds into the others working, and a VM boots with
  20.
