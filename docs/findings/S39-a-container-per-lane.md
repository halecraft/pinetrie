# S39 — a Linux container per lane, with Apple's `container`

S38 found that rewriting paths in a lane's history cannot make the history
true: files the fork does not carry, paths the rewrite misses, and state that
is not files (a server on a port) all break the facade. macOS has no
per-process mounts, ports or process tables, so a lane can only have its own
by running in a Linux VM. Apple's `container` runs each container in its own
lightweight VM, with its own IP address. This probe asks whether one per lane
is practical for this repo.

Machine: macOS 26.6.2, M3 Max, 16 cores, 48 GB. `container` 1.4.1, the
recommended kernel (Kata 3.32.0), image `node:24-bookworm-slim` (linux/arm64).

**Answers.**

1. **Starting is cheap.** `container run --rm … node -e …` took 0.94 s cold,
   VM included (three runs). `container exec` into a running container took
   50–70 ms. A stopped container restarted in 0.7 s, and stopping took 0.3 s.
   One-time costs: 22 s to pull the image, 39 s to fetch the kernel.
2. **Each lane has its own ports.** Two containers each served on `:5173` at
   once; from the host, `192.168.64.6:5173` and `192.168.64.7:5173` answered
   with their own lane. Defaults: 4 CPUs and 1 GiB per container.
3. **Mounts give the guarantees S38 could not.**
   - A read-only mount refuses writes in the kernel: `echo > /yours/x` failed
     with "Read-only file system", `bash` included.
   - `realpath` inside shows the mount path, not the host's: nothing leaks.
   - Files written through a mount are owned by the host user.
4. **The suite runs at host speed once dependencies are off the mount.**
   - 401 of 401 unit tests passed.
   - With `node_modules` on the virtiofs mount: 15.6 s (host: 3.25 s).
     virtiofs is the whole difference: the same tree on the container's own
     disk ran in 3.36 s.
   - With pnpm's `virtual-store-dir` on the container's disk (`/nm`): 3.2 s,
     and only 176 KB of symlinks on the mount. The lane's host directory
     stays free of Linux binaries.
   - Installing (pnpm's own time, into `/nm`):

     | store | install |
     |---|---|
     | empty (downloads) | 6.5 s on a volume, 8.7 s in a host directory |
     | warm, on a named volume | 0.9–1.5 s |
     | warm, a host directory over virtiofs | 3.7–3.9 s (copied, not linked) |

     A first install that wrote `node_modules` over the mount took 24 s: the
     mount, not the store.
   - **A named volume serves one running container at a time.** It is an
     ext4 disk image (`volume.img`) attached to the VM as a block device; a
     second running container mounting it failed to start ("The storage device
     attachment is invalid"). A store every running lane can use is a host
     directory, at 3.7–3.9 s a lane.
5. **`jj` works inside, if the mounts keep its relative pointers.**
   - A lane's `.jj/repo` is `../../../.jj/repo`, and a colocated repo's
     `store/git_target` is `../../../.git`: they are resolved against the
     mount layout. Mounting the lane at `/r/workspace/lane`, the repo at
     `/r/.jj/repo` and `/r/.git` resolves both; `jj st` snapshotted a new file
     inside, and the host's `jj` stayed consistent across it.
   - Mounting them at `/` instead made `/` a repo, and the host's own
     `prepareProject` rightly refused it ("/ is your home directory or the
     file system's root"): the one unit test that failed until the layout
     changed.
   - The `link:` dependency on Kyneta resolves the same way: mounted at
     `/r/workspace/kyneta`.
   - So **every lane sees its workspace at the same path**,
     `/r/workspace/lane`. That is the property S38 was after, with nothing
     rewritten.
6. **The image needs `git`, `jj` and `--init`.** `git` for `prepareProject`;
   `jj` 0.44.0 from its release (musl, aarch64); `--init`, because with
   `sleep` as PID 1 nothing reaps killed processes, and the two
   `scripts/mutate.test.ts` tests that kill a process group saw zombies as
   alive. Installing `git` and `jj` at run time took 8 s; an image would hold
   them.
7. **A VM keeps the most memory its guest ever touched, until it stops.**
   - A fresh container's VM held 516 MiB on the host. After `pnpm install`
     from a warm host-directory store: 2.5 GiB. After the suite: 2.73 GiB, and
     still 2.76 GiB 30 s later.
   - The guest, then: 2.9 GiB of its 4 GiB free, 941 MiB of page cache, 12 MiB
     used by processes. The guest freed it; the host was never told.
     `container-runtime-linux` has no memory balloon or free-page reporting
     (no such strings in the binary), and `/proc/sys` is read-only inside, so
     the guest's cache cannot be dropped either.
   - Natively the same suite peaked at 1.77 GiB across its process tree (16
     cores, so more workers than the guest's 4), and all of it returned to
     macOS when the processes exited. File caching natively is macOS's
     shared, reclaimable cache, not any process's memory.
   - So a lane is not heavier while it works; it holds its high-water mark,
     guest file cache included, after it is done. The install was most of
     that mark (516 MiB to 2.5 GiB), the suite little of it.
   - Two idle containers that had done little went from about 520 MiB to
     52 MiB within minutes, so macOS does compress or page out an idle VM;
     under memory pressure this was not measured.
   - Stopping frees it all (0.3 s), and restarting keeps the container's disk
     (`/nm`, installed tools).

8. **A VM's disk forks copy-on-write in 50 ms.** A named volume is a sparse
   file on APFS (`volume.img`: 512 GB apparent, 353 MB allocated after 300 MB
   of writes). With no container attached, `/bin/cp -c` (clonefile) of lane
   A's image over a new volume's image took 50 ms and no free space. A
   container on the clone saw A's files (a 300 MB file, a `.vite` cache);
   its writes did not reach A, and A's did not reach it. GNU `cp`, first on
   this machine's `PATH`, has no `-c` (as in S36).

## What this means for the design

- A lane's tools run in its container: pi's `bash` through `container exec`
  (50–70 ms a command); `read`, `write` and `edit` through the mount on the
  host, or in the container. The model is told its directory is
  `/r/workspace/lane`, which is true in every lane, so a branch inherits a
  history that needs no rewriting.
- Your working copy is mounted read-only (here `/yours`), so no lane can
  write it.
- A lane's servers are its own; the host reaches them at the container's IP,
  and proxies them to browsers that cannot.
- Containers stop when a lane is idle and start again with its next run:
  memory grows with running lanes, not with lanes.
- An image per project, built with the project's tools. Dependencies:
  installed into the container's disk from a host-directory store (3.7–3.9 s,
  once per lane, since a restart keeps them), or built into the image per
  lockfile, which would also keep the install out of every lane's memory
  high-water mark (not measured).
- A memory limit per lane (`-m`) bounds the high-water mark, guest cache
  included.

## Not measured

- A lane's container running the e2e suite, the host, or the browser suite.
- Many lanes at once: memory and CPU under load, and whether the default
  network runs out of addresses (a /24).
- The host's side: turning pi's tools into `container exec`, and how jj's
  concurrent snapshots behave with one side in a VM (S36 item 6 measured two
  host processes).
- Whether a person's typed host paths should be translated to
  `/r/workspace/lane` at send time (S38).
- `container` on anything but this machine; it needs macOS 26 on Apple
  silicon.

## Method

Commands run by hand from lane `t-01a0e616-…`'s workspace. A disposable jj
workspace at `default@` (`962465c4`), `sandbox/s38-ct`, mounted into container
`s38-p` (`--init`, 4 GiB) with your working copy read-only, Kyneta read-only,
the repo's `.jj/repo` and `.git`, and a named volume for pnpm's store.
Containers `s38-a` and `s38-b` served `:5173`. For item 5's `jj` check the
workspace's `.jj/repo` was set to a real lane's `../../../.jj/repo` and put
back after (it lives two levels deeper than a lane). The containers, the
volume and the workspace were removed after; the image and the kernel remain.
