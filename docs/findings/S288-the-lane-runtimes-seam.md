# S288 — a lane runtime is containers, images and a lanehost to reach; its disk calls are lanehost's, and Docker is in lanehost only as a nested lane's inner Docker

Numbered S269 until 2026-10-21, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0205

**Question.** `LaneRuntime` (`packages/lanes/runtime-port.ts`) is every
call the host makes to a runtime, and `@pinetrie/docker`'s
`dockerRuntime` its one implementation. Another runtime (Podman, Apple's
container tool, Firecracker, a remote machine) would implement it again.

1. Which of its calls are about containers, and which about disks? Who
   calls each?
2. What of `dockerRuntime`'s disk calls is Docker's, and what is
   lanehost's?
3. Where is Docker named in `@pinetrie/lanehost` and `@pinetrie/lanes`,
   which ARCHITECTURE.md and ADR-0129 say know nothing of Docker, and
   which implement no runtime? Which of those is a lane feature, and which
   Docker's own?

**Kill criterion.** If `dockerRuntime`'s disk calls depend on Docker beyond
reaching lanehost's roles, the disks cannot be named apart from the
runtime, and the plan keeps `LaneRuntime` whole.

**Throw away.** Nothing ran; read from source at the merge of 2026-10-19
(after `Observer` and `Served` left `LaneRuntime`).

## Answers

1. **`LaneRuntime` is three groups, and its callers already take one
   group each** (call sites outside tests):

| group | calls | callers |
|---|---|---|
| disks | `disk`, `diskExists`, `snapshotExists`, `snapshots`, `diff`, `readLaneFile` | the folder adapter (`host/folder/*`, each typed `Pick<LaneRuntime, "diff" \| "disk" \| "snapshotExists">` or less), `host/work/turns.ts` (`diff`), `host/work/containers.ts`, `host/work/create.ts`, `lanes/base.ts` (`readLaneFile`), `lanes/execute.ts`, `lanes/lane.ts` |
| containers | `runSpec`, `run`, `containerFacts`, `start`, `stop`, `remove`, `execArgv` | `lanes/lane.ts`, `lanes/execute.ts`, `lanes/plan.ts` (`runSpec`), `host/work/containers.ts`, `host/jj/fetch.ts` (`containerFacts`) |
| images | `ensureLaneImages`, `imagePath`, `runInImage` | `lanes/image.ts`, `lanes/runtime.ts`, `host/work/setup.ts` |

   Observing a lane left `LaneRuntime` on 2026-10-19 (`Observer`, reached
   through `Served`), and a folder project's merges were never in it
   (`FolderDisks`, `folder-disks-port.ts`).

2. **Every disk call of `dockerRuntime` is one lanehost call, and Docker
   only opens the channel** (`packages/docker/runtime.ts`):
   - `disk`, `diskExists`, `snapshotExists`, `snapshots`, `diff`,
     `readLaneFile` and every `FolderDisks` call is
     `lanehost.call({ kind, project: key, … })`.
   - Docker's part is `openRole`: a role's container made from
     `renderHelper`'s spec (`ensureContainer`), then the server run in it
     by `docker exec -i`; and `snapshotOut`, a disks role's command by
     `docker exec -i` (`tarOut`, `fileOut`).
   - **Two disk steps hide inside `run`:** a nested lane's `nested-disk`
     and a folder lane's `states-dir`, made before the container, since a
     bind's source must be there.
   - **A container binds lanehost's paths:** `renderRun`
     (`packages/docker/plan.ts`) takes its bind sources from lanehost's
     `projectDisks` (`lane`, `nested`, `states`), and `snapshotOut` names a
     snapshot's path. That is the store's one contract with the runtime
     (S301).

   The kill criterion does not hold: the disks are lanehost's, reached
   through any runtime that can make a role's container and `exec -i` in
   it.

3. **Docker in lanehost** (code, comments left out):
   - `INNER_DOCKER_DATA_ROOT_DIR` (`layout.ts`) and `ROOTLESS_UID`
     (`disks.ts`), both exported, and `planInnerDockerDataRootSteps`
     (`disks.ts`, the `nested-disk` call): a nested lane's inner Docker's
     data root, a subvolume of the nested disk owned by the rootless user.
     ADR-0169 put it there on 2026-10-18; ADR-0129's "knows nothing of
     lanes or Docker" predates it, and ARCHITECTURE.md and lanehost's
     TECHNICAL.md still say it.
   - `rootless` (`RoleFacts`, `serving.ts`, `ObserverFacts`): the machine's
     fact that no capability reaches the host's user namespace, which picks
     the walk over `btrfs send` (`planRoles`) and refuses the observer
     (`planObserver`). It is a fact of the machine, gathered by Docker
     (`dockerRootless`), and named by Docker's word for it.
   - `@pinetrie/docker` re-exports lanehost's `projectDisks` and
     `ROOTLESS_UID` (`packages/docker/index.ts`), and declares
     `@pinetrie/lanehost`, `@pinetrie/channel` and `@pinetrie/install`,
     where its TECHNICAL.md says it declares core and lanes.

   **Docker in lanes:** of `plan.ts`'s 29 mentions (the survey counted
   39 before the merge, with comments), all but two are the nested lane's
   inner Docker and its data root: `InnerDockerDataRoots`,
   `planInnerDockerDataRootSource`, `innerDockerDataRootStep`, and the
   `inner-docker-data-root` `DiskOp` (`runtime-port.ts`); the two say a
   nested lane's lanes run on rootless Docker (`LaneGrants.nested`,
   `ContainerShape.nested`). `lane.ts` names the note a nested lane is
   pointed at (`nestedLaneDockerNote`). The decisions are a
   runtime's cache kept fresh across lanes: a clone of the data root of
   the nested lane that ran last (ADR-0169), whatever the inner runtime
   is. Images are Containerfiles (`ImagePlan`, `Containerfile`), the OCI
   build file Podman and buildx both read, not Docker's.

   So **what is Docker's** is three values: the data root's directory
   (`docker`), its owner (uid 1000, the lane image's `rootless` user,
   which `INNER_DOCKER_HOST` in `packages/docker/plan.ts` also names), and
   the word `rootless`. **What is a lane feature** is a nested lane, its
   inner runtime's data root, and keeping that fresh: lanes and lanehost
   hold those rightly, under Docker's name.
