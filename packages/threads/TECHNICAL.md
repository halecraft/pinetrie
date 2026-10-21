# `@pinetrie/threads`: technical notes

Threads, their entries and messages, asks and mentions, every command a
client sends, and the cards placed beside them, as every package above the
kernel names them (ADR-0201). It declares only `@pinetrie/core`
(`workspace.test.ts`), whose ids, refusals and writes it builds on, and no
lane package (`lanes`, `lanehost`, `docker`, `jj`, `folder`) declares it, so
none can name a card, a move or a command: that holds by resolution (S285).
Like core it does no I/O and imports no pi (ADR-0003), no Kyneta and no Node
builtin, since the client loads it in the browser; `tsconfig.pure.json`
type-checks it against only the globals `pure-globals.d.ts` declares.
Everything here is a *plan* in gather, plan, execute.

Where a type lives is the rule `packages/core/TECHNICAL.md` states ("Where a
type lives", ADR-0180). Here that is a type a package below rules names when
it can declare threads (`protocol`, `schema`): `ThreadRecord`, `CardRecord`,
`StreamRecord`.

`index.ts` declares nothing. It is written by `pnpm run indexes`
(`scripts/indexes.ts`): each name some file imports through it, from the
module that declares it, and nothing else. `fixtures.ts` is apart, which
tests import as `@pinetrie/threads/fixtures`.

- **A module imports the sibling that declares a name, never `./index.ts`**
  (a test may), and a kernel name from `@pinetrie/core`. Types still cross
  both ways (`card-ids.ts` and `kinds.ts`): they are erased, so such a cycle
  costs nothing at run time. `card-ids.ts` reads `KINDS`' value, and
  `kinds.ts` imports only types from it, so the two never load in a cycle.

## Where things are

| module | holds |
|---|---|
| `card-ids.ts`, `kinds.ts` | each kind of card's id (but a thread's and a canvas's, which are core's), and a card's kind from its id; every kind of card |
| `cards.ts`, `places.ts`, `paste.ts`, `grid.ts` | what a card is, where cards are and the moves between places, a paste, your inventory's grid |
| `messages.ts` | an entry and its message as the reads decode them, one variant per role (`Role`), and what each role carries |
| `tree.ts`, `asks.ts`, `agents.ts`, `roots.ts`, `address.ts`, `ordering.ts` | the reads of the tree, asks, other threads' agents, each root summarized, an address's codec, entries' arrival order |
| `threads.ts`, `proposals.ts` | a thread's record and how it began; the proposal a branch was opened from |
| `intents.ts` | every command (`Intent`), and a send's place in the tree |
| `board.ts`, `marks.ts` | an edit to the board's workflow states, and a canvas in the archive; what a typed title asks for |
| `facts.ts` | the host's facts in a thread |
| `mentions.ts` | who a message names and compels (`address`), what a relay between agents carries, a person's display name |
| `access.ts` | the owner's answers to a lane's use of their ssh identity |
| `work.ts` | where a lane works: its revisions and disk above an entry |
| `live.ts`, `edits.ts`, `tools.ts` | what a turn streams; a text's edits; the tools |

## Card ids (`card-ids.ts`, `kinds.ts`)

- A file card's id is reserved (ADR-0118); a fact's, a reference's
  (ADR-0126), an ask's (ADR-0128), a media column's and an image's
  (ADR-0182) are minted where the card is made. A text card's is a bare
  uuidv7. A thread's and a canvas's ids are core's, since they name a thread
  and a canvas wherever else they are used; `parseCardId` takes them as
  core's checks do.
- `KINDS` holds one row per kind of card: its id's prefix, the places it is
  ever in (ADR-0116, ADR-0117, ADR-0126, ADR-0128, ADR-0182), whether it is
  reordered there, where its words are read, and who may title it
  (`titled`, `TitledKind`: a thread and a note column a person alone,
  ADR-0207; a media column and an image a person or the agent).
  `titledKindOfCard` reads a titled card's kind from its id.

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
- A canvas's card holds one flag, whether its workflow state has changed
  since it was made (`CanvasContent.stateChanged`, ADR-0206): made false
  (`STATE_UNCHANGED`), set by any move between states. While it is false,
  an agent's first run in the canvas moves it from Topics to Active.
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
- A message's role decides its fields (ADR-0185): `AgentMessageLike` and
  `TranscriptMessage` are unions keyed by `role`, and `MessagePart` one keyed
  by `type`, decoded once at the edge (`@pinetrie/rules`' `renderableMessage`)
  from the loose row pi and the host store. A read names the role it means
  (`m?.role === "person" ? m.writer : undefined`, or `messageWriter`,
  `messageProposal`, `messageMerged`, `transcriptCalls`). How each role
  reads (a one-line host message, a run's prompt) is one table keyed by every
  `Role` (`tree.ts`), so a new role does not compile until it is placed. An
  entry whose message no role takes has none.
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
  (ADR-0021). Other threads' agents are invited, then asked, and what
  came into an asked agent is read from the path (ADR-0128).
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
- An address names a thread, an entry, a block, a range or a card, and an
  entry's names its thread (ADR-0125, ADR-0126).
- A tool keeps its id for the model; threads reads what a call touched, and
  `@pinetrie/interface` words it (ADR-0114). A tool's result is its own entry
  but belongs to its call, never a message. A tool's image is a blob
  (ADR-0051), as a pasted one is, which a message holds by reference
  (ADR-0042); a reference card's quote is a blob too (ADR-0126). A blob is
  an image, text or opaque (`BlobKind`, from its stored tag, `kindOfMime`,
  core's), and a message's shares (`Share`) name each one's original and the
  image copy it shows (ADR-0151). `ImageRef` is stored in sends as it is, so
  a blob's size is the store's `size`, never a field of the ref.
- `TOOL_IDS` is every lane's tool list, the same in every run, `set_banner`
  included under any icon source (ADR-0143), `propose_branches` last
  (ADR-0157); its order is part of every
  request's prefix, and a changed prefix drops a lane's earlier thinking
  (S85).

## Commands (`intents.ts`, `board.ts`, `marks.ts`)

- A `Send` is a person's message the host sends: a `send` intent's, or a popped
  queued card's (`SendAt`'s `queue`). `Gated`, an intent or a send, is
  what the host's gate decides on (`planGate`, `@pinetrie/rules`); it is
  here so that `runsIn` and `writesIn` take it without importing the
  gate, which imports them. What the host may refuse a command with, and
  where its writes go, are core's (`refusals.ts`, `writes.ts`), since
  packages that send no command name them too.
- An edit to the board's workflow states and a canvas in the archive
  (ADR-0122, ADR-0029); a canvas's typed title (ADR-0045, ADR-0116). A
  `WorkflowEdit` has one shape per action, so an edit carries only what
  its action reads; the wire stays flat, and `@pinetrie/protocol` maps
  between the two. A state's marks (`WorkflowMark`, ADR-0206) are here,
  since the wire carries them. The
  records of the workflow, a title and one a model gives (ADR-0074), a
  person's picture (ADR-0098), a column's banner (ADR-0050), the host's
  icon source (ADR-0143) and the commands a pi skill or prompt makes
  (ADR-0036) are typed in rules, beside their specs (ADR-0180).

## Where a lane works (`work.ts`)

- A lane's work, its state and its disk are read from the nearest revision
  records above an entry (ADR-0032, ADR-0034), with the lanes that recorded
  each (`Above.pointLane`, `snapshotLane`: whose disk a fork clones).

## Streams (`live.ts`, `edits.ts`)

- A running turn streams through the durable document (ADR-0014), in
  pine·trie's own words: no pi type crosses (ADR-0003). A stream's key is a
  fresh uuidv7, unique wherever it is made (ADR-0016). An ask's digest is
  replaced whole, so it is a value, not a text.
- A stream is written as edits to a text, not whole values: a live tool
  stream appended 4.35 MB as values and 96 KB as edits (S22).
- A run's earlier thinking is dropped when its lane's tools or prompt
  change (S85).
