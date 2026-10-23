# S326 — A lanehost server dies with its host, at most its call in flight after it, and a flock its child holds keeps a second host out and frees itself, once the server ends the child's stdin as its own ends

- **Status:** Answered
- **Led to:** ADR-0210, ADR-0211

**Question.** A disks role's server is a `docker exec -i` process in a
container that outlives its host, stopped only when its host ends its
stdin (`packages/lanehost/server.ts`). The store's upkeep wants one host
per project, held by a lock the kernel keeps: a child of the server holding
an exclusive, non-blocking `flock` on `projects/<key>/host.lock` for the
server's life. Node has no `flock` (`packages/vm/TECHNICAL.md`), and a pid
means nothing across containers.

1. When the host is killed with `SIGKILL`, does Docker end the exec'd
   server's stdin, over the lane VM's socket bridge as on Linux, and does
   the server exit?
2. Does a server mid-call (a long diff) exit once that call ends?
3. Does busybox's `flock` applet in the lanehost image, held by a child
   (`flock -n <file> sh -c 'echo held; exec cat'`, its stdin a pipe from
   the server), refuse a second holder in another container on the same
   filesystem; say `held` only once it holds the lock; and free the lock
   when the server dies, `SIGKILL` included? And does that child keep a
   server whose stdin ended from exiting?

**Kill criterion.** The lock as planned is not sound if a server outlives
its host in any of these, or the lock is not seen across containers, or
not freed with its holder. Then a host's start must find and stop its old
server, and the plan's lock task is rewritten against the answer.

**Throw away.** The probe's lane VM and its containers, the probe's
project; its scripts are kept in its folder of sources only if the plan
builds on them.

## Answers

1. **A server does not outlive its host.**
   - **On the Mac, a dead host's servers die at once.** The stand-in host
     (the real runtime, `findProject` then `ready`, on a lane VM of its
     own through the real launcher, kept up as another host would keep it)
     was killed with `SIGKILL`. Its disks and privileged servers were gone
     by the first poll, 0.1 s later, idle or 0.1 s into a 9.6 s diff
     (`kill-mac-idle.txt`). The host's lease connection ends with it, and
     its slot empties (`packages/vm/TECHNICAL.md`, "A slot empties when its
     lease's connection ends"): the server runs from the slot's
     `/pinetrie` and `/pinetrie-runtime`, which go too. A server started
     after it cannot start from them either.
   - **A client killed with `SIGKILL` ends its exec's stdin, and sends no
     signal.** Through the lane VM's bridge, an exec'd shell logging its
     signals and its stdin (`sigprobe.sh`) saw `stdin-ended` and no
     signal, and ran on. From a Docker CLI inside the VM, the servers'
     exits below show their stdin ended; no signal probe ran there.
   - **So where a server's mounts outlive its host (Linux, and on the Mac
     a client killed while its host lives), the server ends as `serve`
     does when stdin closes** (`packages/channel/serve.ts`): idle, at
     once, through the bridge as from a Docker CLI inside the VM
     (`linux-idle.txt`).
2. **A server mid-call exits once that call ends, and not before.** No
   disks or privileged call heeds `serve`'s abort signal (each makes its
   own; `diff` has `DIFF_TIMEOUT_MS`, 120 s, in
   `packages/lanehost/btrfs.ts`). A privileged server started by hand, a
   diff of 400,000 files (9.6 s alone, `host-long.txt`) sent to it and its
   client killed a second later, was gone 8.1 s after the kill through the
   bridge (`midcall-mac.txt`) and 7.8 s after it from a Docker CLI inside
   the VM (`linux-diff.txt`): the diff's rest, then the exit. So on Linux
   a host restarted right after a crash can find its old server alive for
   as long as that server's last call takes, at most a diff's 120 s.
3. **Busybox's `flock` keeps the lock across containers and frees it with
   its holder, if the holder ends its child's stdin as its own ends**
   (`lock.txt`; `holder.cjs` stands in for the server, `lock.sh` drives
   it, in the project's disks container and a second container from the
   same image binding the same lanes directory).
   - **The image has it:** `/usr/bin/flock` is busybox 1.37.0's applet
     (Alpine 3.23.6). It forks: `flock` holds the lock and waits on its
     program, `sh`, which `exec`s `cat`. One `FLOCK` line in
     `/proc/locks`.
   - **`held` comes only once the lock is held:** the program runs only
     after `flock` takes it. A second `flock -n` in the other container
     exits 1 at once and prints nothing; a second holder there hears its
     child exit 1 with no `held`.
   - **A holder killed with `SIGKILL` frees the lock:** its pipe to the
     child closes, `cat` ends, `flock` exits, and the other container
     takes the lock at once.
   - **But a holder whose stdin ends does not exit** while its child's
     stdin pipe is open: the child keeps Node's event loop alive, so the
     server never exits and the lock is never freed (`== B`). Ending the
     child's stdin when the server's own stdin ends lets both exit and
     frees the lock (`== C`).
   - **The privileged role cannot take it:** it has the lanes directory
     read-only (`touch` fails with `Read-only file system`). The disks
     role has it read-write.

**What the plan builds on.** The lock as planned is sound, with two
changes. The server ends its lock child's stdin when `serve`'s input
closes, or it never exits. And on Linux, a host restarted within its
dead server's last call meets the lock held: its start says so, as a host
that is stopping, and not only as another host serving the project.

**Aside.** A diff of 1,000,000 changed paths had the privileged role
killed for memory (exit 137, its limit 256 MiB), and a second server
beside one that had just answered two diffs of 400,000 paths had one of
them killed (an `oom` event for the container). How a diff's memory
grows with its paths is for the role's memory, as S325 is for the
observer's.

**How it was run.** `host.ts` is the stand-in host (the real runtime and
lanehost, on a lane VM of its own with the contract scenario's data
image); `midcall.sh` starts a role's server by hand through the bridge and
kills its client a second into a diff; `linux.sh` does the same from a
`docker:cli` container on the VM's own socket; `holder.cjs` and `lock.sh`
are the lock's test. The VM's Docker was 29.5.2; the CLI inside it
29.9.2.
