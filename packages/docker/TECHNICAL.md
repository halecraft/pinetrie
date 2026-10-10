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
| `sshAgent` | the slot's socket in the VM | `$SSH_AUTH_SOCK` |
| lanes directory | `/var/lib/lanehost`, the VM's data disk | `$XDG_STATE_HOME/pinetrie/lanes`, or `/var/lib/pinetrie-lanes` in a nested lane |

It declares `@pinetrie/core` and `@pinetrie/lanes`, and only the app
declares it (`workspace.test.ts`).

## Where things are

- `plan.ts`: every decision, pure: `renderRun` (a lane's shape as a
  `ContainerSpec`), `renderHelper` (a lanehost role's), the labels both
  carry (`projectLabels`), `planDockerHost` and `dockerWords` (startup
  refusals), the sweeps (`planSlotSweep`, `planProjectSweep`), and the
  readers of `docker info`'s options and `/proc/self/mountinfo`.
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
  mount is JSON, so any path can be named.
- **An image that is not here is pulled** at a container's create, as
  `docker run` would.
- **The CLI stays for three things:** `buildx build`, `exec -i` (a lane's
  channel and lanehost's), and a throwaway container's stdout as bytes
  (`runInImage`). The startup's check that the CLI and buildx answer is the
  CLI's too.

## Disks: lanehost's (ADR-0129)

- **Every disk operation is a call to lanehost** (`@pinetrie/lanehost`,
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
  its own version of the server.
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
- **No trim:** btrfs frees what a lane deletes. `stop` does nothing more.

## Networks, and the host's ports (S136)

- **Each project's lanes are on a Docker network of their own**
  (`pinetrie-<project key>`, labelled with the project), made at startup
  (`sweepProjects`), and removed by the startup sweep with its project. A project's
  grant applies to its network's addresses only, as the VM is every host's.
- **`lanes.hostPorts`** in a project's `pinetrie.json` lists ports of the
  Mac's loopback its lanes may reach, at `gvproxy`'s host address
  (`192.168.127.254`). The host writes them into the VM's firewall at its
  start (`grantHostPorts`): a chain per project (`PT-<key>`), jumped to
  from `DOCKER-USER` for the project's subnet, above the init's fence,
  replacing its earlier rules. Lanehost's privileged role writes them, on
  the VM's own network with `NET_ADMIN` (`packages/lanehost/grants.ts`): the
  host, which holds Docker's socket, may; a lane never can. A lane is told
  the address and ports (`PINETRIE_HOST`,
  `PINETRIE_HOST_PORTS`). The host's own port is refused: on loopback it
  takes no key (`planHostPortGrant`).
- **On Linux the grant applies to nothing:** a lane reaches the host's
  services bound to all interfaces at Docker's bridge gateway, and never
  its loopback. The host says so once.

## What a lane never gets

`renderRun` never passes `--privileged`, `--cap-add` or a Docker socket
(ADR-0130): a lane with the VM's socket reads every lane's disk (S125).
Every lane but a nested one runs with `no-new-privileges`. Under Docker's
default seccomp profile a lane cannot open a vsock socket (S128), so it
never reaches the VM's Docker or the launcher's ports.

## The sweeps

- **Before a slot is filled:** every container labelled with it
  (`sweepSlot`). They belong to a host that died holding the slot, and
  filling it would cut their mounts, or show them the new host's
  directories (S130).
- **At startup, once the slot is filled:** the containers and disks of every
  project whose root is gone (`sweepProjects`), as the suites' throwaway
  projects are.

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
  profile refuses `keyctl`, which runc's session keyring needs (S125).
- **Inner lanes have no limits of their own,** and cannot be privileged
  (S125): the outer lane's limits hold for all of them.
- **A host in a nested lane** gets `docker-host` from `planRuntime`, its
  lanes directory `/var/lib/pinetrie-lanes`. Its lanes' root is uid 1000
  outside, so a directory they write must be that user's: the suites hand
  each throwaway project to it (`ownForInnerLanes`).

## The `contract` scenario under Docker

`pnpm run e2e:lanes` (Docker is the suites' default), mutations in
`scripts/mutations/docker.ts`.
On the Mac it runs a VM of its own, from this checkout's launcher (built
again for a mutated one) and the built image, in a throwaway state
directory, so the person's hosts are untouched and its cold start is
measured. Its checks:
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
- costs: `docker run -d` under 150 ms, a snapshot under 50 ms, a cold VM's
  Docker answering under 2 s; the launcher's open files in the detail.
