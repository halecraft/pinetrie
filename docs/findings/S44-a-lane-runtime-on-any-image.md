# S44 — the lane runtime on any image, and fetching your `@-` by id

`PLAN-2026-09-28-lane-containers` runs Pineta's helper on the project's image,
whatever it is, from a runtime Pineta mounts read-only at `/pineta-runtime`:
Node started through a bundled glibc loader, and a static jj. Nothing had
measured it. Making the base disk also rests on S43 item 5, fetching your
`@-` by commit id, which this probe repeated in a fresh repo.

**Answers.**

1. **The runtime is small to extract.** From Pineta's image
   (`node:24-trixie-slim`, S42's `s42-lane:2`), `ldd node` lists six libraries:
   `libdl`, `libstdc++`, `libm`, `libgcc_s`, `libpthread`, `libc`. With the
   `node` binary and `/lib/ld-linux-aarch64.so.1`, `node/` is 123 MB. The static
   jj is 27 MB. The copy takes under a second.
2. **It runs on Alpine 3.22, which has musl and no Node.** Started as
   `ld-linux-aarch64.so.1 --library-path /pineta-runtime/node/lib
   /pineta-runtime/node/node /pineta/…/guest.ts`, Node v24.21.0 stripped the
   script's types and imported pi-agent-core's `NodeExecutionEnv` from
   Pineta's install, mounted read-only at `/pineta`. `writeFile`,
   `readTextFile`, `fileInfo` and `exec` all worked in `/project`. `exec`
   streamed its output. A whole start took about 1.5 s through
   `container exec`.
   - **`process.execPath` is the loader**
     (`/pineta-runtime/node/ld-linux-aarch64.so.1`), and `argv0` is the Node
     binary. Anything that re-executes `process.execPath` would start the
     loader with no program. pi's environment never does.
   - **With no `bash`, pi's `exec` falls back to `sh`** (`shell=sh`).
   - **Pineta's `node` stays off the `PATH`.** With `/pineta-runtime/bin` last on
     the `PATH`, `command -v node` found nothing, and `jj` resolved to the
     runtime's.
   - **The image's git ran alongside it:** Alpine's git 2.49.1, installed with
     `apk add git`.
3. **A write to a read-only `/yours` fails, with code `unknown`.** It comes
   back as `FileError` code `unknown`, with the message `EROFS: read-only file
   system`, not `permission_denied`. pi's tools report the message.
4. **A timeout kills the command's grandchildren in the guest.** For
   `sleep 30 & sleep 30` with `timeout: 1`, the call returned an
   `ExecutionError` with code `timeout` after 1009 ms. `ps` afterwards showed
   neither `sleep`.
5. **Errors come back inside results, as `Error` instances.** Every
   environment method returns `{ ok, value }` or `{ ok: false, error }`, and
   the error is a `FileError` or `ExecutionError`. `JSON.stringify` makes an
   `Error` `{}`, so the lane protocol must encode errors nested anywhere in a
   result, not only when a call throws.
6. **A fresh journaled volume holds `lost+found`,** so `jj git clone` into
   `/project` refuses it: "Destination path exists and is not an empty
   directory". This was checked with jj 0.44 on the host, using a directory
   holding `lost+found`. `git init`, then `jj git init --colocate`, in the
   directory works.
7. **A commit fetched by id is invisible to jj unless a branch ref names it.**
   The repo has `jj git init --colocate` already done, and `/yours` is a
   read-only colocated repo.
   - `git fetch /yours <id>`, then `jj new <id>`, fails: "Revision … doesn't
     exist".
   - The same happens when the fetch writes `refs/pineta/yours`.
   - `git fetch /yours +<id>:refs/heads/pineta-yours`, then `jj new <id>`,
     works in 117 ms, with the change ids the host has. jj imports only
     branches, remote branches and tags, so it sees a commit only when one
     of those points at it. The fetch leaves a bookmark in the lane's repo.
8. **After a git fetch into a colocated repo, a jj command run with
   `--ignore-working-copy` doesn't see it.** jj imports git's refs when it
   loads the working copy, and the flag skips that. Measured on a
   copy-on-write clone of Pineta's repo, which has 576 refs:
   - A plain `jj git import` prints "No import needed in colocated
     workspaces". It imports all the same, as a side effect of loading the
     workspace, and it also snapshots the working copy: 107 ms, recording an
     uncommitted edit into `@`.
   - `jj --ignore-working-copy git import` imports the refs only: 47 ms with
     a fetched bookmark, 12–13 ms with nothing new. It leaves `@` alone and
     records a single "import git refs" operation.

## What this means for the plan

- The runtime works as planned, on glibc and musl images, with or without
  Node. The helper must not re-execute `process.execPath`.
- A lane fetches a commit by id into a branch ref, never with no destination:
  `git cat-file -e <c> || git fetch /yours +<c>:refs/heads/<name>`. A
  commit already on the lane's disk, as in a fork, needs no fetch.
- Every git fetch into a colocated repo, the lane's or yours, ends with
  `jj --ignore-working-copy git import`, so jj sees the fetched refs without
  snapshotting anyone's working copy.
- The base disk is made with `git init` and `jj git init --colocate`, then
  fetching your `@-` by id, not with `jj git clone`. That also skips fetching
  every bookmark (1.2 s on Pineta's repo, S43 item 5).
- The lane protocol encodes `Error` values wherever they appear in a result.

## Not measured

- An image with no git, or git older than 2.41. The host's check refuses those
  before the helper starts.
- The runtime on a glibc image other than Debian's, and on x86_64.
- The helper serving the tools over a long-lived `container exec -i` stream on
  Alpine. S43 did that on Debian, with the image's own Node.

## Method

`sandbox/s44/`: `extract.sh` ran in `s42-lane:2` and copied the runtime to
`sandbox/s44/runtime/`. `guest.ts` ran in an `alpine:3.22` container with
`--init`, on a journaled 2 GiB volume at `/project`. That container had a
throwaway repo read-only at `/yours`, Pineta's working copy read-only at
`/pineta`, and the runtime read-only at `/pineta-runtime`. The fetch checks
used a three-commit colocated repo as `/yours`. The import timings (item 8)
were taken on the host, on a `/bin/cp -c -R` clone of Pineta's repo. A
bookmark was fetched in from a git bundle, and the clone was deleted
afterwards. The container, volume and repo
were removed afterwards.
