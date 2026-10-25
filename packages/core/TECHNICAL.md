# `@pinetrie/core`: technical notes

Core is the kernel every package names: ids, refusals, writes, and what a
lane, its disk and its history are (ADR-0201). It does no I/O, and imports
nothing but its own modules: no pi (ADR-0003), no Kyneta, no Node builtin,
since the client loads it in the browser (`paths.ts` compares paths as
strings for that reason), and no other package, since it declares none.
Biome enforces the builtins: `noNodejsModules` is an error, tests aside, in
every package the page bundles; `tsconfig.pure.json` type-checks it against
only the globals `pure-globals.d.ts` declares. Everything here is a *plan* in
gather, plan, execute: a decision is a value, and the host performs it, as
pi's own lane loop does.

Threads, their entries and messages, the commands a client sends and the
cards placed beside them are `@pinetrie/threads`' (`packages/threads/TECHNICAL.md`),
which declares only core. No lane package (`lanes`, `lanehost`, `docker`,
`jj`, `folder`) declares threads, so what a lane package names is here, and
a kernel module cannot import a threads module: core declares nothing, so
none resolves. That holds by resolution (S285).

Core also holds the few pure helpers several packages share (`paths.ts`,
`errorText`, `firstLine`), since every package that uses one already
depends on core. Where a type lives is below; the other packages' notes
point here rather than restate it.

`index.ts` declares nothing. It is written by `pnpm run indexes`
(`scripts/indexes.ts`, ADR-0201): each name some file imports through it,
from the module that declares it, and nothing else; `scripts/indexes.test.ts`
fails while it differs. `fixtures.ts` is apart, which tests import as
`@pinetrie/core/fixtures`.

- **A module imports the sibling that declares a name, never `./index.ts`**
  (a test may). Loading one module then loads only what it uses, and the
  package has no import cycle at runtime. Types still cross both ways
  (`proposed.ts` and `accepted.ts`): they are erased, so such a cycle costs
  nothing at run time.

- **A module exports only what another file imports.** A name only its
  own module and its tests use is exported for the tests alone; one nothing
  outside its module names is not exported at all. `scripts/indexes.test.ts`
  fails on an export no other file imports, here and in each package
  `INDEXED` lists.

- **`collectionSteps` (`fixtures.ts`) wraps globals:** the iterators of
  `Map.prototype` and `Set.prototype`, while the function it counts runs.
  That function must be synchronous, and its test must not be
  `test.concurrent`. It counts iteration (spread, `for … of`, `forEach`,
  `new Set(iterable)`), not `get`, `has`, `set` or `delete` (S214).

## Where a type lives

A type lives in the highest package that all its users can import
(ADR-0180, ADR-0201):

- **Core** holds a type core's own code names, or a lane package (`lanes`,
  `jj`, `folder`, `lanehost`, `docker`) does: `LaneRecord`, `JjBaseRecord`,
  `FolderBaseRecord` (which `@pinetrie/folder`'s `planFolderRecords`
  builds), `StateRecord`.
- **`@pinetrie/threads`** holds one a package below rules names when each
  such package can declare threads (`protocol`, `schema`): `ThreadRecord`,
  `CardRecord`, `StreamRecord`.
- **`@pinetrie/rules`** holds every other stored shape's type, beside its
  spec, with the types only it uses (`SeatRecord`, `SetupRecord`). What a
  stored shape says, and how the host changes it, is rules', whoever reads
  it.
- **`@pinetrie/session`** holds one client's own in-flight state (its moves,
  held roots, slot repair, commands out). What a person sees and can do,
  and its words, is `@pinetrie/interface`'s, for any client; how the page
  draws it is `@pinetrie/web`'s (ADR-0093).

## Where things are

| module | holds |
|---|---|
| `ids.ts` | the branded ids every package names (a writer's, a thread's, a canvas's, a root's, a workflow state's, an entry's, a run's), positions in the tree, and the documents' ids |
| `refusals.ts` | what the host may refuse a command with (`ERR`), and a refusal as a value (`Refusal`, `refused`) |
| `writes.ts` | where a host record's write goes (`Target`, `Home`) and the write (`ValueWrite`) |
| `thread-names.ts` | a thread's name and its words |
| `config.ts` | config as other packages name it |
| `product.ts`, `lane-env.ts` | the product's name and the host's operator; what every lane of its own sees: paths, home, programs, variables |
| `lanes.ts`, `bases.ts`, `disks.ts`, `snapshots.ts` | a lane's record and its proof it may run; a thread's base, history states and a copy ready to merge; a lane's disk, its snapshots and the operations on it (`DiskOp`); whose rule decides a snapshot's name, and the proof a deletion carries (`Deletable`) |
| `revisions.ts`, `accepted.ts`, `proposed.ts`, `trailers.ts` | a turn's revision record, proposed changes recorded and reviewed; a jj project's accepted work and thread's base, as recorded; proposed changes' facts and decisions; the commit trailers |
| `folder.ts`, `runs.ts`, `output.ts`, `images.ts` | a folder project's history; what a command did to a disk; what a `bash` call wrote, by statement; blobs |
| `paths.ts`, `errors.ts`, `text.ts` | paths as strings, a thrown value as text, and a text as a label |
| `size.ts`, `machine.ts` | a size, read (`parseSize`); the machine's health (`MachineHealth`, `MachineCause`) and what lanehost reads of it (`Pressure`, `CgroupMemory`, `StoreRoom`), which `@pinetrie/machine` plans from, rules stores and interface words |
| `machine-page.ts` | what the host serves the Machine page (`MachinePageFacts`): a reading or why not (`Measured`), each lane, each service (`ServiceReading`), what happened (`MachineLately`, `EventMeasured`), the actions this host can take (`MachineAction`), and the sample's cadence the page asks at (`MACHINE_SAMPLE_MS`) |

## Output apart from runs (`output.ts`)

A `bash` call's output events (`OutputEvent`: a statement signalled, bytes
of a pipe written by a statement, output lost) are a type of their own, never
`RunEvent` kinds, with a line codec of their own. They travel apart at every
layer (the observer's ring, the loader's `out` lines, the role's
`subscribe-output`), so a chatty command cannot crowd a file event out of
the disk events' ring, batches or held notices.

- **The kernel's statement 0 is never a statement.** It marks a writer no
  statement of the run tagged; the decoder reads it as `null`, and a known
  statement is a `StatementIndex`, from 1, which only `statementIndex`
  makes.
- **`STATEMENT_SIGNAL` is spelled three times**: here, in the bash patch
  (`packages/lanes/image/bash/apply.py`) and in the observer's `observe.h`.
  C and Python cannot import it; `packages/lanehost/attribution.test.ts`
  reads both and checks they spell this.
- **A `Settled` proves the observer's flush answered**: only a lane
  observation's `settle` makes one (`packages/lanehost`), so what folds a
  call's end cannot fold it before every output event of the call arrived.

## Paths as strings (`paths.ts`)

- **`isWithin` resolves nothing:** its arguments must be normalized
  already, or a `..` passes as a name.
- **A path that may hold `.`, `..` or a doubled `/` goes through
  `pathUnder`,** which resolves them in both paths before it compares, as
  POSIX does: a `..` at `/` stays at `/`. It reads strings, so a symbolic
  link is not followed. A relative path is null: there is no working
  directory in the browser to resolve it against.

## Sizes (`size.ts`)

- **One parser reads every size** (`parseSize`): a setting's
  (`lanes.store.*`) and a container's memory limit (`LANE_MEMORY`, a
  role's), so a size means one thing in `pinetrie.json` and in Docker. A
  unit is `K`, `M`, `G` or `T`, alone or with `iB`, in any case, binary as
  Docker reads `-m`. A unit with a bare `B` (`GB`, `gb`) is refused:
  people read it as decimal, Docker as binary, and a size that means two
  things is worse than one refused. A bare number is bytes, and only a
  whole one.

## Ids (`ids.ts`)

- A brand turns a swapped argument into a compile error; it cannot keep a
  value off the wire, so no seq is branded (ADR-0013). `EntryId` and `RunId`
  are minted only where they enter: `biome.json` refuses an `entryId` import
  in core, threads, the client and the host, and a `runId` import in core,
  threads and the client (S95).
- A person is their email (ADR-0037), and owns no lane (ADR-0120). A thread's
  id, `t-` and a uuidv7, is minted by the page that opens it before
  anything is written (ADR-0057): by its column, or one per row by a press
  on a proposal (ADR-0157). It names its lane too (ADR-0117,
  ADR-0120): a container and its volume are named after it, so a new one is
  checked strictly (`parseNewThread`). A canvas's id is its card's (ADR-0116,
  ADR-0126); a root's names its document, not its root entry (ADR-0063); a
  workflow state's survives a rename (ADR-0122). Every other card's id is
  threads' (`card-ids.ts`).
- A history of moves is per person and canvas, or the person's outside any
  canvas (ADR-0066, ADR-0116, ADR-0126).
- `agentAsk` is the one way a text is made a message to the agent: a
  proposal's Start and its drafts, and the composer's `@agent `.

## Lanes and their records (`config.ts`, `lanes.ts`, `bases.ts`, `disks.ts`, `revisions.ts`, `thread-names.ts`)

- **A disk operation is one type for both its sides** (`DiskOp`, generic
  over the lane's name): lanes' planners ask it of the runtime over a
  `LaneOwner`, and lanehost carries it out over a string, so neither keeps
  a copy that could differ.
- A host record lives in the session's document or a root's (ADR-0063), and
  its write names which (`Target`, `ValueWrite`, `writes.ts`). Each host
  record is one spec, and pi only carries its writes (ADR-0062).
- A thread's name splits into its two words in one place, `threadNameParts`
  (`thread-names.ts`): a mention's handle, a drawn banner's prompt and a
  built-in icon's noun all read it, and it is null for text that is not an
  adjective and a noun from the lists. Its words are typed `Adjective` and
  `Noun` (the lists are `as const`), so a built-in icon's URL
  (`builtInIconUrl`, interface) can only be built for a noun on the list.
- What config is, as every package that speaks of it names it: its layers
  (`ConfigLayer`), a file's state, a refusal and an origin. Deciding them is
  `@pinetrie/config`'s. Each closed set (`CONFIG_FILE_STATES`,
  `REFUSAL_REASONS`) is a list its type and the setup record's schema are
  both built from. The setup record itself (`SetupRecord`, ADR-0146) is
  rules'.
- Where a lane reads a skill (`laneSkillPath`): a project's in its own
  copy, any other at `/mnt/host` and its host path.
- A turn that changes files is a revision (ADR-0032), on a lane's own disk
  (ADR-0034), whose snapshots `RevisionRecord` names; every thread's agent
  works in a copy of its own (ADR-0102). A conflict is resolved by the agent
  in its lane, with a `land` prompt (ADR-0033).
- A lane's history has one kind, on its record (`LaneRecord.history`,
  ADR-0150): `OwnLane` is a record with one, `ownLane` its one test, and
  `laneFits` the one rule of fit, whose refusal is a value (`ForeignLane`).
  A run starts only on a `RunnableLane`, which only `proveRunnable` makes:
  a lane with no record or no copy runs with no tools, as every lane does
  on a host with no tools; a lane with its own copy must fit the
  project's kind.
- A state any kind of project has is a `PointId`; what only jj has is a
  `CommitId` (ADR-0150). Both are the bare string stored; a commit becomes
  a point freely (`pointFromCommit`), and only `@pinetrie/jj` turns a
  point back, in a lane proven jj. A lane's base is `LaneBaseOf<P>`: the
  ports carry `LaneBase` (points), jj's reads `CommitBase`. A review's
  range is a lane's points; one revision is proposed changes' commit
  (`DiffSpan`). Rules and the ports test points for equality and nothing
  else: an ordering, an ancestry or a diff over `PointId` is an adapter's
  computation. The rule binds the type wherever it is used, and is held by
  review: TypeScript cannot forbid ordering a string brand.
- `DISK_OWN_ROOTS` is the one list of the paths pine·trie, the repos and
  the file system keep on a disk (ADR-0135). A turn's classes and its
  whole-disk diff count none of them but the lane's home
  (`LANE_HOME_PATH`), which tools write as they would any home; the lanes'
  ignore file (`@pinetrie/lanes`' `laneIgnores`) lists each at the disk's
  root, so no repo in a lane tracks one.
- `NO_EDITOR`: a shell with no terminal would wait on an editor until its
  timeout (S36).
- The search tools run programs carried into every lane
  (`RUNTIME_PROGRAMS`, ADR-0064).

## Snapshots and their owners (`snapshots.ts`)

- **A project's `snapshots/` holds the names of four owners**
  (`snapshotOwner`, total, ADR-0210): a bare UUIDv7 is an entry's (a turn's
  or a merge's snapshot, in jj and folder projects alike); any other
  `isFolderStateId` name is a folder state's; `base` is the base's; anything
  else is no one's. The UUID is tested first: `isFolderStateId` accepts any
  disk name with a dash, a UUID's too.
- **A deletion needs its owner's proof.** `delete-snapshots` takes only
  `Deletable` ids, and only `deletableSnapshot` makes one, throwing unless
  the name is the owner's it is made for. `Deletable<"base">` and
  `Deletable<"unknown">` cannot be written. So a rule written for one owner
  cannot delete another's, and no one deletes the base or a name nothing
  decided about. A caller that may meet another owner's name filters with
  `snapshotOwner` first (the archive, `planKeep`), rather than throw.
- **A revision record names only an indexed snapshot** (`IndexedSnapshot`):
  the host's index makes one once the snapshot under its row is taken, and
  the host's write of a record takes nothing else. A stored record still
  decodes as a bare `SnapshotId`: only the write needs the proof.
- **The pattern, for any destructive operation that gains a second
  decider:** the operation takes a branded value, and the one maker of the
  brand checks whose decision it is.
- **Tests name snapshots of the owner they mean:** `@pinetrie/core/fixtures`
  gives fixed entry names (`entrySnapshotId`) and `fast-check` generators of
  each owner's (`SNAPSHOT_NAMES`, `OWNED_SNAPSHOT_NAME`).

## Proposed changes and accepted work (`proposed.ts`, `trailers.ts`)

- A thread's work reaches your repo as proposed changes, one commit or a stack
  (ADR-0105, S48), accepted by a forward bookmark move onto accepted work
  (ADR-0104, ADR-0061), through one owner (ADR-0065). An archived root's
  proposed changes are withdrawn (ADR-0029). The repo is the
  ledger: the host decides from it, never from its record, which a restart
  can lose (S73).
- What the host cannot tell, it does not act on (ADR-0067): proposed changes are
  built only from work known to change a file, from a known start, and an
  accepted thread commit that names no source (S97) leaves its lane
  untraced until it gets the latest past it. Proposed changes whose work accepted
  work already has are `nothing-to-add` (S89).
- A thread gets the latest from its base or the thread it branched from
  (ADR-0072); a publish catches your files up first (ADR-0090, ADR-0099),
  then moves the publish bookmark (ADR-0076). A publish's undo reverts its
  operation (S111); what getting the latest would change is read before (S80).
  Diff stats and review reads are jj's (S57, ADR-0047).
- Every trailer is written and read in `trailers.ts`. jj's `trailers`
  template reads only a message's last paragraph, and a squash keeps two,
  so the readers read every paragraph (S77). A base trailer names accepted
  work by its kind, not its bookmark, which config may rename (ADR-0100).
- A thread has a name you can say, which its proposed changes' bookmark and trailers
  carry, and its proposed changes hold the unfinished work line until an agent describes it
  (ADR-0039).

## A folder project's history (`folder.ts`)

- A folder project keeps its history as a graph of states (ADR-0142):
  `StateRecord` (a snapshot's name, its parents, how it was made) and
  `ConflictRecord` (a path a merge left conflicted, with its three
  states). `@pinetrie/folder` decides over them; lanehost carries out what
  it reads here (`PathFact`, `MergeStep`, `BasePlan`, `LaneStatesOp`),
  which is why they are core's: lanehost declares only core and channel.
- A folder state's id can never be a jj commit's (`isFolderStateId`): it
  holds a dash and is a disk name (`isDiskName`, the one rule for both),
  and a commit is 40 hex digits. Core mints none: `lineStateId` takes the
  uuidv7 its caller minted.
