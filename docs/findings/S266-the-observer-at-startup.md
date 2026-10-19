# S266 — The observer's build is a second warm and a minute cold; a host can make it ready before any lane, if it holds a connection

- **Status:** Answered
- **Led to:** ADR-0191

**Question.** Every lane's link registers the lane with the machine's
observer (`laneLinkOpener`, `apps/pinetrie/host/work/registry.ts`), and the
first to do so builds the observer's image and starts its container
(`openObserver`, `packages/docker/runtime.ts`). Its tag hashes every file
in `packages/lanehost/observer`, `packages/lanehost`, `packages/channel`
and `packages/core` (`OBSERVER_SOURCE_DIRS`,
`packages/lanehost/index.ts`), so it changes with most of pine·trie's
changes: Duane's lane VM held three tags on 2026-10-19.

1. What does a build take on the lane VM: with BuildKit's cache warm
   from the last tag (the usual case: a change to `packages/core`), and
   with no cache?
2. Can the host make the observer ready with no lane: build its image,
   start its container and connect, then let go? What does the role do
   with a connection that registers nothing (`planIdle`: it exits 60 s
   after its last connection), and does the first lane after that find
   the container gone and start it again without a build?
3. Is anything the observer needs missing before the slot is filled?
   `openObserver` refuses until `serveFrom` has named the install and the
   lane runtime.

**Kill criterion.** If a warm build takes under 5 s and the container
starts in under 2 s, making it ready at startup buys little against the
plan's cost, and the plan leaves the observer to the first lane. If the
role cannot be started with no lane, the startup builds the image only.

**Throw away.** The probe's tags (`pinetrie-observer:s266-*`) and
containers.

## Answers

1. **A warm build takes 0.8 s; a cold one 56 s.** Built on the lane VM
   with the host's own command (`buildObserverImage`'s arguments):
   - unchanged sources: 0.8 s, every step cached;
   - `packages/core` changed (one line added to a copy): 0.8 s, only the
     machine stage's `COPY --from=install core` and after run again;
   - `--no-cache`: 55.8 s, 48.6 s of it `apk add` of clang, llvm and
     libbpf, 2.3 s compiling the BPF program and loader. Alpine's base
     image was already pulled.

   The VM's BuildKit keeps 512 MB of cache (`packages/vm/image/daemon.json`,
   `defaultMaxUsedSpace`), and the lane image's layers alone are larger:
   Duane's VM held 536.7 MB private of 3.2 GB reclaimable. A lane image
   build can evict the observer's build stage, so the next observer tag
   builds cold. Not measured: how often that happens.
2. **The role starts with no lane, and exits unless a host holds a
   connection.** A container made from `renderObserver`'s spec answered
   `docker run` in 0.11 s and had its socket at 0.32 s. Still running at
   30 s, it was gone at 75 s: the role exits 60 s after its last
   connection, or after it started with none (`planIdle`), and the
   container removes itself.
   - Read from source: the host's side holds one channel for every lane
     once opened (`observerClient`, `packages/lanehost/observer-client.ts`):
     it checks the loader's hello (`loaderRefusal`) and subscribes, and
     registers lanes only as they come. Opening that channel at startup,
     with no lane, keeps the role while the host runs, and refuses where
     the loader cannot load. Nothing opens it except `observe` today.
   - A role that exits anyway (another host's, a VM restart) is started
     again by the next lane in 0.3 s: the image is there.
3. **Nothing it needs is missing once the slot is filled.** `serveFrom`
   names the install and the runtime in the runtime's `ready`, which the
   preparation runs before the base snapshot; S265's moved restart built
   and started the observer from there.

**Kill criterion.** Half fired: a warm build is under 5 s and the start
under 2 s, but a cold build is 56 s and can follow any lane image build.
Making the observer ready at startup is worth it for the cold case, and
for refusing a start on a kernel the loader cannot use.

**Thrown away:** the tags `pinetrie-observer:s266-same`, `s266-core` and
`s266-cold`, the copy of the packages, and the probe.
