# `@pinetrie/docker`: technical notes

Docker as a lane runtime (ADR-0130): `dockerRuntime`, the `LaneRuntime` of
`@pinetrie/lanes`' `runtime-port.ts`. One code path for the Mac and Linux:
they differ only in the `DockerTarget` the app hands it
(`apps/pinetrie/host/work/runtime.ts`):

| | the Mac | Linux |
|---|---|---|
| `socket` | the lane VM's `docker.sock` (the launcher's) | `$DOCKER_HOST`, else `/var/run/docker.sock` |
| `pathOf` | under the host's slot, `/mnt/host-shares/<slot>/<name>` | the path itself |
| `labels` | `pinetrie.slot=<slot>` | none |
| `hostSocket` | the slot's socket in the VM, bridged to the one the lease names (ADR-0140) | the host's ssh socket itself |
| lanes directory | `/var/lib/lanehost`, the VM's data disk | `$XDG_STATE_HOME/pinetrie/lanes`, or `/var/lib/pinetrie-lanes` in a nested lane |

It declares `@pinetrie/core`, `@pinetrie/lanes`, `@pinetrie/lanehost`,
`@pinetrie/channel` and `@pinetrie/install`, and only the app declares it
(`workspace.test.ts`). It implements `LaneContainers` and `LaneImages`, and
hosts lanehost's roles; its disks are lanehost's client, spread
(`lanehostDisks`, ADR-0205).

## Where things are

- `plan.ts`: every decision, pure: `renderRun` (a lane's shape as a
  `ContainerSpec`), `renderHelper` (a lanehost role's), the labels both
  carry (`projectLabels`), `planDockerHost` and `dockerWords` (startup
  refusals), the sweeps (`planSlotSweep`, `planProjectSweep`), the
  project's running lanes from Docker's list (`runningLanes`), what an
  `oom` event names (`parseOomEvent`, `killedService`, `eventsSince`,
  `isNewEvent`, `systemTimeNanos`), and the
  readers of `docker info`'s options and of the lanes directory's mount
  (`parseMountinfo`, over lanehost's `holdingMount`).
- `api.ts`: Docker's HTTP API over the target's socket, and a spec as its
  create (`createBody`, pure). `cli.ts`: the docker CLI with `-H
  unix://<socket>`, for what streams or builds. `facts.ts` gathers;
  `runtime.ts` composes them.
- `seccomp-nested.ts` writes `seccomp-nested.json` from
  `seccomp-default.json`.

## The API, and the CLI's three uses (S147)

- **Every runtime call is a request to Docker's API** (`api.ts`): about
  0.2 ms, where the CLI's own start costs 11–13 ms. A container is made
  from a `ContainerSpec`, a value: `createBody` turns it into the API's
  create, and its hash is its spec label, so it no longer depends on the
  order of flags. Every container runs `--init`.
- **What the CLI did for a flag, `createBody` does:** `seccomp=<path>`
  becomes the profile's content, read when the container is made, and
  `systempaths=unconfined` empties the masked and read-only paths. A
  mount is JSON, so any path can be named. A memory limit is read by
  core's `parseSize` (`memoryBytes`), the one parser of a size.
- **An image that is not here is built or pulled** at a container's
  create: built again from how this host built it when it is one of its
  own (another host removed it, below), else pulled, as `docker run` would
  (`isCreateRefusedForMissingImage`).
- **The CLI stays for three things:** `buildx build`, `exec -i` (a lane's
  channel and lanehost's), and a throwaway container's stdout as bytes
  (`runInImage`). The startup's check that the CLI and buildx answer is the
  CLI's too.

## The images a host keeps (ADR-0169)

- **One way to have an image** (`ensureImage`, the runtime's own): the lane
  images the host is given (`ensureLaneImages`), lanehost's and the
  observer's. Each is recorded as needed with how it is built (an
  `ImageRecipe`), then built unless Docker has it. The needed set is those
  recorded, and this host's lanehost and observer tags, built or not.
- **Every build is told first** (`dockerRuntime`'s `building`, with an
  `ImageBuild`), a tag another host removed included: the host's start
  shows what it builds (ADR-0191).
- **After any build of its own, the host removes pine·trie's images it does
  not need** (`unneededImageTags`): a tag of `pinetrie-lane`,
  `pinetrie-lanehost` or `pinetrie-observer` not in the needed set, on no
  image a container, running or stopped, was made from. The removal is a
  value, so no needed tag can be in it whatever repository it shares:
  pine·trie's default lane image and a project's own are both
  `pinetrie-lane`, so `ensureLaneImages` records every plan before it
  builds any. Docker's own refusal of an image a container uses spares
  another host's on the same Docker; a 404 or 409 is settled
  (`isImageRemovalSettled`), anything else logged.
- **Only after a build:** a host that builds nothing has nothing newer to
  keep, and may share the Docker with a host of the older version.
- **A tag another host removed is built again** when a container is made
  from it (`runContainer`'s `buildMissing`), lanehost's and the observer's
  containers included.
- **The cache beside the images is the daemon's to cap:** the lane VM's
  dockerd reads `packages/vm/image/daemon.json`, and a nested lane's
  rootless one `packages/lanes/image/daemon.json`, each with BuildKit's
  `builder.gc` at 512 MB (S234, S237). BuildKit counts and removes only
  cache no image uses, a minute after a build, so it trims an older
  version's cache once the host has removed its tag. A person's own Docker
  on Linux keeps its own policy.

## Disks: lanehost's (ADR-0129)

- **The disks are lanehost's client** (`lanehostDisks`), spread into the
  runtime: every disk call and every `FolderDisks` call is one lanehost
  call on the project's key. Docker gives it two things: each role's
  channel (`openRole`, below), and the stream of a disks role's own command
  (`tar-out.ts`, `file-out.ts`), a `docker exec -i` of its own in the disks
  role's container, which the client asks only after a `snapshot-exists`
  call that starts the container and refuses a gone snapshot. On the Mac
  both cross the lane VM as any exec does.
- **`run` makes only the container:** the folders a shape binds on
  lanehost's disks (`DiskBind`) are made by its start's plan before it
  (`packages/lanes/TECHNICAL.md`, Containers), and `renderRun` takes each
  bind's source from one table over lanehost's layout (`DISK_BIND`).
- **Each call goes to lanehost** (`@pinetrie/lanehost`,
  `packages/lanehost/TECHNICAL.md`), over one held `docker exec -i` per
  role: about 3 ms, against 28 ms for a `docker exec` per operation
  (S147). The runtime opens each role's channel at its first call
  (`openRole`): its image built if missing, its container made as
  `planContainer` decides, then the server started in it.
- **A role's container** is `pinetrie-lanehost-<role>-<project key>`, with
  `-<slot>` on the Mac (`lanehostContainer`). It carries the project's and
  the target's labels and its role's (`LANEHOST_LABEL`), so the slot's and
  the projects' sweeps take it. It mounts the lanes directory at its own
  path, and the host's install and lane runtime read-only at `/pinetrie`
  and `/pinetrie-runtime`, through `pathOf`, as a lane does: each host runs
  its own version of the server. The disks role also has the machine's
  `/sys/fs/cgroup` read-only at `HOST_CGROUP` (`cgroupMount`), with no
  `pathOf`: it is the VM's own on the Mac. It reads lanes' cgroups there
  for the machine's health; the privileged role is given none. Under
  rootless Docker (a nested lane's) neither is: no spike has shown it
  grants the bind, and a bind it refused would stop the role.
- **The machine is read through the runtime as raw values:**
  `runningLanes`, one listing of the project's containers,
  `machineSample`, one lanehost call, and `watchServiceKills`, the
  services killed for memory. Docker never imports `@pinetrie/machine`:
  the host maps them into its sample (`apps/pinetrie/host/machine/`).
- **A service's kill is heard on one held stream of Docker's events**
  (`followEvents`, `api.ts`; S324). The observer's container is removed
  with its kill, so no count of its outlives it; Docker's `oom` event does,
  naming the container. A role is named by its labels and this project's;
  the observer, which carries no project label, by its name for this
  host's version (none under a forwarded observer, which has no
  container). The daemon keeps its last 256 events, of every kind, so a
  poll each sample would lose an `oom` behind about 85 `docker exec`s; a
  stream filtered to `oom` loses nothing while connected. Its gotchas:
  - `timeNano` is read from the line's text: its 19 digits are past a JSON
    number's, and a rounded time would replay or skip an event.
  - A stream opened with `since` replays from it, the event *at* `since`
    included, so a resume skips what is not after the last heard.
  - Docker writes no headers until the first event, so before one the
    stream cannot say when it began: the first `since` is the daemon's
    clock, `/info`'s `SystemTime`, never the host's.
  - The socket is unref'd, and the machine watch closes it: a stream held
    for the host's life must not hold the host open.
  - It is opened again at the next sample after it ends (the lane VM or
    Docker restarted), from the last event heard or, before any, the first
    stream's start; a kill while it is down is heard if fewer than 256
    events pass first.
- **Every script it starts is the install's** (`dockerRuntime`'s
  `install`, `@pinetrie/install`'s `scriptCommand`): lanehost's server and
  its readers, the observer's server and its connection, each in the
  install's form as a container mounts it. The observer's image is made
  from that install's files, so a repo host and an installed one build
  images of their own.
- **Lanehost starts once setup names the install and the runtime**
  (`serveFrom`, from the mounts `Found.ready` is given): on the Mac they are
  in the slot only after its fill. A disk call before then is refused,
  naming why.
- **`sweepProjects` records the project's root first,** and makes its
  lanes' network, so no lane's start waits for either.
- **After a new lease** (`vmRestarted`) lanehost's channels are closed, and
  its image, containers and the network are made again at the next call
  that needs them.
- **Each project's disks are under its key** (`projectKey`, a hash of its
  root), as lanehost's `layout.ts` lays them out. A project's disks go with
  it, as one directory.
- **A container's name is the whole engine's,** so the one lane no thread
  owns, the base's scratch lane, is named by the project's key: the
  runtime's `baseLane` (ADR-0207). A thread's lane is named by its id,
  unique everywhere. An older install's `pinetrie-base-scratch`, left only
  by a host that stopped mid-build, goes with the Mac's slot sweep, or on
  Linux with its project's sweep.
- **No trim:** btrfs frees what a lane deletes. `stop` does nothing more.

## Networks, and the host's ports (S136)

- **Each project's lanes are on a Docker network of their own**
  (`pinetrie-<project key>`, labelled with the project), made at startup
  (`sweepProjects`), and removed by the startup sweep with its project. A project's
  grant applies to its network's addresses only, as the VM is every host's.
- **`lanes.hostPorts`** in a project's `pinetrie.json` lists ports of the
  Mac's loopback its lanes may reach, at `gvproxy`'s host address
  (`192.168.127.254`). The host writes them into the VM's firewall at its
  start, and again each time accepted work changes them (ADR-0141), before
  the new config is in force (`grantHostPorts`): a chain per project
  (`PT-<key>`), jumped to
  from `DOCKER-USER` for the project's subnet, above the init's fence,
  replacing its earlier rules. Lanehost's privileged role writes them, on
  the VM's own network with `NET_ADMIN` (`packages/lanehost/grants.ts`): the
  host, which holds Docker's socket, may; a lane never can. A lane is told
  the address and ports (`PINETRIE_HOST`,
  `PINETRIE_HOST_PORTS`), which a running lane keeps as it started. The
  host's own port is refused: on loopback it takes no key
  (`planShareAndGrant`, in the host's `work/shares.ts`).
- **A port taken out of the grant does not end a connection open on it**
  (S189): what the lane sends on it stops within 40 ms, and new
  connections are refused, but the fence matches only the lane's packets
  to the Mac's loopback, so the Mac's side goes on reaching the lane, and
  the connection carries on, losing nothing, if the port is granted
  again. It lasts until the lane's TCP gives up its retries.
- **On Linux the grant applies to nothing:** a lane reaches the host's
  services bound to all interfaces at Docker's bridge gateway, and never
  its loopback. The host says so once.

## A lane's command (`laneCommand`)

- **Its starts run first, then a nested lane's Docker, then the wait:**
  each start in a subshell sent to the background that exits at once, so
  `--init` adopts and reaps it, as the inner Docker is started. A lane with
  neither runs `sleep infinity` alone.
- **The host socket is mounted only when both sides name one:** the shape
  (`ContainerShape.hostSocket`, where in the lane) and the target (where on
  Docker's machine).

## What a lane never gets

`renderRun` never passes `--privileged`, `--cap-add` or a Docker socket
(ADR-0130): a lane with the VM's socket reads every lane's disk (S125).
Every lane but a nested one runs with `no-new-privileges`. A nested
lane's inner Docker keeps setuid, which its `newuidmap` needs. Under Docker's
default seccomp profile a lane cannot open a vsock socket (S128), so it
never reaches the VM's Docker or the launcher's ports.

## The sweeps

- **Before a slot is filled:** every container of any project with a bind
  into it (`sweepSlot`, given the slot's root in the VM: Docker knows no
  slot layout). They belong to a host that died holding the slot, its own
  or an extra one, and filling it would cut their mounts, or show them the
  new host's directories (S130). Read from each container's binds
  (`Mounts`), not a label: a container's labels name only its host's first
  slot, and `SLOT_LABEL` serves to name lanehost's containers.
- **At startup, once the slot is filled:** the containers and disks of every
  project whose root is gone (`sweepProjects`), as the suites' throwaway
  projects are; and the containers of a project lanehost does not list,
  as a nested lane's inner Docker cloned from another lane's carries (S235),
  but only those whose binds all lie in this host's lanes directory: another
  lanes directory on the same Docker lists its own. Such a project's
  network goes with the last of its containers.
- **A root is a whole path** (`isBindUnder`): `/mnt/host-shares/1` is not a
  root of `/mnt/host-shares/10/…`, with or without its trailing `/`.

## Lanes inside a lane (`lanes.nested`, S125)

- **The grant** is a project's: `lanes.nested: true` in `pinetrie.json`
  sets `ContainerShape.nested` for every lane.
- **A nested lane gets** the narrow seccomp profile, `systempaths=unconfined`,
  `/dev/net/tun` (made 0666 by the VM's init) and its inner lanes' subvolume
  at `/var/lib/pinetrie-lanes`, owned by uid 1000, with
  `DOCKER_HOST=unix:///run/user/1000/docker.sock`. It keeps setuid:
  rootless Docker's `newuidmap` needs it. Its command starts
  `pinetrie-inner-docker` (pine·trie's default image), which runs
  `dockerd-rootless.sh` as `rootless` (uid 1000), then waits. The command
  runs at each start of the container, whose `/run` outlives a stop, so the
  script first clears `/run/user/1000`: a stale pid file refused the daemon.
- **The profile** (`seccomp-nested.json`) is `moby/profiles`' default, at the
  commit `UPSTREAM` names, without the three rules that refuse `clone` with
  namespace flags and `clone3` to a container without `CAP_SYS_ADMIN`, and
  with one rule allowing the namespace and mount calls (`NESTED_CALLS`).
  `socket`'s rules are the default's, so AF_VSOCK stays refused.
  `node packages/docker/seccomp-nested.ts --fetch` rewrites both files;
  `seccomp-nested.test.ts` checks the one follows from the other.
- **runc's `NoNewKeyring`** is the inner Docker's default runtime: Docker's
  profile refuses `keyctl`, which runc's session keyring needs (S125). It
  is set in the lane image's `daemon.json`, beside the cache cap.
- **A nested lane's own host knows its Docker is rootless** from
  `docker info`'s `SecurityOptions` (`dockerRootless`, S148): no
  capability it grants reaches the host's user namespace.
- **Inner lanes have no limits of their own,** and cannot be privileged
  (S125): the outer lane's limits hold for all of them.
- **The inner Docker's data root is a subvolume of its own,**
  `nested/<lane>/docker`, so it is cloned without the inner lanehost's
  projects beside it (ADR-0169). At each fork and each run's start it is
  replaced by a clone of the project's nested lane that ran last
  (`packages/lanes/TECHNICAL.md`, Containers), so a version one lane built
  reaches the others for the cost of a clone (S233, S236); and the host in
  the lane prunes it as any host prunes its Docker (above).
- **Its directory and owner are docker's values** (`INNER_DOCKER_DATA_ROOT_DIR`,
  `ROOTLESS_UID`, as `NESTED_DISK`), beside `INNER_DOCKER_HOST` and the lane
  image's `--data-root`, which a test holds to them. lanehost is given them
  in its server's arguments and holds none (ADR-0205).
- **A host in a nested lane** gets `docker-host` from `planRuntime`, its
  lanes directory `/var/lib/pinetrie-lanes`. Its lanes' root is uid 1000
  outside, so a directory they write must be that user's: the suites hand
  each throwaway project to it (`ownForInnerLanes`).

## The `contract` scenario under Docker

`pnpm run e2e:lanes` (Docker is the suites' default), mutations in
`scripts/mutations/docker.ts`.
On the Mac it runs a VM of its own, from this checkout's launcher (built
again for a mutated one) and the built image, in a throwaway state
directory, so the person's hosts are untouched. Its checks:
- twenty snapshots taken while a lane writes each hold every record written
  before them;
- a diff between two snapshots of a lane reports a file it deleted, and one
  it made;
- lanehost's privileged role cannot write the lanes directory (where a grant
  made it: on the Mac);
- the working copy cannot be written from a lane, nor, on the Mac, from a
  container with `CAP_SYS_ADMIN` that remounts it: the share's read-only
  flag holds on the Mac's side (S128);
- `echo hi | docker run -i … cat` returns `hi` through the launcher;
- a lane's `socket(AF_VSOCK)` fails;
- a second host started and stopped beside the first leaves the first's
  lane reading its working copy and writing its shared directory;
- (Mac) a lane cannot reach the Mac's loopback, nor `gvproxy`'s API;
- (Mac) a port the project grants answers its lanes, and not another
  project's;

## The machine role's container

- **One per machine and version, for every project and host**
  (`renderObserver`): `pinetrie-observer-<version>`, from the image of the
  same tag, which `buildObserverImage` builds from the observer
  Containerfile's last stage with the lane runtime and pine·trie's packages
  as named contexts, so it mounts nothing from a host. Its spec is its
  version's alone, so every host of a version renders the same one. It
  carries no project or slot label, so no sweep takes it.
- **Its grant is `OBSERVER_GRANT`, and nothing more:** `CAP_BPF`,
  `CAP_PERFMON` and `CAP_SYS_PTRACE`, Docker's own seccomp profile, the
  host's pid namespace (its own cgroup namespace: nothing it does reads
  cgroups), a read-only root with a tmpfs at
  `/run`, no network, removed when it exits (`ContainerSpec.machine`). A
  test checks its body exactly (`api.test.ts`).
- **Made or joined by name, as a lane's container is** (`openObserver`,
  through `ensureContainer`, `runtime.ts`): every host of a version
  renders the same spec, so each joins the one running, and a failed
  `docker run` is fine when another host made it with that spec. One
  created and never started (its host stopped between the create and the
  start) is started: removal on exit never takes it, and a create of its
  name would fail as a conflict. A start that fails leaves nothing: Docker
  removes the container then (measured with Docker 29.8). Each host's
  channel is a `docker exec -i` of its connect script.
  The host reaches it only through what `serveFrom` returns (`Served`):
  `observer()` builds and joins it and holds this host's channel, which
  keeps the role from exiting idle while the host runs; the host's start
  calls it before any lane (ADR-0191). A new lease closes the channel; the
  next lane's observe opens it again and registers every lane again.
- **A lane is registered by its first process** (`containerPid`, the pid
  in Docker's machine's namespace), with its shared directories as remote
  where host paths reach the machine over virtiofs
  (`DockerTarget.remoteHostPaths`, the Mac). Its PID namespace is the
  observer's lane, so a lane's container always has one of its own:
  `renderRun` sets no `PidMode`, and a test says so.
- **Under rootless Docker in a lane, the observer is the lane helper's**
  (`dockerRuntime`'s `observer: "forwarded"`): a host there opens each
  channel by running the install's `observerConnect` on its own Node
  against core's `OBSERVER_SOCKET`, and makes no container. Its registrations are as a
  direct host's; the host outside makes them forwarded.
