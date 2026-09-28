# S43 — pi's tools in a lane's container, moving commits, a turn's cost, and what a lane reaches

ADR-0034 (proposed) runs every lane's tools in a Linux container on its own
disk, and moves work between repos as commits. Its "Not measured" list held
the pieces the plan depends on: pi's tools through `container exec`, how the
host gets a lane's commits, fetching from a read-only `/yours`, a turn's cost
in full, and what a lane can reach on the host.

**Answers.**

1. **pi's four tools use 8 of `ExecutionEnv`'s methods.** Run on the host with
   a logging proxy around `NodeExecutionEnv`: `absolutePath`, `canonicalPath`,
   `exists`, `fileInfo`, `readTextFile`, `readBinaryFile`, `writeFile`, `exec`.
   `edit` is a `fileInfo`, a `readTextFile` and a `writeFile`.
2. **pi's own `NodeExecutionEnv`, run in the lane behind one long-lived
   `container exec -i` stream, serves the tools unchanged.** A helper in the
   container imports pi-agent-core (mounted read-only) and answers JSON lines;
   the host's environment is a proxy that forwards each call, streams
   `onUpdate`, and sends an abort when the call's `Context` aborts. With pi's
   real harness and tools and the scripted model:
   - `write`, `read`, `edit` worked on the lane's disk; each environment call
     took 0.3–1 ms (a `container exec` per call would take 50–70 ms, S39);
   - `bash` ran in `/project` and streamed 7 output updates to the host;
   - a `bash` timeout killed its backgrounded grandchild in the guest (0
     survivors), and aborting the run mid-command killed both running
     processes (2 before, 0 after), with `--init` in the container;
   - two defects of the probe, fixed: `Buffer`'s own `toJSON` runs before a
     `JSON.stringify` replacer, so bytes need handling in that shape; and
     killing the `container exec` process fails to forward the signal
     ("missing signal in xpc message"), so the stream is closed by ending its
     input.
3. **The host can fetch a lane's commits two ways, in about 0.1 s.**
   - git's `ext::` transport running `git-upload-pack` in the lane through
     `container exec`: `git fetch` 98–131 ms, `jj git fetch` 140 ms, change
     ids intact. It needs `protocol.ext.allow` in the receiving repo's
     config, which lets any `ext::` remote URL in that repo run a command.
   - `git bundle create -` in the lane, written to the host's stdout, then
     `git fetch` from the file: 107 ms, and jj imports it; no configuration.
4. **A lane can clone and fetch from a read-only `/yours`, and nothing is
   written there.** `jj git clone` 58 ms (a throwaway repo), fetch 7 ms; a
   write to `/yours` failed ("Read-only file system"), and the repo gained no
   lock files.
5. **Your `@-` has to be fetched by id.** `jj git clone` of Pineta's real
   repository (read-only, 104 MB of loose objects) took 1.2 s but checked out
   nothing: it fetches bookmarks and checks out the remote's default branch,
   and a colocated repo's git `HEAD` is detached, with `@-` on no bookmark.
   `git fetch /yours <commit id>` fetched it (193 ms), and `jj new` on it
   checked out 179 files.
6. **A whole turn costs about 250–300 ms.** On that clone, with dependencies
   installed (`pnpm install` 5.9 s from a warm store; a 490 MiB disk), five
   turns each edited a tracked file and wrote 2 MB of ignored cache:

   | step | time |
   |---|---|
   | `jj commit` and bookmark | 84–110 ms |
   | `sync` in the lane | 52–73 ms |
   | clone of the disk | 5–9 ms |
   | fetch over `ext::` | 98–131 ms |

   The clones took 5–9 ms here against S40's 266–540 ms. S40's disk had been
   churned for minutes and this one was freshly written, so clone time likely
   grows with the image's fragmentation, not its size; not isolated.
7. **What a lane reaches on the host.**
   - Services the host binds to all interfaces are reachable at the network's
     gateway, `192.168.64.1`, with no grant: the Playwright server on `:3100`
     answered `200`. The lane also reaches the internet.
   - A service bound to the host's loopback is not ("connection refused").
   - There is no host name alias (`host.container.internal` does not
     resolve).
   - `--ssh` forwards your ssh agent: `ssh-add -l` in the lane listed your key.
   - Your home directory is not mounted, so pi's `auth.json`, your git and npm
     credentials and your ssh keys are unreachable unless granted.
   - macOS's application firewall was off; with it on, a host process
     listening on all interfaces may prompt.

8. **A bundle must exclude what the host already has.** On a clone of
   Pineta's real repository, `git bundle create` of `main` whole took 253 ms
   and 1.1 MB; of `main ^main~1` (one commit), 29 ms and 8 KB. A bundle per
   turn that names only the lane's bookmark would grow with the repository's
   history. (Measured while checking `PLAN-2026-09-28-lane-containers`.)

## What this means for the design

- A lane's tools: one helper process per running lane, serving pi's own
  `NodeExecutionEnv`, and a host proxy environment. No per-call process.
- The host gets a lane's commits by bundle, needing no change to your repo's
  configuration; `ext::` would need one that loosens it for every remote. Each
  bundle excludes the commit the host already has (item 8).
- A lane is given your `@-` by commit id.
- The lane boundary is not closed by the container alone: host services on
  all interfaces and the internet are open. Credentials are closed until
  granted; `--ssh` is the grant for git over ssh.

## Not measured

- Restricting a lane's network (to the internet, or to named host ports).
- The helper under concurrent tool calls from one turn (pi runs them in
  parallel); here they ran one at a time.
- `jj git fetch` from a bundle file by jj itself rather than `git fetch`.
- Clone time against image fragmentation, isolated.
- MCP servers or extension tools, which Pineta does not expose today.

## Method

`sandbox/s43/` in lane `t-01a0e616-…`'s workspace (ignored): `discover.ts`
(pi's tools on the host with a logging environment), `helper.mjs` (the guest
side), `remote-env.ts` (the host side), `run-remote.ts <container>` (pi's
harness and tools through it). Containers from `s42-lane:2` with `--init`, on
journaled volumes; pi-agent-core from this workspace mounted read-only at
`/pineta`. Fetches into a throwaway host repo; Pineta's real repository was
mounted read-only only. Everything created was removed after.
