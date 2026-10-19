# `@pinetrie/core`: technical notes

Core is the vocabulary every package shares (ids, intents) and the reads
of the tree. It does no I/O, and imports nothing but its
own modules: no pi (ADR-0003), no Kyneta, no Node builtin, since the client
loads it in the browser (`paths.ts` compares paths as strings for that
reason). Biome enforces the last: `noNodejsModules` is an error, tests
aside, in every package the page bundles. Everything here is a *plan* in gather, plan, execute: a decision is
a value, and the host performs it, as pi's own lane loop does.

The rule core, `@pinetrie/rules` and `@pinetrie/jj` keep: a type lives in
the highest package that all its users can import (ADR-0180). A stored
shape's type is rules', beside its spec; it is core's only when core's own
code names it, or a package below rules does: one that declares core and
not rules (`lanes`, `jj`, `folder`, `schema`, `protocol`, `config`,
`docker`, `lanehost`). So `LaneRecord`, `JjBaseRecord` and `StateRecord`
are here, and `SeatRecord` and `SetupRecord` are rules'. What a stored
shape says, and how the host changes it, is `@pinetrie/rules`', whoever
reads it. Core also holds the few
pure helpers several packages share (`paths.ts`, `errorText`), since every
package that uses one already depends on core. `index.ts` declares nothing:
it re-exports every module but `fixtures.ts`, which tests import as
`@pinetrie/core/fixtures`.

- **A module imports the sibling that declares a name, never `./index.ts`**
  (a test may). Loading one module then loads only what it uses, and the
  package has no import cycle at runtime. Types still cross both ways
  (`ids.ts` and `kinds.ts`, `proposed.ts` and `accepted.ts`): they are
  erased, so such a cycle costs nothing at run time.

- **`collectionSteps` (`fixtures.ts`) wraps globals:** the iterators of
  `Map.prototype` and `Set.prototype`, while the function it counts runs.
  That function must be synchronous, and its test must not be
  `test.concurrent`. It counts iteration (spread, `for … of`, `forEach`,
  `new Set(iterable)`), not `get`, `has`, `set` or `delete` (S214).

## Where things are

| module | holds |
|---|---|
| `ids.ts`, `kinds.ts` | every branded id and position; every kind of card |
| `cards.ts`, `places.ts`, `paste.ts`, `grid.ts` | what a card is, where cards are and the moves between places, a paste, your inventory's grid |
| `tree.ts`, `asks.ts`, `agents.ts`, `roots.ts`, `address.ts`, `ordering.ts` | the reads of the tree, asks, other threads' agents, each root summarized, an address's codec, entries' arrival order |
| `threads.ts` | a thread's record and how it began, and the proposal a branch was opened from |
| `intents.ts` | every command (`Intent`), its refusals (`ERR`), where its writes go (`Target`, `ValueWrite`), a send's place in the tree |
| `board.ts`, `marks.ts` | an edit to the board's workflow states, and a canvas in the archive; what a typed title asks for |
| `facts.ts` | the host's facts in a thread |
| `mentions.ts` | who a message names and compels (`address`), what a relay between agents carries, a person's display name |
| `thread-names.ts` | a thread's name and its words |
| `config.ts`, `access.ts` | config as other packages name it; the owner's answers to a lane's use of their ssh identity |
| `product.ts`, `lane-env.ts` | the product's name and the host's operator; what every lane of its own sees: paths, home, programs, variables |
| `lanes.ts`, `bases.ts`, `disks.ts` | a lane's record and its proof it may run; a thread's base, history states and a copy ready to merge; a lane's disk and snapshots |
| `revisions.ts`, `accepted.ts`, `proposed.ts`, `trailers.ts`, `work.ts` | a turn's revision record, proposed changes recorded and reviewed; a jj project's accepted work and thread's base, as recorded, and the read that got the latest; proposed changes' facts and decisions, the commit trailers, where a lane works |
| `folder.ts`, `runs.ts`, `live.ts`, `edits.ts`, `images.ts`, `tools.ts` | a folder project's history; what a command did to a disk; what a turn streams; a text's edits; blobs; the tools |
| `paths.ts`, `errors.ts` | paths as strings, and a thrown value as text |

## Paths as strings (`paths.ts`)

- **`isWithin` resolves nothing:** its arguments must be normalized
  already, or a `..` passes as a name.
- **A path that may hold `.`, `..` or a doubled `/` goes through
  `pathUnder`,** which resolves them in both paths before it compares, as
  POSIX does: a `..` at `/` stays at `/`. It reads strings, so a symbolic
  link is not followed. A relative path is null: there is no working
  directory in the browser to resolve it against.

## Ids (`ids.ts`, `kinds.ts`)

- A brand turns a swapped argument into a compile error; it cannot keep a
  value off the wire, so no seq is branded (ADR-0013). `EntryId` and `RunId`
  are minted only where they enter: `biome.json` refuses an `entryId` import
  in core, the client and the host, and a `runId` import in core and the
  client (S95).
- A person is their email (ADR-0037), and owns no lane (ADR-0120). A thread's
  id, `t-` and a uuidv7, is minted by the page that opens it before
  anything is written (ADR-0057): by its column, or one per row by a press
  on a proposal (ADR-0157). It names its lane too (ADR-0117,
  ADR-0120): a container and its volume are named after it, so a new one is
  checked strictly (`parseNewThread`). A canvas's id is its card's (ADR-0116,
  ADR-0126); a root's names its document, not its root entry (ADR-0063); a
  workflow state's survives a rename (ADR-0122). A file card's is reserved
  (ADR-0118); a fact's, a reference's (ADR-0126), an ask's (ADR-0128), a
  media column's and an image's (ADR-0182) are minted where the card is
  made.
- A history of moves is per person and canvas, or the person's outside any
  canvas (ADR-0066, ADR-0116, ADR-0126).
- `KINDS` holds one row per kind of card: its id's prefix, the places it is
  ever in (ADR-0116, ADR-0117, ADR-0126, ADR-0128, ADR-0182), whether it is
  reordered there, where its words are read, and who may title it
  (`titled`, `TitledKind`: a note column a person alone; a media column and
  an image a person or the agent).

## Cards and places (`cards.ts`, `places.ts`, `paste.ts`, `grid.ts`)

- A card is an identity, one place and content (ADR-0126); its record is in
  the places document, which only the host writes, and a move between
  owners is a handoff (ADR-0059). Everything unsent is a card, and stays
  where it was put (ADR-0048): a move someone else makes leaves a trace for
  its placer, and a reorder is a compare-and-set on its neighbours.
- An order key ranks a card among its neighbours, the host's to give
  (S69). A queued card carries its text's version as its queuer had it,
  since its text can reach the host after its record (S96).
- A text card's command is named last and carried out when the card pops
  (ADR-0108); every command on a thread leaves a fact in it (ADR-0080). A
  text card spun into a thread starts a root (ADR-0111); a note is a text
  card in a note column (ADR-0113, ADR-0116).
- A paste makes a card from a copy, or moves a cut one out of its cutter's
  trash (ADR-0132), after trashing the card on the slot it fills
  (ADR-0133).
- Your inventory is one grid, its cells addressed in reading order
  (ADR-0048).
- A margin names what it is on by address (`MarginOn`: an entry's, or an
  image's card), printed in its row, and the version of the image a comment
  was written on (`seen`), which no key compares (ADR-0182). Its owner is the
  entry's thread, or the image (`surfaceOwner`).
- An image's versions carry each fitted copy as an `ImageRef` and its
  `original`; `cardBlobs` is every blob a card holds, a reference's quote
  and each version's two, which the sweep keeps (ADR-0182).

## The tree (`tree.ts`, `asks.ts`, `agents.ts`, `roots.ts`, `address.ts`, `ordering.ts`)

- Order is structural: the `parentId` walk, and ids, which are uuidv7 and so
  sort by creation (S9). Nothing reads seq, which is local to a replica
  (ADR-0013); `orderNewEntries` derives it, and `ordering.test.ts` tests that
  every replica derives the same.
- Every entry names its thread (ADR-0125), so a thread's first entry and end
  are read from its rows, and a fork's source is not stored. A thread is a
  card, and a copy is a branch at its end (ADR-0117); one taken into an
  inventory stops (ADR-0124).
- A lane is never written while it runs (S21), so a run's entries are its
  prompt's descendants up to the next prompt, with only the host's news
  steered in (ADR-0080). An ask is a message and the run it started
  (ADR-0106); how a run ended is read from its last entries (S70), and who
  stopped it from its stop's fact (ADR-0126). Only a long ask gets a digest
  (ADR-0075). Resume starts a new turn (ADR-0082).
- A thread's mode is its lane, and a mention picks who a message is for
  (ADR-0021). Other threads' agents are invited, then asked, and what an
  asked agent has heard is read from the path (ADR-0128).
- A root is a document (ADR-0063), rooted at its first message (S30). Its
  summary, written to the directory, carries its followers (ADR-0077) and
  its mentions, for your inbox (ADR-0030).
- An agent's proposal of branches (ADR-0157, `proposals.ts`) is a
  `propose_branches` result's `proposal`; a branch opened from it names it
  and its row in its origin (`ThreadFork.proposal`, which a copy cannot
  carry), and those records alone make it spent (`branchesByProposal`,
  `proposalState`). It forks at its run's last entry (`AskIndex.last`),
  and is running only while its own run is the lane's (`runningAsk`, the
  prompt of the run the lane runs), never while a later one is.
- `agentAsk` (`ids.ts`) is the one way a text is made a message to the
  agent: a proposal's Start and its drafts, and the composer's `@agent `.
- An address names a thread, an entry, a block, a range or a card, and an
  entry's names its thread (ADR-0125, ADR-0126).
- A tool keeps its id for the model; core reads what a call touched, and
  `@pinetrie/interface` words it (ADR-0114). A tool's result is its own entry
  but belongs to its call, never a message. A tool's image is a blob
  (ADR-0051), as a pasted one is, which a message holds by reference
  (ADR-0042); a reference card's quote is a blob too (ADR-0126). A blob is
  an image, text or opaque (`BlobKind`, from its stored tag, `kindOfMime`),
  and a message's shares (`Share`) name each one's original and the image
  copy it shows (ADR-0151). `ImageRef` is stored in sends as it is, so a
  blob's size is the store's `size`, never a field of the ref.
- `TOOL_IDS` is every lane's tool list, the same in every run, `set_banner`
  included under any icon source (ADR-0143), `propose_branches` last
  (ADR-0157); its order is part of every
  request's prefix, and a changed prefix drops a lane's earlier thinking
  (S85). The search tools run programs
  carried into every lane (`RUNTIME_PROGRAMS`, ADR-0064).

## Records, commands and lanes (`intents.ts`, `board.ts`, `marks.ts`, `config.ts`, `lanes.ts`, `bases.ts`, `disks.ts`, `revisions.ts`)

- A `Send` is a person's message the host sends: a `send` intent's, or a popped
  queued card's (`SendAt`'s `queue`). `Gated`, an intent or a send, is
  what the host's gate decides on (`planGate`, `@pinetrie/rules`); it is
  core's so that `runsIn` and `writesIn` take it without importing the
  gate, which imports them.
- Each host record is one spec, and pi only carries its writes (ADR-0062);
  a record lives in the session's document or a root's (ADR-0063).
- An edit to the board's workflow states and a canvas in the archive
  (ADR-0122, ADR-0029); a canvas's typed title (ADR-0045, ADR-0116). The
  records of the workflow, a title and one a model gives (ADR-0074), a
  person's picture (ADR-0098), a column's banner (ADR-0050), the host's
  icon source (ADR-0143) and the commands a pi skill or prompt makes
  (ADR-0036) are typed in rules, beside their specs (ADR-0180).
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

## Proposed changes and accepted work (`proposed.ts`, `trailers.ts`, `work.ts`)

- A thread's work reaches your repo as proposed changes, one commit or a stack
  (ADR-0105, S48), accepted by a forward bookmark move onto accepted work
  (ADR-0104, ADR-0061), through one owner (ADR-0065). An archived root's
  proposed changes are withdrawn (ADR-0029). The repo is the
  ledger: the host decides from it, never from its record, which a restart
  can lose (S73).
- What the host cannot tell, it does not act on (ADR-0067): proposed changes are
  built only from work known to change a file, from a known start, and an
  accepted thread commit that names no source (S97) leaves its lane
  untraced until it gets the latest past it. Proposed changes already held are `held`
  (S89).
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
  carry, and its proposed changes hold the WIP line until an agent describes it
  (ADR-0039).
- A lane's work, its state and its disk are read from the nearest revision
  records above an entry (ADR-0032, ADR-0034), with the lanes that recorded
  each (`Above.pointLane`, `snapshotLane`: whose disk a fork clones).

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

## Streams (`live.ts`, `edits.ts`)

- A running turn streams through the durable document (ADR-0014), in
  pine·trie's own words: no pi type crosses (ADR-0003). A stream's key is a
  fresh uuidv7, unique wherever it is made (ADR-0016). An ask's digest is
  replaced whole, so it is a value, not a text.
- A stream is written as edits to a text, not whole values: a live tool
  stream appended 4.35 MB as values and 96 KB as edits (S22).
- A run's earlier thinking is dropped when its lane's tools or prompt
  change (S85).
