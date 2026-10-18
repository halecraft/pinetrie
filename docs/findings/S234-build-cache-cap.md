# S234 — Does a daemon's BuildKit garbage collection keep a nested lane's build cache to a cap, and which entries go

- **Status:** Answered (in a rootless daemon; the lane VM's own not measured)
- **Led to:** ADR-0169

**Question.** ADR-0169 has a daemon pine·trie runs bound its own build
cache to about one cold build of the lane image (S232: 1.93 GB), least
recently used first, configured, not pruned by the host. Under Docker 29's
rootless dockerd with containerd's image store, as a nested lane runs it:
which `daemon.json` setting does that (`builder.gc`, and which of its
fields), where does the rootless daemon read it, does it act on its own
after a build, and does it keep the current image's cache, so that a late
change to the Containerfile still builds from cache?

**Kill criterion.** If the daemon's setting does not bound the cache after
builds, or evicts the current image's records before older ones, the cap
cannot be left to the daemon, and the host must prune the cache itself.

**Throw away.** The scratch nested lane and its disks under
`/var/lib/lanehost/spike/` in the lane VM.

## Answers

Measured 2026-10-18 in the Mac's lane VM, in a scratch nested lane made as
S232's, its inner Docker rootless 29.8.2; and read from BuildKit's source
(`moby/buildkit`, `control/control.go` and `cache/manager.go`, master).

- **The defaults are fractions of the disk the data root is on,** which in
  a nested lane is the lane VM's whole data disk: `docker buildx inspect`
  showed reserved 27 GiB, max used 215 GiB and min free 54 GiB on the
  288 GiB disk. So each nested lane's cache could grow to 215 GiB, and
  collection began only when the shared disk was nearly full.
- **The setting:** `builder.gc` in the daemon's `daemon.json`, with
  `enabled`, `defaultReservedSpace`, `defaultMaxUsedSpace` and
  `defaultMinFreeSpace`. The rootless daemon reads
  `/home/rootless/.config/docker/daemon.json`, the file the lane image
  already writes for runc's `NoNewKeyring`: the GC keys go beside those,
  and replacing the file loses them. The daemon applies the three values to
  its policy's last three rules (`docker buildx inspect`); its first rule,
  for local sources, cache mounts and git checkouts, takes its own.
- **When it runs:** a minute after a build ends, throttled to once a minute
  (`throttle.After(time.Minute, c.gc)`, scheduled after every solve and
  once when the controller is made). Nothing else triggers it.
- **What it counts and removes:** only cache records no image's layers
  use. `prune` sums the size of records that are not `Shared`, and
  `pruneOnce` skips shared ones unless a rule says `All`; it removes the
  least recently used first, down to the larger of the max used and the
  reserved space. `docker buildx du` prints the split as Shared and
  Private.
- **So the cap bounds the cache beside the images, not the images'.**
  With the older version's tag still present, its records are shared and
  never counted: a clone holding two versions kept 3.5 GB of cache, 1.58 GB
  private, under a 2 GB cap, through four builds and two restarts. Once
  the older tag is removed and a build follows, its records are private,
  and the cap removes them: with the cap at 512 MB (reserved 256 MB), the
  private cache fell from 1.58 GB to 265 MB, the data root from 4.7 to
  3.45 GB, and a late change to the Containerfile still found its 3 `RUN`
  steps cached.
- **One run of three trimmed more:** in one of three clones built side by
  side under the 512 MB cap, the cache fell to 350 MB in all, the current
  image's records with it; its image still ran, but a later build from it
  reused only the base. Not explained.
- **The cache costs:** the current image with its shared records took
  3.45 GB on disk; with every record pruned, 1.85 GB (S232). The
  difference is what a late change's build saves, about 3 minutes.

The kill criterion does not fire, with a condition: the daemon bounds the
cache, but only once the host has removed the older tags, and only at the
next build. A lane VM's root dockerd uses the same BuildKit; its
`daemon.json` is on the read-only system image, so the setting is the
image's; not measured there.
