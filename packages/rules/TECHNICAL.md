# `@pinetrie/rules` — technical notes

Each shape pine·trie stores, and every pure rule about it: the host's
decisions, the prompts built from it, and what the page reads of it, one
topic per module. A shape is a host record (`records.ts`, ADR-0095), a pi
custom message (chat, land, update, stack, pinned cards), or a card's record
in the places document. pine·trie types each one here, and is its single
authority. Nothing here does I/O or reads the clock: the host gathers, these
modules decide, and the host writes.

The package was `@pinetrie/marginalia` (`packages/marginalia/`) until it was
renamed; the ADRs and findings use that name.

Where a rule lives, as `@pinetrie/core` and `@pinetrie/repo` state it too:

> Core holds the vocabulary (ids, intents, every record's type) and the
> reads of the tree. A format or type that `lanes` or `repo` must read,
> write or name lives in core too, since neither can declare
> `@pinetrie/rules`. What a stored shape says, and how the host changes it,
> is `@pinetrie/rules`', whoever reads it. One client's own in-flight state
> (its moves, held roots, slot repair, commands out) is
> `@pinetrie/session`'s. What a person sees and can do, and its words, is
> `@pinetrie/interface`'s, for any client; how the page draws it is
> `@pinetrie/web`'s (ADR-0093).

So `planStop` is here beside `STOP`, and `agentByDefault` beside
`addressChat`; `address`, `parseMentions` and `moveOf`, which know no
record, are core's; the trailer format and the offer's facts and decisions
are core's (`trailers.ts`, `offers.ts`), since `@pinetrie/repo` reads them.

## Where things are

`index.ts` exports, by name, only what another package imports; its groups
follow this list. A name only this package uses is imported from its module.

- `records.ts`, `specs.ts`, `decode.ts`: `RecordSpec`, the writes it builds
  and every spec (`RECORD_SPECS`); the
  total decoders and key readers every module uses.
- `config.ts`: reading the user config. `request.ts`: what fits a model
  request's budget.
- `chat.ts`, `participant.ts`, `images.ts`, `commands.ts`: a person's
  message, who is in the session, the images a message shows, and `/`
  commands (`pinetrie.commands`).
- `history.ts`: the history message builder (`historyMessage`), whose spec
  each kind of host message in a thread is (below).
- `land.ts`, `update.ts`, `stack.ts`, `pinned.ts`: the resolution's prompt,
  the update and stack messages, the pinned cards a run reads.
- `fact.ts`, `behind.ts`, `agent-commands.ts`: what a command on an offer
  did, as a fact in the thread; the base's new work, told or caught up; the
  agent's `catch_up` and `split_offer` (ADR-0080).
- `live.ts`: what each stream event, and a run's end and a host's start, do
  to `pinetrie:live`, as `LiveOp`s `@pinetrie/schema`'s `applyLiveOps` writes
  (`packages/schema/TECHNICAL.md`, Streams).
- `card.ts`, `notes.ts`, `queue.ts`, `moves.ts`, `in-place.ts`,
  `move-history.ts`: a card's record, where it is and the sweep; note
  columns and where a card leaving a thread goes; the queue's pops and
  carries; handoffs and their targets; reorders, a card's width and its
  command; each sender's history of moves and its undo.
- `rank.ts`: a rank on a canvas, a drop's, and where a branch lands.
- `held.ts`, `copy.ts`: a thread in an inventory (the gate, who holds it,
  what a change takes) and a thread copied (ADR-0117, ADR-0124).
- `queue-hold.ts`, `seat.ts`, `startup.ts`: a held queue, who wrote in a
  text, what a starting host resumes.
- `board.ts`, `archive.ts`, `order.ts`: the board's workflow states and
  each root's place, what crossing the archive's edge does, and order
  keys (a queue's, the pinned cards' and the board's).
- `roots.ts`, `mark.ts`, `title.ts`, `stop.ts`, `digest.ts`, `verdict.ts`:
  the directory of roots, titles, who stopped a run and carrying on after
  it, an ask's digest, and how a thread's last run ended.
- `names.ts`, `banner.ts`: a thread's name and its banner, each with its
  record.
- `work.ts`: where lanes work (`pinetrie.lane`, `pinetrie.revision`,
  `pinetrie.project`).
- `accepted.ts`: accepted work (`pinetrie.accepted`): its record, setup and
  publishing.
- `base.ts`: a thread's base (`pinetrie.base`): where a lane begins, what
  catching up would do and merge, and the thread a lane branched from.
- `catch-up-from.ts`: what a catch-up merges (`CatchUpFrom`), as history
  stores it and as every wording names it.
- `offer.ts`, `offer-view.ts`, `review.ts`: an offer's record and the
  host's decisions about it, the page's view of it, and the review's wire.

Every module decodes through `decodeWith` (`decode.ts`), which is
total: a malformed value is dropped, never thrown. `recordsOf` and
`recordsIn` do it for a namespace's stored records (`records.ts`, below).

A decoder brands the ids it reads, and its `build` may refuse a value too.
**Every lane is checked with `isThreadId`**: on a record's address for a
record keyed by lane (`threadKey`), and in `build` for a lane in its
contents (as `BANNER` checks `isSha256`). A value whose lane fails is
dropped. That is what keeps a malformed lane out of the host's writes:
`agent.lane` finds any lane pi holds (S95). A card is the exception
(`card.ts`, below).

Namespaces are stored data and name the owner, `pinetrie.`, following pi's own
`pi.` convention. They deliberately do not follow the package name: renaming a
package must never require changing stored data.

# Records (`records.ts`, ADR-0062)

**Each spec names its home** (ADR-0063), `RecordSpec<R, K, H>` with `H`
`"session"` or `"root"`: a record read across roots lives in the session's
document, one keyed by a root's entries in that root's. `setRecord`,
`deleteRecord` and `setIfChanged` take the root exactly when the home is
`"root"` (overloads), and put the `Target` in the `ValueWrite`, so a write
cannot reach the wrong document and needs no guard at run time.
`records.test.ts` lists every spec's home.

- **`ROOT`** (`roots.ts`): a root's directory record, keyed by its `RootId`:
  its root entry, first line, title, counts, writers, each thread's writers
  on its path (`threads`, its followers, ADR-0077), the chats that name
  someone, and its images. The host writes it from `readRootRecord`.
  Each mention names its thread (`threadAt`), so the inbox reads its task.
  `ROOT` is `derived`: built from the root's document alone, so a record
  that does not decode in this build's shape is rebuilt at a host's start
  (`host/directory.ts`, `planRebuild`), never migrated.
- **`VERDICT`** (`verdict.ts`, ADR-0077): a thread's last run's verdict,
  keyed by lane, in the session: the run's prompt and last entry, and what
  happened (pending, said, failed, stopped, unclassified), never a level,
  which each client decides for its person.
- **`LANE`** is written for every lane as it is created, naming its root;
  `work` is null for a lane with no work of its own.
- **`WORKFLOW` and `BOARD`** (`board.ts`, ADR-0122): the session's workflow
  states, a singleton, and each task's place on the board, keyed by its
  `TaskId` (ADR-0116).
- **`TASK`** (`task.ts`, ADR-0116): a task's record, in the session: who
  opened it and when, nothing more. What it holds is the places
  document's.
- **`QUEUE_HOLD`** (`queue-hold.ts`, ADR-0048 step 7): a thread's queue
  held, keyed by lane, in the session: who held it and when.
- **The archive gate** reads the tasks a command writes in (`writesIn`) and
  looks each up among the archived (`archivedIn`, over `archivedOf`): a
  command carries its tasks, or its places and cards, which the
  `TaskIndex` maps to tasks, so no root's document is opened to check.

Each host record is one `RecordSpec<R, K>`: its `namespace`, `keyOf`,
`encode` and `decode`, exported beside its type (`MARK` in `mark.ts`,
`OFFER` in `offer.ts`). Everything else goes through the spec:
`setRecord` and `deleteRecord` build the `ValueWrite`s the host writes
(`Records.writeValues`, ADR-0095), grouped by document with `byTarget`;
`recordsIn` decodes a namespace as stored, which `readRecords` in
`@pinetrie/reads` reads from the document; `setIfChanged` writes only a
record that changed. `RECORD_SPECS` (`specs.ts`) lists every spec, its
address and decoder, for a check over every record, as a migration's
(ADR-0096); a test fails when a spec is left out of it.

- **The address holds the key; the contents never repeat it.** `encode`
  leaves the key field out (`entry`, `root`, `lane`, `id`, `prompt`,
  `peer`, `writer`), and `decode(contents, key)` reads the address with a
  key reader (`entryKey`, `threadKey`, `textKey`, `writerKey`, or `fixedKey`
  for a singleton, in `decode.ts`) and sets the field from it: `decodeAt`
  drops the record when the reader finds no key. So a write and a read cannot disagree on a key, and
  `DigestRecord` and `SeatRecord` carry their key in memory
  though their contents never held it.
- **A value written before ADR-0062 still decodes.** Ten records kept their
  key in their contents too. typebox's `Value.Check` accepts the extra
  property, and `decode` sets the key after the contents, so the address
  wins over the old copy. A record `setIfChanged` finds unchanged is never
  rewritten, so such a copy can stay; nothing reads it.
- **`setIfChanged` ignores key order.** It compares `encode` of both sides
  with every object's keys sorted: a decoder may build fields in another
  order than the planner that made the new record (`OFFER` rebuilds field
  by field), and comparing `JSON.stringify` strings would then rewrite an
  unchanged record on every check. The host writes only a changed record: a
  write compacted with no client connected moves the document's base past
  what a new client reports.
- **The singletons** (`ACCEPTED`, `PROJECT`, `COMMANDS`, `WORKFLOW`) have one
  fixed key (`ACCEPTED_KEY`, `PROJECT_KEY`, `COMMANDS_KEY`, `WORKFLOW_KEY`), and
  `decode` refuses any other.

# Chat (`chat.ts`)

A human message is a pi `CustomMessage`, `customType: "pinetrie.chat"` (ADR-0018).
`content` is the attributed text the model reads ("Alice: …"); `details` hold
the author (a `WriterId`, from the transport), the display name as written, the
text, and the `Responder` it compels. `encodeChat` and the total `decodeChat`
are the only code that builds or reads the shape.

- **A mention in code is no mention** (`parseMentions`, `withoutCode`,
  core, ADR-0128): inline code spans and fenced blocks are blanked first.
  A four-space indented block is not: a line scan cannot tell it from a
  paragraph's continuation.
- **Who a message is for is `address`** (`@pinetrie/core`, ADR-0021): `@agent`
  asks the agent; a message naming only participants is for them; with no
  mention that resolves, the thread decides (`agentByDefault`: the agent where
  the thread has a lane or the column is a Start Agent column, and never by a
  lane's default for a `branch`, which is a new thread). A handle resolves
  against `participants`: every named writer and every writer in the tree,
  the unnamed by their email's part before the `@` (ADR-0037), through
  `handleOf`: letters and digits in
  any script, `_` and `-`, lower-cased and composed (NFC), so "José" typed
  either way is `@josé`. An unknown handle (`@types/node`) is ignored, so it
  never silences the agent; `normalizeName` refuses a name with no handle, or
  the handle `agent`.
- **`addressChat` is the one rule for who a chat is for:** `address` with
  `agentByDefault`, and a command for the agent whoever else it names
  (ADR-0036), keeping the people it names. `planChat` runs it on the host, and
  the composer's `planSend` (`packages/interface/send.ts`) runs it before a send,
  so the button's promise and the host's decision cannot drift apart.
- **`planChat` decides what a message does** (ADR-0120), over the thread
  `threadOfSend` (core) gives for where it goes (`SendAt`), and names
  exactly where to write:

  | a message… | no lane | idle lane | busy lane (running, cards queued, or its queue held: `sendWaits`) |
  |---|---|---|---|
  | plain | `appendToTree` at the end | `appendToLane` | `busy` |
  | compelled `reply`, not raced | `createAndRun` at the end | `run` | `conflict` |
  | compelled `reply`, raced | `conflict` | `conflict` | `conflict` |
  | `queue` (the host's pop) | as `reply` | as `reply` | as `reply` when only cards are queued; `busy` while it runs |

  `busy` writes nothing: the dispatcher queues the chat's card in the same step, and answers `queued` (ADR-0059).
  `queue` is the host's own mode (`PlanMode`; a client sends a `ChatMode`), for a card it pops, which heads the queue
  it is in: so only a run makes the lane busy, and a race does not count.
  | `branch` | plain: `appendToTree` at its fork; compelled: `createAndRun` at its fork | the same: a branch never continues a lane | the same |

  A race is another writer's compelled message on the thread's path since what
  the sender saw; plain remarks, agent replies and sibling forks are not. A
  `branch` at a lane's tip is stepping down: a new thread there, the lane left
  where it is.
- **A lane is named by its thread's id** (ADR-0117): `createAndRun` takes
  the thread the send continues, or the one a branch starts. No other name is
  chosen; pi makes none. A branch naming a thread that has an entry or a
  lane is `taken` (core), refused before planning.
- **Every entry names its thread** (ADR-0125), in its row's `thread`
  column, from the commit that writes it. Every `ChatDecision` that writes
  names its thread once, as `thread`: the one the send continues, or the
  one a branch starts. A chat stores no `starts`. The host writes the
  thread's record (`THREAD`, `thread.ts`: its root, who started it, when,
  and a copy's fork) just before a branch's first message, then names it.
- **Each chat stores its send's id** (`sendId`, the command's id), so the
  column that sent it finds it exactly (`TreeIndex.bySend`).
  `detailsFromStored` is the one conversion of stored details.
- **`renderableMessage`** turns a stored chat into role `chat` with its author
  and whether it compelled the agent, for `core`'s projections, which only
  admit the role and so need no schema library.
- **A chat's images are references** (ADR-0042). `details.images` lists an
  `ImageRef` (hash, type, size) for each `/blob/` image its text shows, in
  order: the host fills it when the message is sent. `content` stays the attributed text, so no image's bytes are stored.
  `withChatImages` is what the model reads: each chat with images gets
  `[text, ...image parts]`, from base64 the caller gathered
  (`chatImageShas` says which), with a missing blob named as text.
  `packages/pi` runs it in pi's `toProviderMessages`. It takes base64, not
  bytes, because this package ships to the browser.
- **Names are labels, never identities** (`participant.ts`). The name is copied
  into each message, so a rename never rewrites what the agent already read,
  nor invalidates the provider's prompt cache.

# Images (`images.ts`, ADR-0042)

- **`imageSources` is which images a text shows**: `image` nodes, and
  `imageReference` nodes resolved through the text's definitions (the first
  definition of an identifier wins), in order, each once. It parses with
  `mdast-util-from-markdown` and the GFM extensions, the packages under the
  client's remark-parse and remark-gfm at the same versions
  (`workspace.test.ts`), so the host and the drawing read one tree. An image
  in code is text; a link to an image is a link.
- **`pastedImages`** keeps the sources `blobOfUrl` accepts: exactly
  `/blob/<64 lower-case hex>`.
- **`planImages`** turns those hashes and the store's refs into the message's
  images, or refuses it with `ERR.IMAGE_MISSING`. The host gathers the refs
  first; the decision is pure.

# Commands (`commands.ts`, ADR-0036)

- **The syntax is pi's, qualified by package:** `/<package>:<name>` for a
  prompt template, `/<package>:skill:<name>` for a skill. `parseCommand`
  reads the first word: two `:`-separated parts is a prompt, three with
  `skill` in the middle a skill; anything else is text, `/etc/hosts`
  included.
- **`labelCommands`** gives each package its label: the user config's rename
  (keyed by pi's `source`), else `pinetrie`, else `plugin.json`'s name, else
  the unscoped package name, else pi's scope. Two sources with one label are
  refused together, as are two commands with one full name in one package.
- **`expandSkill`** is pi's block, byte for byte. **`resolveCommand`** is an
  exact match.
- **A command message** keeps `details.text` as typed and `details.command`
  (`CommandRef`: name, kind, file, hash, expansion). `attributed` reads the
  expansion, so the model reads what the command meant when it was sent. `planChat` makes a command compel
  the agent, and refuses an unknown one (`ERR.UNKNOWN_COMMAND`).
- **`pinetrie.commands`** is a host-written record of every command's summary,
  for the composer's completion. `setIfChanged` is how the host writes a
  record at start only when it changed.

# Runs and startup (`chat.ts`, `startup.ts`)

- **`settleRun`** (`chat.ts`): a compelled message pi refuses to run is kept,
  appended with no reply, rather than lost; the author already heard
  `started`.
- **`planStartup`** (`startup.ts`): a starting host resumes every lane a
  crash interrupted, whose run's end then drains it, and drains every other
  lane with cards queued for it, since no run's end will. A verdict left
  pending lost its request with the last host and is `unclassified`, unless
  its lane is resumed. What does not survive a process (runs and streams)
  is cleared first (`planClear`, `live.ts`).

# Cards (`card.ts`, `notes.ts`, `queue.ts`, `moves.ts`, `in-place.ts`, `move-history.ts`, ADR-0048, ADR-0059, ADR-0066)

What you type is a card. Its text is a `TextDoc`, written by clients; its
record is in the places document (`PlacesDoc` in `@pinetrie/schema`), which
only the host writes. These modules decode a record, decide where a card
sits, which moves the host accepts, which queued card is popped next, and
which are swept.

- **A card is an identity, a place and content** (`Card<K>`, core's
  `places.ts`, ADR-0126): its kind, its id, its owner and placer, its
  place (`PlaceOf<K>`), and its content (`ContentOf[K]`): a text card's
  command and why it was not sent, a fact's fact, nothing for a thread's
  card or a note column. `CardRecord` is the union over the kinds with
  records (`PlacedKind`), so a thread's card in a queue or a fact anywhere
  but a queue does not compile. A new kind is a row in `KINDS`, one in
  `ContentOf`, and one in the page's `RENDERINGS`.
- **`KINDS` is every kind once** (core's `kinds.ts`, `satisfies
  Record<CardKind, KindSpec>`): its id's prefix (`kindOfCard` reads them;
  a bare uuidv7 is a text card's), its places (`PLACES_OF` is read from
  it), whether a person moves it (`moves`: not a fact), whether it is
  reordered where it is (`reordered`: not a fact), what a put does to your
  hand (`put`), and where its words are (`text`). `textSourceOf` turns
  that into the document, fact or nothing a reader reads, and `wordsOf`
  (`fact.ts`) reads it: the drain's pop and the pinned cards a run reads
  (`pinnedReads`) gather through it, so no reader branches on kind.
- **An address names a thread, an entry, a block, a range or a card**
  (core's `address.ts`, ADR-0126): one codec, `printAddress` and
  `parseAddress`, total, for the record, the wire, the pane and links in
  text (`/a/<address>`, `addressLink`, `addressLinks`). An entry names its
  thread, so it resolves without a walk. A block is numbered once
  (`blocks.ts`: `numberBlocks`, `blocksOf`, `blockSource`), the walk the
  page draws by too; a past address's markdown is `pastMarkdown`.
- **A reference is a card holding an address** (`ReferenceCard`, `q-`
  ids): its content is the address and its quote's blob, so it draws
  without loading the referent's root. It is a note, in an inventory, or
  discarded: nothing that reads a queue or pinned cards reads a quote yet
  (`wordsOf` reads none), so it is in neither. A put from your hand copies
  it (`KINDS`' `put`). It is made by `planMakeReference`
  (through `planMake`), the host's `make-reference`; a creation, so in no
  history. *Edit as text* is `planEditAsText`: one move set, a new text card
  in its place, its `origin` the address, and the reference to the trash,
  undone whole. A text card's `origin` is stored printed ("" for none).
- **One rule makes every card** (`planMake`, `moves.ts`): it takes a card
  already made (`makeCard`, whose place type is its kind's, so a misplaced
  card does not compile) and refuses `exists`, then as any move into its
  place is (`refuseInto`). Its sender is a person, or `"host"` for the
  kinds no person moves (a fact), refused only by a full inventory. A
  person's creation (`planMove` with no `from`), a copy's card
  (`planCopy`), a thread's card at its first message (`planThreadCard`),
  a note column made for a note (`toNotes`), a fact's card (`planFactCard`)
  and a split's card (`planSplitCall`) all go through it, each made by the
  person it names. A refusal of the host's own make is a value the host's
  shell logs, never a silent write; none is refused today.

- **The stored record is flat strings**, "" for none (`encodeCard`,
  `decodeCard`, total). Where a card is goes through core's `placeFields`
  and `placeOfFields` (`core/places.ts`), which the wire's key codec uses
  too, so the two cannot drift. Each stored kind's row has its fields in
  one table (`ROWS`): a row is written through it and read narrowed to its
  kind, so neither can touch a field its kind does not store. Your
  message, a pinned card and a queued card name their thread alone (stored
  in `lane`), and resolve to its end (`placeEnd`, `threadEnd`): every entry
  names its thread (ADR-0125). Their rows keep no `at` (migration
  `0009-card-content` cleared the old ones); the row's `at` field stays for
  `fresh`. A fresh card's `column` is
  never "", and it carries its root, its task and its branch point (a
  `Spot`, ADR-0066), the root for a new tab; a canvas card its task, rank
  and width; a queued card has its `order` and `by`, and `seen`, its text's version as its queuer had it (S96), which
  the queue's key carries from the client. Every field is required: the
  host writes a record whole. A
  `command` this build does not know makes the card malformed. A text card
  stores its command (or ""), and a fact card (`x-` id, ADR-0126) its fact,
  as JSON in `fact`: a fact on a text card's id, a command on a fact, or a
  fact anywhere but a queue does not decode, and a record stored before
  facts, with no `fact`, is a text card. Your message (`composing`, ADR-0113) is stored
  under the kind `drafting` it had before notes, so no row changed with
  the split; a note is stored as `note`, its note column in `column` and its
  rank in `order` (ADR-0116). A card at a thread whose stored `lane` is no
  thread's id does not decode: migration `0005-tasks` (deleted once run)
  gave every such row its thread. A card's kind is its id's prefix
  (`kindOfCard`), and its id is parsed where it comes in (`parseCardId`):
  a text card's is a bare lowercase uuidv7, a note column's, a fact's, a
  media card's and a file card's their prefix and one, a thread's any id
  `isThreadId` takes. A note column's card (`NoteColumnCard`) is on a
  canvas alone: a row naming an inventory does not decode.
- **A handoff is a compare-and-set on where a card is** (`planMove`, pure):
  accepted only if the card is still where its sender saw it, its `PlaceKey`
  (`sameKey`, over its kind and thread, or an inventory's holder). A
  key leaves out a queue's order and queuer, so a reorder does not make
  someone else's unqueue fail. It leaves out a queue's `seen` too. Every
  move, on the host and on a client, is built by core's `moveOf` (from
  where the card is); an unqueue's or an unpin's target is `noteOf`, the
  thread's nearest notes (`notes`). That is a `MoveTarget` alone, on
  `Move.to`, never a `PlaceKey`, so no stored place or `from` is one; the
  host resolves it to a place before planning (`planMoveRequest`, below),
  and `planMove` takes a `ResolvedMove`, so an unresolved one does not
  compile. No `from` creates the card, its sender its owner: a text card,
  or a note column on a canvas (`n-` id), which is then in its task's
  history. Where each kind of card may be is one table, core's
  `PLACES_OF`, which `fitsPlace`, `placed` and each record's place type
  (`PlaceOf`) read. Nobody removes a card:
  `Move.to` is never null. A discard is a move to `gone` (`DISCARDED`,
  ADR-0111), from any place the sender may move out of. Its key names no
  task: the host names its history (`placeAt`, `historyOf`, over
  `Discards`), the task the card leaves (`taskOfPlace`), or for a card in
  an inventory the task its sender is on (`here`, which a `move` carries).
  A spin-off's `here` is the task its sender will be on: the new one for a
  drop in the sidebar, else the tab's. A queueing passes `NO_DISCARDS`,
  since its target is a queue. A gone card keeps its
  record and text, is drawn nowhere (every read of a place names the kinds
  it draws), and moves only by an undo:
  a handoff from gone is refused `gone`. `planGoneSweep`
  (`card-history.ts`) deletes it once its newest history event is older
  than `GONE_KEEP_MS` (7 days). Queueing puts it after the lane's
  last card, queued by the sender, and clears why it was not sent before;
  below the line, or into an inventory, it keeps both. A move to where the
  card already is is refused `moved`: it would queue the card last under its
  sender's name, and a card changes its place in line by a reorder.
  Refusals (`MoveRefusal`): `gone` (no record, or discarded), `moved`,
  `exists`, `full`, `not-yours`, `no-place` (a place the card's kind is
  never in, or a kind no person moves: every move of a fact is refused so,
  with no check of its own), and an undo's `replied`.
- **A reorder is a card's action in place, not a move** (`planReorder`,
  ADR-0048 step 7). It names the card, its place's key, and the two cards
  it goes between as its sender saw them; the host checks them against the
  places alone, since a thread's pinned cards are found through the tree,
  which a handoff does not read. Where a reorder may be is core's
  `REORDER_PLACES` (`ReorderAt`, `isReorderAt`, which the codec and
  `reorderOf` read too), and `REORDERS` has a row for each, so a place a
  reorder may be at cannot lack its siblings: the lane's queue, its note
  column's notes, its task's pinned cards, its task's canvas, or every
  pinned card in the session (pinned keys are the session's). Only `order`
  changes: `placer`, `by`, `seen` and `unsent` stay, so it changes nobody's
  trace and adds no history event. Its refusals are its own
  (`ReorderRefusal`, `ReorderStep`), so a move never returns one: `gone`;
  `fact` for a card of a kind `KINDS` does not reorder (a fact), or a
  queued card whose new place passes one (a fact says what already
  happened, so nothing queued jumps ahead of it); `moved` when the card's key changed; `order-changed` when it
  names no neighbour, a neighbour is no longer a sibling, the two are out of
  order, or, in a queue or a note column, no longer next to each other
  (other threads' pinned cards may sit between two pinned neighbours). With no room between the
  neighbours, `respace` (`order.ts`) gives new keys to the fewest siblings
  around the gap, in the same step, so a whole undo is refused only when one
  of those few changed since. The session draws a pending reorder by running
  `planReorder` over what it draws.
- **`planUnqueueAll`**: every message card queued on a lane, to `noteOf`
  its place (the thread's nearest notes), in queue order; a fact stays. The host plans it
  from the queue as it is when the command arrives, and carries it out as
  one move, so one undo queues them again.
- **An inventory is its holder's alone** (`ownsPlace`): a move into or out
  of someone else's is refused `not-yours`, checked on both ends, and a
  move into yours `full` once it holds `INVENTORY_SLOTS` cards, the card
  itself not counted. A creation obeys both. A card taken into the
  inventory keeps its owner: the take moves its place, not who wrote it.
- **A fresh column's first send carries its other cards**
  (`planFreshFollow`): each card fresh in the sent card's column becomes a
  note in the note column nearest the thread the send started, made in the
  same step when its task has none, when the message is in the column's
  root and the thread's card is on a canvas. The host's write, so it keeps
  each card's placer, as `planUnsent` does.
- **The placer is who put the card where it is**: the sender of every
  accepted move. A write the host makes itself keeps it (`planUnsent`,
  `planSetCommand`), so a refusal never names the host.
- **Several moves are one** (`planMoves`): each planned against the cards
  as the ones before it left them, accepted whole, or refused by the first
  that is, naming its card. A keep's cards are one command, so it is undone
  whole too (ADR-0066). `planMoveCommand` is that and the lanes to drain:
  each one a card ends queued on, when it is not running.
- **Which history a move enters is `historyOf`'s** (ADR-0066): none for a
  creation (a composer's new card, a copy) or a send, which is no move,
  but a note column's, which enters its canvas's task, so the undo key takes
  it back;
  else the task the card goes to, when it goes to one, else the task it
  leaves, read from its record, since a move is accepted only from there;
  a discard's is `discardHistory`'s. A place is in a task by `taskOfPlace`,
  so no tree is read. An inventory is in no task.
- **`undoAnswer`** reads what a whole undo did: the cards its step wrote,
  from their footprints in the places document (`["cards", <id>]`), each
  with its place now; or, refused, the first card it could not undo as it is
  now, `moved` (its placer names who) or `gone`; or `nothing`.
- **`planHistorySweep`** gives the histories of moves to retire: a task's
  `ARCHIVED_HISTORY_MS` (7 days) after it was archived, and, at startup
  only, those of a task the session does not hold. After a run's end that
  second rule would retire a new tab's history while it is open. An id
  that names no task is left: the histories once kept by root were
  retired by migration `0005-tasks`, since deleted.
- **A card at a thread's end is resolved, never stored as an end**: your
  message, a pinned card. `placeEnd` takes the thread its place's entry is
  in (`threadAt`) and that thread's end (`threadEnd`), so the card follows
  its thread as the thread grows. `pinnedAt(end, …)` is everyone's pinned
  cards whose end is `end`, by `order`, then by id. `cardEnd` is your
  message's end only (`composing`), and `yourCard` finds yours through it,
  at an end or a fresh column, never another writer's and never a note,
  the newest of yours there (ids are uuidv7). Were `cardEnd` to resolve
  pinned cards too, your composer could bind to one of yours.
- **A note is in a note column** (ADR-0116), at a rank there (`order`), the
  host's to give as a queued card's is: a move into a column lands at its
  end (`noteAt`), and ↑ and ↓ are reorders among the column's notes
  (`notesIn`). A note's key names its column alone, so a reorder there
  does not make someone else's move fail.
- **A card leaving a thread's queue or pinned strip goes to the note
  column nearest the thread** (`nearestNoteColumn`, pure): in the canvas of
  the thread's task, the note column fewest places from the thread's card,
  the one after it on a tie; with none, one made just after the thread's
  card (`orderBetween`, or `respace` with no room), untitled, read as
  `NEW_NOTES_TITLE`. `notesNear` decides which, minting nothing: a
  column, one to make (its task, rank and the canvas cards renumbered
  around it), or, for a thread whose card is in an inventory, that
  inventory (ADR-0117). `toNotes` turns that into a place and the steps to
  write first, minting a column's id (`newColumn`, `n-` and a uuidv7 on
  the host) only when one is made; moves, unsent cards and a fresh
  column's followers all go through it. The page names the target `notes`
  (`noteOf`), and the host resolves it (`planMoveTargets`, inside
  `planMoveRequest`, which ranks a spot on a canvas, `canvas-at`, too), each move against the cards the ones before it
  left, so a column made for the first takes the rest, and writes the
  column in the same step as the moves. The page draws a pending one in
  the column the host would choose (`drawnPlace`), or where it was while
  the host would make one.
- **A card the host could not send** (`planUnsent`) goes to the note column
  nearest its thread the same way, saying why. Where it has nowhere to go
  (its thread's holder's inventory full, or a thread with no card) it stays
  queued, saying why, and the host holds its queue, so the drain passes it
  by until someone moves it.
- **A note column's title** is its own record (`NOTE_COLUMN`, keyed by its
  id: title, who set it, when), absent while untitled. `mark` sets it as it
  sets a task's (`planMark` over a `MarkTarget`): last write wins, null
  clears it, the agent never sets one, and a column on no canvas is refused
  `UNKNOWN_TARGET`. The archive gate reads a note column's task from its
  card (`writesIn`).
- **A pinned card** (ADR-0048 step 5) is at a thread's end with an `order`.
  Pinning moves your message or a queued card to pinned at the same
  thread (`pinnedOf`); a note has no thread to pin it to; unpinning
  sends it to the thread's nearest notes (`noteOf`). Anyone may do either in
  a shared place. The host
  orders it after every pinned card in the session (`placeAt`), not only its
  thread's: a thread is found through the tree, which a handoff does not
  read, and an order only has to grow within a thread.
- **The queue is fields, not a list** (S69): `queuedOn(cards, lane)` sorts
  a lane's queued cards by `order`, then id. Order keys (`order.ts`) are
  fixed-width base-36 integers, started mid-range and stepped
  (`orderAfter`), so string order is numeric order and there is room before
  and between; `orderBetween` is a step from one open end or the midpoint,
  null when none fits. Only the host assigns them (`planMove`,
  `planReorder`). `planNextQueuedCardPop` passes over blank messages
  (`blankQueued`: a queued `isBlankMessage`, no command and only
  whitespace, whose text the caller holds as its queuer had it, S96;
  ADR-0113), which stay where they are, and wait for nothing: `readLanes`
  leaves them out of `waiting`; of the rest, the top card is the
  one it speaks of. It answers `idle` while the lane runs or nothing is
  queued; `held` when its queue is held and its top card is a message;
  `typing` when someone types in its top card (presence `typingIn`);
  `blank` when every card queued is blank; else `pop`. A fact on top is
  popped whatever the hold or the typing: it is nobody's instruction, and
  starts no run. `planUnsent` is the
  step a refused pop writes back: a note in the note column nearest its
  thread, saying why, never queued (above).
- **`planCardSweep`**: records whose text is empty and that carry no
  command, and stored `card:` documents with no record, a spent or empty
  card's among them.

# Queue holds (`queue-hold.ts`, ADR-0048 step 7)

A thread's queue held: while `QUEUE_HOLD` has its lane, the host pops no
message card from it, and a send there waits in it (`sendWaits`, core), so
people can stage several cards on an idle thread. It is a session record,
not `pinetrie:live`, so it lasts until a release, across a restart.

- **`planQueueHold`**: a hold is written only where there is none, so the
  first holder stays named; a release deletes it; nothing when the queue is
  already so.
- **`holdOnStop`**: a Stop holds the queue when a message card is queued
  and nobody holds it yet. With nothing queued, or only facts, it holds
  nothing: the correction sent after the Stop would be held too.
- **`planHoldSweep`**: the holds whose lane no root holds (`pinetrie.lane`),
  or whose root is archived. Archiving is refused while cards are queued,
  so a swept hold held nothing.
- **`isBusy` is unchanged, and a held queue is not work.** A held queue
  with no card is not busy: it blocks no archiving. A busy lane that is not
  running and whose queue is held is `held` in `rootWork` (core), which
  refuses archiving as `waiting` does but draws no ring (`threadStatus`):
  nothing happens there until a person acts (ADR-0113).
- **`planQueueCard`** (ADR-0113): every queue is one request, `queue-card`,
  a move into a queue and what it does to the hold (`keep`, `hold-if-idle`,
  `release`), planned together: `planMoveCommand` for the move and, only
  if it is accepted, `planQueueHold` for the hold. `hold-if-idle` holds
  nothing on a running lane. The host writes the hold before it carries the
  move, so the move's drain finds the queue as planned. A send on an idle
  held thread is `release`: sending removes the hold. A move with no `from`
  makes the card in the queue, carrying the request's `command` in its
  first write: a command sent as `set-command` after it could arrive after
  the drain popped the card plain. A card is never made elsewhere to be
  queued: a note is a place of its own, not a step on the way.

# A card made a thread (`spin-off.ts`, `root.ts`, ADR-0111)

- **`planSpinOff`** checks a spin-off before anything is written: its move
  must be to gone, spun into a root (`GoneWhy` `spun`, the thread in it),
  in a new task the request names;
  that root's id must be free; the card's text, trimmed, not blank; and the
  move as `planMove` decides it, so a card someone moved first, or one in
  another's inventory, is refused as any move is. It returns the thread's
  first message (the text, its mentions without the agent: a conversation
  root has no lane) and the card's write.
- **`planLiftRoot`** decides an undo that would move cards spun into
  threads (S139: the host reads them from the stack's `top` first). Each
  thread the directory still names must hold its first message alone (its
  tree's writers, oldest first), with no lane and no card in it but those
  the undo moves; otherwise `replied`, naming who wrote second (null for
  the agent, a lane or a card). A card is in the root by `rootOfPlace`.
  Its thread's card must also be where the spin-off put it (ADR-0124): on
  a canvas, never moved since (its card history holds its making alone),
  with no other card on that canvas and none pinned to the task, so an
  undo restores exactly what was there or does nothing. A
  thread already gone lifts nothing; `delete` names each root and its
  thread, read before the undo reverts the card.
- **`planRootDelete`** (`root.ts`) is what deleting a lifted thread
  writes: its directory record (`ROOT`), its thread's (`THREAD`), and its
  task's record, board place and title deleted, every card still in the
  root or on the task's canvas removed, its document named for
  destruction, and the task for its stacks to be unloaded;
  `planHistorySweep` retires those stacks at the next start, as for any
  task the session lacks.
- **The history's verb is `spun`** (`verbOf`): "spun off into a thread by
  Ada", and a trace "Ada made a thread of this".

# Card history and traces (`card-history.ts`, ADR-0048 step 6)

Each card's history and the traces left where someone else moved your card.
Both are session records the host writes: `CARD_HISTORY`
(`pinetrie.card-history`, keyed by the card, deleted with it) and `TRACE`
(`pinetrie.trace`, keyed by its own id, since a trace outlives its card). A
place in them is stored as core's flat key fields (`placeFields`,
`keyOfFields`), the wire's own codec; an event whose place this build cannot
read is dropped, not its history.

- **`planProvenance` is the one decision**, from the cards before and after
  a write, the cause, the records, the presence pairs (`reading`) and each
  shared card's thread end before the write (`ends`). It diffs, so an undo,
  whose revert Kyneta writes, is read like any other write.
  - A card that appeared is `created`; one whose key changed gets `moved`,
    `undone`, `redone`, `unsent` (the host wrote a queued card back below
    the line with `unsent`) or `followed` (a fresh card to a note); one
    that went has its history deleted. A reorder changes no key, and adds
    nothing.
  - **A trace** is left for the card's placer when a person (not the host)
    other than the placer moved it out of a traced place (queued or
    pinned: `TRACED`, a row each with where its column draws it, so a place
    traced with no drawer does not compile; a note column is everyone's
    scratch, and your message is yours alone), it was not an unqueue or an unpin, and no presence pair has the
    placer at the card's end. A card whose end is unknown (its root not
    loaded) counts as not watched. A spend's trace carries the message.
  - **A trace whose card is back at its `from`** is deleted.
  - Histories keep `HISTORY_EVENTS` (50): the first event and the newest.
- **`verbOf(from, to)`** is the one rule for what a change is called: sent,
  queued, unqueued, pinned, unpinned, took-into-inventory, put, moved or
  created. The
  page's words read it; nothing stores a verb.
- **`movedBackBy`**: who unqueued or unpinned a card, when that is the last
  thing that happened to it and it was not its owner.
- **`planTraceSweep`**: traces older than `TRACE_MAX_AGE_MS` (30 days), and
  histories whose card has no record (the startup sweep's empty cards, or a
  crash between the places write and the history's).

# Seats (`seat.ts`, ADR-0048)

Who wrote in a text is in its operations: each carries its seat's Yjs
`clientID`. Only the host knows which person a seat is, and only while it is
connected (ADR-0037), so it writes a `pinetrie.seat` value per seat as the
seat connects (`SEAT`). It is keyed by the seat's Kyneta peer, the seat's
identity as presence's `seatKey` has it. The `clientID` is in the
contents: Yjs derives it from the peer, which this package cannot.

- **`planSeats`**: the connected seats with no record yet. The connected seats
  come mapped by `seatOf` (`@pinetrie/schema`), which needs Kyneta's
  `yjsClientId`, which this package does not import.
- **`writersOfClients(clientIds, seats)`**: the people behind a text's `clientID`s,
  each once, in the order their seats were first seen. A card sent by one
  person names the others this way, in `ChatDetails.contributors`: "Ada, with
  Bea". The model reads only the sender's name.
- **`planSeatSweep`**: seat records no stored text names. A store-less client
  is a new seat on every load, so without it the records would grow with every
  visit. It returns the records, and the host deletes each by its `peer`.
  A seat stored under its `clientID` before ADR-0062 reads with that text as
  its `peer`, which is its address, so the delete finds it.

# Tasks (`task.ts`, ADR-0116)

A task is the board's card. Its record (`TASK`) says who opened it and
when; what it holds is where the places document puts each card: a
`canvas` place names the task, a rank and a width, so a card has one place
by construction.

- **One `TaskIndex`** (`indexTasks(cards, threads)`): each task's canvas in
  order, each canvas card's task (`taskOfCard`), each thread's task
  (`taskOfThread`), each task's threads and roots, each root's tasks, each
  recorded thread's root (`rootOfThread`). The host (`tasksNow`, once per
  command, `commands/index.ts`) and the page (`tasksOf`) both read it, so
  they cannot disagree on where something is. A note is in its note
  column's task (`taskOfCard`).
- **A place at a thread names its thread and no root** (composing, pinned,
  queued; the thread in the row's `lane`). Its task is its
  thread's (`taskOfPlace`), and its root its thread's record's
  (`rootOfPlace`): one field per fact, so the two cannot disagree.
- **`planThreadStart`**: a thread's record, its card on its task's canvas
  just after the thread it forks from (`planThreadCard`, `branchAfter`,
  `rankAfter`), a new root's at the end, and for a task the session does not hold, the task's
  record and its board place (`placeStarted`). `planChat` decides that a
  send starts one (`starts: ThreadStarts`: its card's task and board state;
  the thread is the decision's `thread`); `sendChat` plans it with the
  send, and `executeChat` writes it before the message.
- **`rootsHeld`**: the roots with a thread on the canvas of a task outside
  the archive, or in an inventory: what a starting host loads, and what
  archiving keeps.
- **`forkOf`**: each copy's fork, from its record's `origin`: where its
  column ends before its first send.

# Threads as cards (`held.ts`, `copy.ts`, ADR-0117, ADR-0124)

A thread's card is a canvas's or an inventory's (`PLACES_OF.thread`), and
moves between them as any card does (`planMove`, typed at the codec by
`typedMove`). An inventory has no agent and no runner.

- **One gate, per command kind** (`runsIn`, beside `writesIn`): what each
  `Intent`, or a queue's pop, runs or writes a message in: a send at a
  thread's end, a carry-on, an offer action that may ask the agent (all but
  an acceptance) and a pop run in their thread; a branch in the thread its
  fork is in, read from its root's tree; a new root in none. Exhaustive, so
  a new kind of command does not compile until it says. `heldIn` finds
  the first of those someone holds (`holderOf`); a copy's first send, at
  its own record's fork, runs in the copy. The host refuses before every
  command and popped card (`refuseHeld`), and the drain asks before it
  pops (`planNextQueuedCardPop`'s `away`), so its messages wait, held. A
  fact on top is popped there all the same: it starts no run, and a take's
  stop must be in the thread for its face to say so (ADR-0126). Refused
  with `HELD_WORDS`, "put it on a canvas first".
- **A take stops the run** (`takenIn(before, after)`): every thread card
  in an inventory after a change that was not before. The host's
  provenance step reads it from every person's change to the places (a
  move, an undo or a redo, a copy), so no path that writes places can
  take a running thread and leave it running. The stop is the taker's own,
  through the one stop command (`handleStop`, `planStop`), so it is a fact
  in the thread.
- **A moved thread is told** (`canvas.ts`, `planCanvasFacts`): a running
  thread whose card moved from one task's canvas to another's is steered
  "Bea moved this thread to the task …"; the tasks' other running threads
  are told it was taken and added.
- **`planCopy`**: a copy of `source` at `end`, refused unless `end` is in
  the source (`threadAt`), the copy's id is new, and nobody else holds the
  source. Its record's `origin` is `{ kind: "copy", source, fork: end }`,
  kept after its first send, so its fork row can say "copied from". Its
  card is made by **`planMake`** (`moves.ts`), the one rule every card is
  made by: `exists`, then `refuseInto`'s refusals (a place its kind is
  never in, another's inventory, a full one). It lands on a canvas
  by **`rankOnCanvas`**, as a move's drop does. No entry is written: its
  first send is a branch at its fork, which `sendChat` lets through for the
  thread whose record names that fork, and writes no second record or card. (`board.ts`, ADR-0122)

Every task is in one workflow state. The workflow is a host-written
singleton (`WORKFLOW`): the open states in board order, then the closed
state, always there and always last. A task's place is a host-written
value keyed by its `TaskId` (`BOARD`): its state, its rank there, who moved
it, and when.

- **The board is total** (`boardOf`): every task it is given, in its
  place's state, by rank, then by id; a task with no place, or one in a
  state the workflow no longer holds, at the end of the first open state.
  A missing or stale record never hides a task.
- **Archived is derived, never stored** (`archivedOf`): the tasks whose
  place is the archive, with who moved them there and when
  (`ArchivedTask`), keyed by `TaskId`. Every former reader of the archive
  record reads it (`readArchived`).
- **`planTaskMove` decides a move over the board alone.** The sender names
  the state it saw the task in; one that has left it is refused
  `task_moved`, naming who moved it and where. `before` is the task it goes
  before, or the end. The new rank is `orderBetween` its neighbours; with no
  room, or a neighbour with no place yet, the whole state is renumbered,
  the others keeping who put them there. A reorder within the archive
  keeps `by` and `at`, which say when the task was archived and so when its
  move histories retire (`planHistorySweep`).
- **`transitionOf` says whether a move crosses the archive's edge**:
  `within`, `close` or `reopen`. The host gathers the task's roots'
  documents only to cross it (`apps/pinetrie/host/commands/board.ts`).
- **`planWorkflowEdit`**: add (before a state, or after every open one),
  rename (trimmed; names may repeat), move, remove. The archive is
  renamed only; a state holding a task is not removed, nor the only open
  state.
- **`placeStarted`** puts a new task at the end of the state its chat names,
  or of the first open state when it names none, one gone, or the closed
  one.
- **Order keys are `order.ts`'s**, shared with cards' queues and pins:
  fixed-width base-36, so string order is numeric order; `keyAfter`,
  `orderBetween` (null with no room), `orderKeys`.

# The archive (`archive.ts`, ADR-0029, ADR-0122, ADR-0116)

A task put aside for everyone: one in the archive. Moving it there or out
writes only its board place: entries are immutable, so a task is hidden
and made read-only, never removed.

- **`planArchive` decides what crossing the edge does**, pure, for a
  `Crossing` (`close` or `reopen`). Closing is refused `task_busy` while
  any lane of the task's threads runs or has cards queued (`threadsWork`).
  `TASK_BUSY_REASON` is the one wording, which your list's and the board's
  Move to ▸ show too. Reopening is never busy.
- **A crossing is planned whole, in three parts** (ADR-0065): the place,
  written on the documents' keeper; the `teardown`, carried out off it
  (the task's threads' own lanes to forget and remove, their refs in your
  repo, null on close and each tip's nearest revision's commit on reopen,
  and `planRetention`'s snapshots); and `unload`, for a close, on the
  keeper again: the task's roots no task outside the archive, and no
  inventory, still holds a thread of (`stillHeld`). The host passes its
  lanes of their own (`own`, each with its root's index) and the revision
  records, so no part decides anything when it runs.
- **The gate keys on the tasks a command writes in** (ADR-0063). `writesIn`
  names them for every intent (a chat's thread's task or a branch's, a
  mark's, a retitle's, an undo of moves', an offer's lane's, a queue hold's
  and an unqueue all's lane's, a reorder's place's, and for a move the task
  each card goes to and the one it leaves), or none for one that writes in
  no task (a name, a stop, a move on the board or a change to its states,
  a reservation, a command on a card, traces seen), so an archived task can
  always be restored, and nothing moves out of one (`task_archived`,
  "restore the task first"). `archivedIn` finds an archived one by its
  `TaskId`. One rule, applied by the host before dispatch
  (`apps/pinetrie/host/commands/index.ts`); the pop's own gate stops a
  queued card whose thread's task is archived.
- **Yjs writes are not refused for archiving.** A card's text in an archived
  task stays writable to the host's policy (a refused write cannot be
  recovered from, S28); the composer there is read-only.
- **Every planner refuses with core's `Refusal`** (`refused(code, message)`),
  the shape the codec decodes to and the host answers as its `Outcome`
  unchanged, so no package spells it out.

# Marks (`mark.ts`, ADR-0045, ADR-0116)

A task's title. The record is a host-written `pinetrie.mark` value in the
session, keyed by the task's id, so a task has at most one by
construction. A mark once kept in a root's document, on its root entry, is
deleted at startup (`planUndeclaredSweep`: stored outside its spec's
home).

- **`planMark` decides**, pure: a task the session does not hold is
  refused `unknown_target`; the title already stored, or clearing a task
  with none, is `unchanged` and writes nothing; otherwise `write`, or
  `remove` for a cleared title. The last write wins: nobody types a title
  together.
- **Clearing deletes the record.** A stored empty title would read as chosen.
- **A mark in an archived task is refused by the archive's gate:**
  `writesIn` names a mark's task, so `planMark` has no check of its own.
- **`by` is a writer, or the agent for a title it made unasked**
  (ADR-0074). A writer id always starts `w-`, so the two never collide, and
  nothing decides by it.
- **The title rule is `parseTitle`'s** (`@pinetrie/core`): trimmed, empty
  clears, one line of at most `MAX_TITLE`. The codec and the page both
  decide by it. The decoder checks only the shape (a non-empty title): the
  host is the session's one writer, and stores only parsed titles.

# Stops (`stop.ts`, ADR-0106, ADR-0126)

Who stopped an ask's run is a fact in its thread: pi's entries say only
that a run was aborted (S70). `planStop` queues a fact card (`StopFact`:
the lane, the ask's prompt, who, when; `planFactCard`) as Stop is pressed,
before the cards queued there, and none when a stop of that ask is queued
or appended already: the first press is the one named. The run's end
appends it first, whatever the hold, as a `pinetrie.fact` history message
whose `content` the agent's next run reads ("Bea stopped this run.",
`factContent`), and whose renderable form carries `stopped` (`{ prompt,
by }`) for core. `planStop` also gives the hold the Stop leaves on the
queue (`holdOnStop`, ADR-0048 step 7), written before the abort.

- **Who stopped a run is read from the asks**: `indexAsks` records each
  stopped run's stopper (`AskIndex.stoppedBy`) from its stop's fact, and
  steers the fact into the ask it names, so the ask is not drawn in two.
  `askOutcome`, the thread's face and the dock's `nextOf` read it; no
  reader takes a map of stops. A stop whose run answered anyway is ignored.
- **Until its fact is appended, the queued fact names the stopper**
  (`stopperOf`): the run's verdict, written as the run ends, reads the
  outcome so (`endedOutcome`), and so does the dock.
- **A run stopped before stops were facts names nobody**: its
  `pinetrie.stop` record is in no spec now, so a starting host's sweep of
  undeclared records deleted it (`planUndeclaredSweep`), and its outcome
  reads "stopped" with no name (`AskOutcome`, `by: null`).

**Carrying on** (ADR-0082). pi cannot continue a run that Stop ended
(S105), so Resume starts a new run whose prompt is a carry-on message
(`pinetrie.carry-on`, role `carry-on`), a history message. Its `content` tells the model who asked it to carry on, and that
what it was writing when stopped was not kept; its `details` hold the lane,
who resumed and their name then, for the column's line ("↻ resumed by
Ada"). It is a prompt, so its run is an ask of its own (`PROMPT_ROLES`).

- **`carryOnState` is the one rule**, read by the host's `planCarryOn` and
  the dock's `nextOf` (`@pinetrie/interface`): the lane does not run and has no cards waiting,
  unless its queue is held (ADR-0048 step 7: held cards wait for a release,
  not this turn), and the ask at its tip ended stopped (`askOutcome`). A
  stop's fact at the tip is no prompt, so `promptOf` passes it and the
  stopped ask is still found. A message written after the stop is
  the tip's ask, with no work, so it refuses; an update is no ask, so it
  does not. It refuses with `UNKNOWN_TARGET` (no tip), `BUSY` or
  `REFUSED`.
- **`planCarryOn`** returns the run's message, or core's `Refusal`, worded
  once (`refusedCarryOn`). It takes the lane with its tree and asks, or
  null for a lane no root holds, which it refuses `UNKNOWN_TARGET`.

# Digests (`digest.ts`, ADR-0106, ADR-0075)

A model's headline and few points for a long ask's work, unless
`{ "digests": { "enabled": false } }` is in the user config
(`decodeDigestConfig`, ADR-0071). A host-written `pinetrie.digest` value keyed
by the ask's prompt, `{ headline, points, at, final }`, replaced whole each
time: a value, not a text, since nothing accumulates (ADR-0014). A null
headline is a digest with nothing to draw. No agent reads it.

- **`digestDue` is asked on events, never on a timer**: each turn done,
  and the run's end. While the run lasts, only when nothing is asked
  already, someone reads the thread (`readsAsk`, over presence's
  `reading`) and `DIGEST_EVERY` has passed; at the end, once, for the
  final one.
- **`planDigest`** is the decision and the request's parts: a long ask only
  (`isLongAsk`, core's `LONG_ASK`, which the rail draws as a capsule of its own), then `digestDue`, then the
  ask's message as one line, its run's messages walked up from the run's
  last entry (`AskIndex.last`) and kept to the ask's own, and its last word
  (`lastWord`) apart from them as `shown`, since the reader sees it after
  the fold. The ask's line is worded from its prompt entry
  (`transcriptLine`), since `transcriptLines` leaves out land and stack
  messages.
- **`digestOf` refuses rather than cuts**, as `titleOf` does, and shares its
  unwrapping (`bareLine`, `request.ts`): the first line is the headline,
  every other line a `- ` or `* ` point, or the whole reply `nothing to
  add`. A headline over `HEADLINE_WORDS`, more than `MAX_POINTS` points, a
  point over `POINT_WORDS`, or a line of prose is null.
- **`digestText` is `digestOf`'s inverse**, and `pointsText` its list: the
  one wording of a digest, for the next request's summary so far, the
  rail's tooltip and the client's list. `nothing to add` round-trips.
- **`digestToWrite` is the whole write decision.** A live reply that comes
  back after the final one was written is dropped: a digest is keyed by its
  prompt, so no other ask's can land on it, as long as the host names the
  right prompt (`apps/pinetrie/host/TECHNICAL.md`, "Digests"). A refused live
  reply writes nothing, so the last good digest stays. A refused final
  reply writes an empty final digest: a live headline says what the run
  was doing, which is no longer true.
- **`askLines`** is an ask's run as transcript lines, `planDigest`'s and a
  short ask's verdict request's alike.
- **`digestRequest`** is the skill, the ask, the run's newest work that fits
  (`fitNewest`: the oldest is cut first), the last word, the last digest,
  and what to answer with (`Answer`): a digest alone ends with nothing
  more, a verdict with `VERDICT_ALONE` or `VERDICT_THEN_DIGEST`, which the
  scripted model reads. The ask and the last word are never cut.

# Verdicts (`verdict.ts`, ADR-0077)

How a thread's last run ended, for the people who follow it.

- **`planRunEnded`** decides a run's end: a failed or stopped run's verdict
  is its facts, and only a due digest is asked for; an answered run asks
  for its verdict, with its final digest when `planDigest` gives one; a run
  with no entry to read is unclassified; a run whose stored verdict is no
  longer its own (`current`) gets no verdict.
- **`verdictOf` refuses rather than cuts**, as `digestOf` does: `needs you:
  <reason>`, `worth a read: <reason>` or `done`, in any case, a reason of at
  most `REASON_WORDS` words.
- **`endReplyOf`** reads a run's final reply as `Answer` asked for it: the
  first line a verdict, the rest a digest, each refused on its own.
- **`runEndedToWrite` is the whole write decision**, both records in one
  write: the model's verdict, or `unclassified` for a failed request or a
  refused line, never written over the next run's; the digest as
  `digestToWrite` decides a final one, none for a failed request.
- **`pendingVerdict`** is what a run's end writes before it closes the run.

# The user config (`config.ts`)

Every setting's decoder (`decodeBannerConfig`, `decodeDigestConfig`,
`decodeTitleConfig`) reads through `recordOf`, and a model setting through
`modelRef`: `provider/id`, split at its first `/`, since an OpenRouter id
holds one. Each decoder is total: a missing or malformed setting takes its
default.

# Titles (`title.ts`, ADR-0074)

A model's few words for a task, written as its mark (`MARK`, ADR-0116),
so Rename edits it and every place a title shows reads it. Titling still
reads a root's tree: Phase 2 holds one root a task.

- **`decodeTitleConfig`**: on unless `enabled` is `false`, as digests are
  (banners are off unless `true`); `model` is `modelRef`, or null for the
  run's.
- **`planTitling` is the decision and the request's lines.** Unasked (a
  lane just created, `trigger.kind` `lane`): only for the root's first lane
  (no other lane record names the root), with titles on, the task unmarked
  (`marked`), and none in flight; the lines are the path to where the lane
  starts and its prompt, which the tree does not hold yet. Asked: always,
  from the path to the root's newest message; refused for a root with no
  message. It also names the mark's author: the agent, or the person who
  asked.
- **`titleRequest`** keeps the first line whatever the budget, since how a
  thread began usually says what it is for, then the newest that fit
  (`fitNewest`).
- **`titleOf` refuses rather than cuts**: more than `TITLE_WORDS` words, or
  what `parseTitle` refuses, is null, and the task keeps its label. It
  unwraps quotes and trailing punctuation with `bareLine` (`request.ts`),
  as a digest's headline is.
- **`titleStillWanted`**: an asked title is always written; an unasked one
  only over no mark.

# Where lanes work (`work.ts`, ADR-0032 to ADR-0034)

Host-written records, each a `RecordSpec` (above) with a total decoder:

| record | namespace | key | written |
|---|---|---|---|
| a lane's setting: its own copy, or directly in a directory | `pinetrie.lane` | the lane | once, when the lane is created |
| the commit and disk at an entry, and the paths its commit changed | `pinetrie.revision` | the entry | for every run's prompt, and every assistant message of a lane of its own that made tool calls |
| what the host found where it runs: `lanes`, or `direct` and why | `pinetrie.project` | `project` | at every start |

- **Every run's prompt has a revision record**, so the nearest record above
  any entry names its lane, its commit and its disk (`nearestRevision`, in
  core, finds the nearest commit and the nearest snapshot independently).
  `planTurnRecord` is the rule:
  - A lane of its own records every turn that made tool calls, with its
    snapshot, because ignored files change without a commit. The commit is
    there only when the turn has one: made by the host, or made by the agent
    itself and adopted (`commitTurn` in `@pinetrie/lanes`, S56). Otherwise a
    branch pairs the turn's disk with the commit above, and its `jj new`
    puts that commit's files back.
  - A prompt with nothing to commit records the lane's newest commit, so a
    branch from it names what its disk was at.
  - A lane with no copy of its own records its prompts with neither: it
    counts as the lane above, and the walk passes it.
  - A record from before lane containers has no `snapshot` key, which decodes
    as null.
  - Only a turn's own commit carries `paths` (`changedPaths`, ADR-0106): a
    prompt's newest revision is what came before it. A record from before
    paths decodes with none. An ask's file count is the union of its turns'
    paths (`workStats`), so it is what its review lists.
  - Every record with a commit carries that commit's `conflicts`, a
    prompt's included, since a branch from it is cloned with them
    (ADR-0072); `conflictsAt` (core) reads them by commit. A record from
    before decodes with none.
- **`forkPoint`** is where a new lane of its own starts: the nearest snapshot
  above it, else the base snapshot; and the nearest commit, else the
  thread's base (`planBegin`): accepted work's commit, or a WIP's copy on accepted work
  commit under it. The start is always named: a cloned disk carries its
  parent's working-copy change, and the fork must leave it. A snapshot
  that is gone (`kept` false, which the host asks the runtime) is read as
  missing: the fork starts from its base, and names the snapshot `lost`;
  the host records it (`FILES_LOST`, `pinetrie.files-lost`, keyed by lane),
  which a copy's fork row reads (ADR-0124).
- **A project record of kind `workspaces` no longer decodes**; the host
  rewrites it at start.
- **`planRetention`** keeps every snapshot of an open root, and each lane's
  newest when the root is archived, and the one nearest each thread's end
  in its roots (`keep`, from `planArchive`'s `trees`), whatever task the
  thread is in, which a copy from the archive clones (ADR-0124); the base
  snapshot is never deleted.
- **`showHostWorkingCopy`** shows a path under your working copy's root as the same
  path under `/mnt/host-working-copy`, whole path prefixes only. `planChat` applies it to a
  message's text when its thread works, or will work, in its own copy, so
  people and the model read the same stored text (ADR-0034).

# Offers (`offer.ts`, `offer-view.ts`, `review.ts`, ADR-0105)

A lane's work reaches you as an offer: one revision, or a stack, in your
repo. Its record is `OFFER` (`offer.ts`):

| record | namespace | key | written |
|---|---|---|---|
| a lane's offer in your repo | `pinetrie.offer` | the lane | when a trigger changed it, or it was accepted |

What the host decides about it is `offer.ts`'s, from the facts
`@pinetrie/repo` gathers, as decisions typed in `@pinetrie/core`
(`core/offers.ts`): `@pinetrie/repo` turns each into jj steps
(`offerEffects` and the rest), and the host connects the two, deciding
nothing itself. Where an offer starts (`startOfOffer`, `offerStart`) is
`@pinetrie/repo`'s. What the page reads is `offer-view.ts`, the review's wire
`review.ts`, the commit-message format `@pinetrie/core`'s `trailers.ts`
(`withTrailers`, `withoutTrailers`, `wipDescription`, `isWipLine`), and the
commit-message request `request.ts` (`describeRequest`).

## What the host decides (`offer.ts`)

- **`planRefresh`** decides what a trigger does (`RefreshDecision`), from
  `RefreshFacts`: for a placed lane, its place (`Placed`: tip, base,
  target, a known start), whether the lane's work changes any file
  (`WorkChanges`: `none`, `some` or `unknown`) and the offer as your repo
  holds it (`OfferInRepo`); for an untraced start or a thread whose root is
  archived (ADR-0061), the offer alone. Each decision carries what its
  steps need: `build` (none: never built,
  accepted, or gone), `rebuild` (the lane, or where the offer starts, moved under a single
  offer: rebuilt in place, ADR-0039), `withdraw` (where it starts reached the
  tip, the lane's work changes no file, its start is untraced and the host
  made it, or the thread is archived, edited or not), `forget` (no offer and none to build: a record left from one
  goes), `stale` (either moved under a stack), `refresh` (only
  the target moved), `leave` (you edited it), `repair` (a race left it
  divergent), `none`, or `untouched`: an untraced start with an offer you
  edited, or one divergent, which nothing touches until the lane catches up
  (a gap ADR-0067's untraced start leaves). Only work known to change a file, from a known
  start, is built (ADR-0067): one built from less would be empty, or bring
  back what you accepted, and withdrawn after a build it would be built again on
  the next poll. `unknown` keeps an offer that is there, and builds none. Where it starts is compared as a set
  (`sameStart`): a merge's parents come in any order. `rebuild` is not `update`, which is "update from
  my work" (`planUpdate`). An offer is edited (`offerEdited`) when its
  bottom's parent is not an ancestor of the target (S48 item 7), a commit of
  yours sits between its revisions, or any revision is edited
  (`revisionEdited`): a version an operation not the host's made changed it
  since the host's newest version (S73). A revision the host never made is
  yours. An offer you edit is never touched again, so nothing the host
  writes can hide your version. Moved (`offerMoved`) is its ledger against
  the lane's tip and start; an offer with no ledger reads as moved, and is
  rebuilt once. The record's `stale` uses the same rule.
- **`offerRecord`** is the record, the page's cache, from the offer as
  your repo holds it: its files and conflicts, your edits (its files that
  `@` changes), described (its first line no longer the WIP line), edited,
  stale (a stack whose lane moved past its ledger), its bookmark (as the
  gather found it) and its commits. **`planYourEdits`**: only `@` moved, so
  each record not yet accepted has its `yourEdits` rewritten from one
  shared read.
- **`planOfferAcceptance`** decides an acceptance from the offer
  read in its own command and what only an acceptance reads (`OfferAcceptanceFacts`: the WIP's commits above accepted work,
  and which bookmarks sit below the offer). Refused, in this order: no
  offer (`no_offer`), a WIP gone (`bad_destination`), nothing shown
  (`offer_changed`), a divergent offer (`no_offer`), other work than was
  shown or a new conflict (`offer_changed`, ADR-0065), and a destination
  that is not one of the offer's or not below it (`bad_destination`). Its
  destinations are `offerAcceptanceDestinations`': the thread's WIP, then accepted work,
  with how many of the WIP's commits land along. A conflicted offer never
  lands on accepted work: accepted work is immutable, and the conflict would stay in
  its history. A gone WIP has none. An untraced place can be accepted: an
  acceptance moves a bookmark and needs no start.
- **`planStackEnded`**: a split's stack replaces the offer only when its
  top has exactly the tip's files (`acceptStack`, private), built at the
  offer's place from the stack's own start and tip, which its ledger names;
  an untraced place accepts it. **`planRebuild`**, for squash and refresh,
  rebuilds from the lane's tip as one revision on its WIP line, from a known
  start only. Both are a `Rebuild`, as a build is, with the thread's name.
- **`describeWanted`** says an offer is one to ask a message for: one
  revision, not edited, on its WIP line unless asked again.
  **`planDescribeAsk`** names the commit to ask for; **`planDescribeSettle`**
  writes the answer only to that commit, read again in the command that
  writes it, keeping the offer's ledger (or the place's tip and start
  without one). **`planDescribeAgain`** refuses `describe` without a named
  offer.
- **`offerStatus`** decodes a `pinetrie.offer` record once (ADR-0067): `none`,
  `accepted`, `held` or `open`. Every reader on the page switches on it, never
  on the record's fields: the strip, the header's activity badge and the tab's Archive
  item (`openOffers`, client), and the review read (`planOfferRead`). An
  record not yet accepted, with no files, that you did not edit is `held`: its work is
  already where it sits, by a route the ledger does not record (S89), so
  nothing counts it, warns about it, reviews it or accepts it. One you edited
  is `open` whatever its files.
  The host's records not yet accepted, open or held, are `isNotYetAccepted`: the lanes it
  marks on a full observation, and the records `@` rewrites.
- **An offer's record is the page's cache** (ADR-0104): written from the
  repo after each of the host's steps, never read back to decide. Its
  `commits` are the revisions' commits at that read, what a review may
  read. A divergent offer is recorded only once repaired.

## What the page reads (`offer-view.ts`, `base.ts`)

- **`offerView`** is the work strip's states (ADR-0105) as a decision, from an
  `OfferStatus`: the offer's state, its buttons, its menu, which of those
  are `quiet` (listed, but changing nothing now), and the facts its words
  are made from (`OfferFacts`: files, size, conflicts, bookmark, held, the
  base as `effectiveBase` gives it, the catch-up, untraced, …). It writes
  no words: accepted work and the button labels are the client's (`offerWords`,
  `@pinetrie/interface`, ADR-0040). A resolution that asked for you counts only
  when newer than the offer. A held offer is `nothing`, with no
  destinations. When catching up `brings`, or the thread is untraced,
  catching up moves from the menu to the buttons; when it is `current` or
  `nothing-new` it stays in the menu, quiet; `unknown` leaves it there,
  enabled. An untraced thread offers no refresh, squash or split: each
  rebuilds from a start it does not have. A card with the command queued
  makes the offer busy (`catch-up`). A conflicted offer's catch-up is the
  base's `update` (there is no `resolve`), unless its conflict came with
  its copy (`conflictCause`) and the parent, ahead, holds none of those
  files conflicted: then `catch-up-parent`. While the parent is ahead,
  `catch-up-parent` is in every idle state's menu, quiet while it runs.
- **`conflictCause`** says where an offer's conflict comes from: `start`
  when every file it conflicts in is in its `startConflicts`, the files
  conflicted where it starts, so the conflict came with the lane's copy;
  else `work` (ADR-0072).
- **`parentNow`** (`base.ts`) is the thread a lane branched from, read from
  the document alone: `forkParent` (core) names it and the fork commit; its
  newest commit is the nearest above its thread's end; what the lane last
  caught up with (`caughtUpWith`) is the newest of the parent's commits that an update or land message
  below the lane's first prompt merged (`TranscriptMessage.merged`), else
  the fork commit. A lane's commits only move forward, so the parent is
  ahead when the two differ (`parentAhead`). `planParentUpdate` merges its
  newest commit, or nothing, or refuses `no_parent` and `parent_running`.
- **`catchUpOf`** (`base.ts`) says what catching up would do, from `pinetrie.base` and
  accepted work's record: `current` (the base has not moved since the lane last
  caught up with it, or no line is set up), `unknown` (it moved, and the
  host's `catchUp` was not read at the commit it is at now; or there is no
  `pinetrie.base` at all: the host has never read the lane, as for a lane
  whose turns never committed, so never reached your repo), `nothing-new`
  (it moved by work the lane holds, as after you accepted its own offer,
  even once the lane edited that work again: S102 item 11)
  or `brings`, with the file count and the move, the one kind that carries
  it. `catchUpOf` owns those checks; the commit comparison under them
  (`baseMoved`) is private to it.
- **`catchUpName`** (`catch-up-from.ts`) is the one wording of what a catch-up
  merges (`CatchUpFrom`): "accepted work" for accepted work (ADR-0090), the
  bookmark for a WIP (ADR-0061), the thread's name for the thread a thread branched from
  (ADR-0072). `updateLine` uses it through the update's `from`, stored as
  it is (`CatchUpFromSchema`). `incomingWords` names it for the model, and
  `baseMovedOn` says a base moved.

## The review's wire (`review.ts`)

- **The review's wire** (ADR-0047) is here, since the host and the page both
  import it:
  - Every read is of a span (`DiffSpan`, ADR-0106): a revision, or a range
    from one commit to another. `reviewUrl` and `diffUrl` build
    `/offer/<OFFER_WIRE>/review/<span>` and
    `/offer/<OFFER_WIRE>/diff/<span>?path=…`, the span as `spanKey` writes
    it, `<commit>` or `<from>..<to>`; `parseOfferPath` reads them back, and
    calls anything else under `/offer/` `bad`, another version included. An
    answer is cached as immutable under its URL, so a change to the
    templates (`REVISION_READ`, `RANGE_FILES`, `@pinetrie/lanes`), the schema
    or `fileDiff`'s flags bumps `OFFER_WIRE`.
  - `decodeRevisionReview` is the one schema: the host decodes jj's JSON
    with it, and the page the host's answer.
  - `planOfferRead` serves only a revision in an open offer's `commits`,
    or a range whose two commits one lane's `pinetrie.revision` records name
    (an ask's work), each read from the record, never the request; and it
    refuses an empty path or one with a control character.
    `answerReview` and `answerDiff` settle what was read: 502 when the
    read failed, 413 past `MAX_DIFF_BYTES`.

# Accepted work and a thread's base (`accepted.ts`, `base.ts`, ADR-0104, ADR-0061, ADR-0072)

| record | namespace | key | written |
|---|---|---|---|
| accepted work: its commit, the WIP bookmarks above it, the publish bookmark and your work against it (`yours.ahead`, `yours.catchUp`), and `publish.catchUp` (`catchUp`) | `pinetrie.accepted` | `line` | when your repo's operation head moves |
| a lane's base, as its newest `Pinetrie-Base` says it, whether a WIP base landed or is gone, what catching up would change and where that was read, and its untraced accepted-offer commits (S97) | `pinetrie.base` | the lane | when a refresh reads the lane |

- **`planAcceptedRecord`** is accepted work's record from what the host read
  (`AcceptedFacts`), beside what setting accepted work up would write to your
  repo's config, which `@pinetrie/repo` words (`setupProposal`: jj's config
  text), and `publish.catchUp` from accepted work's config (ADR-0099).
- **`planAcceptedAction`** decides a setup or publish from the record read in
  its own step (`AcceptedDecision`): setup writes exactly the heads and log the
  record proposed, the text you were shown; a publish (`PublishDecision`,
  ADR-0090) says whether the working copy catches up first (`catchUp`) and whether
  your commits move with accepted work (`accept`), both false with
  `publish.catchUp` off. `@pinetrie/repo` turns it into steps (`planSetup`,
  `planPublishCatchUp`, `planPublishMove`).
- **`planPublishFinish` is a publish's second round** (ADR-0090): from the
  record read again after the catch-up, the move, or the catch-up's
  operation reverted (`undo`, S111) when your commits came out conflicted
  (`yours.conflicts.commits`, which the preview of `@` alone cannot show)
  or the publish bookmark moved meanwhile. `accept` is read from the
  record after, not the decision. `publishUndone` words an undo from that
  record: the conflicts the catch-up would have left, since the revert took
  them away, so `acceptedRefusal`'s "your commits have conflicts" would be
  untrue. It lives here, not beside the steps,
  because `@pinetrie/repo` does not import this package.
- **`effectiveBase`**, **`catchUpOf`** and **`parentNow`** are in `base.ts`,
  with the `pinetrie.base` record; **`catchUpName`** (accepted work is
  "accepted work", ADR-0090) and **`baseMovedOn`** (a base that moved,
  worded once) in `catch-up-from.ts`. How the page reads them is under
  Offers, "What the page reads".
- **`acceptedActionState` is the one rule for a setup or publish** (ADR-0076,
  ADR-0090): the host's `planAcceptedAction` decides from it, and the page's
  publish button reads it. Setup and publishing are anyone's, on any host
  (ADR-0099); setup is refused only once accepted work exists. A publish is
  refused, in order: `no_line`, `no_publish`, `not_fast_forward`; with
  `publish.catchUp` on,
  `yours_conflict` (conflicted commits or files, or a preview that would
  conflict) and `refused` for files behind with no commit in common; then
  `refused` when `nothingToPublish(publishWork(record))`, the one "nothing
  to do", which the page's hidden button reads too. `acceptedRefusal` words
  each refusal once, naming files with `named`, for the host's answer and
  the button's title.
- **`pinetrie.accepted` and `pinetrie.base` are caches** (ADR-0104): the repo is
  the ledger, and the host rewrites each from it. A lost one costs a read.
  A `pinetrie.accepted` from before `publish` and `published` (ADR-0076), or
  before `yours.catchUp` and a numeric `yours.ahead` (ADR-0090), does not
  decode, and is read as unknown until the host writes it again.
  A `pinetrie.base` from before `catchUp` and `untraced` does not decode, and
  is dropped (ADR-0067): the page reads catching up as unknown until the
  host writes it again. `catchUp` names the lane tip and base commit it was
  read at; the host keeps it while both stay, so it is read once per move.
- **`planBegin`** refuses a lane with no line (`no_line`), and a base that
  is not a bookmark with the WIP prefix above accepted work (`bad_base`). The
  host checks it before the lane is created, so a refused send creates
  nothing.
- **What became of a WIP base** (`ok`, `landed` or `gone`, S77 item 2) is
  read in `@pinetrie/repo` (`wipState`, `readWipState`), since the gather
  needs it to know where an offer sits. **`planUpdateFrom`** then says what
  bringing a thread up to date merges, from the lane's `LaneBase`: the base
  the thread follows by `effectiveBase`, the rule the
  page's button words itself from, so the button names what is merged. A
  WIP's copy is made `on` the lane's previous copy (`LaneBase.start`);
  nothing when the lane already holds the WIP's commit. Accepted work once a WIP
  landed; refused (`base_gone`) for a gone WIP until "continue on the
  line", which `mark`s the move even with nothing to merge; refused
  (`no_line`) with no line. Only those two codes (`UpdateRefusal`).

# Thread names (`names.ts`, ADR-0039)

| record | namespace | key | written |
|---|---|---|---|
| a thread's name, `word-word` | `pinetrie.name` | the lane | once: when a column reserves the lane (ADR-0057), else at the host's start or before the lane's first run |

- **A name is two words**, from `ADJECTIVES` and `NOUNS`, 256 each,
  disjoint, lowercase, 3 to 7 letters: `amber-fox`. The unit test holds the
  lists to that.
- **`threadNameFor`** hashes the lane's id (FNV-1a, 32 bits) into the 65,536
  pairs and takes the next free one, wrapping. The hash spreads ids that
  differ only near their end, as uuidv7s made a minute apart do.
- **`planNames`** names every thread that has none, a lane's or a
  conversation's (ADR-0117), oldest first, each avoiding the stored names and
  those planned before it. The host runs it through one queue, at start and
  before a new lane's first run, so two threads never plan the same name.
- **`planReserve`** names a thread a column opened before it has a message
  (ADR-0057), as `planNames` would: `known` for an id with a name, `held`
  for one pi holds. So a name can have no lane yet: read names by lane
  (`readNames(doc).get(lane)`), never list them as threads.
- **A name is stored, never recomputed**, so a changed word list renames
  nothing, and never changes: the offer's bookmark and older trailers name
  it. The decoder accepts only `word-word`; `ThreadName` is branded in
  `@pinetrie/core`, and minted only here.

# Banners (`banner.ts`, ADR-0050, ADR-0053)

| record | namespace | key | written |
|---|---|---|---|
| a thread's column banner: the image's hash (ADR-0050, ADR-0053) | `pinetrie.banner` | the lane | when a banner is made or set |

- **`decodeBannerConfig`** reads the user config's `banner`: null unless
  `enabled` is `true`. `model` is `provider/id`, split at its first `/`,
  since OpenRouter's ids hold one. A malformed model takes `DEFAULT_BANNER`.
- **Two decisions, with no outcome in common.** `bannerDue`: a thread just
  named, or at its run's end, gets one only when it has none and none is
  being made. `planAsk`, for `set_banner`: a pasted image is used when
  stored, and anything else makes a new one.
- **`bannerStillWanted`**: a due one gives way to any banner written
  meanwhile. One the person asked for is always written.
- **`bannerPrompt`** fills the template's `{adjective}` and `{noun}` from
  the thread's name and puts the person's direction after it. A record written when banners had a crop still decodes: its `focus`
  is ignored.

# Pinned cards (`pinned.ts`, ADR-0048 step 5, S92)

A cards entry is a history message (`PINNED`), `customType: "pinetrie.pinned"`,
`display: false`: `content` is what the model reads, `details` the
`PinnedView` (`@pinetrie/core`) pine·trie reads back. `encodePinned`
and the total `decodePinned` are the only code that builds or reads it, and
`renderableMessage` makes it role `pinned`, which no projection draws.

- **It restates every card pinned now** and names, by its first line, each
  card the model had read that is no longer pinned ("No longer applies"), so
  the newest entry is all that holds. `pinnedContent` words it, each card
  under its owner's display name then. A card's `</card>` and
  `</pinned-cards>` are neutralised (`<\/card>`), so a card cannot close the
  block the model is told to trust.
- **What the model reads now is `pinnedInView`** (`@pinetrie/core`, beside
  `promptOf`): the newest cards entry on the path; at a compaction, the
  cards its retained tail carries, or none, since pi replaces what is above
  it. The host plans a run's entry from it, and the column shows each card's
  status from it.
- **`pinnedDiff` is the one comparison** of the cards pinned now with those
  in view: each card `read`, `changed` or `unread`, by id then text, what
  is retired, and whether the order changed. `planPinnedRead` is null when
  every card is read, none retired and the order the same; else the view to
  write. A branch's first run is the case where the path holds its parent's
  cards and the thread none, so they are all retired, with no rule of its
  own.
- **`pinnedReads`** is a thread's pinned cards as a run reads them, leaving
  out a card with no text yet: the host's plan and the column's statuses use
  it, so they agree on which cards count.
- **`PINNED_RULE`** is the line every agent thread's `<rules>` holds
  (`packages/pi`).

# What a run is told of its task (`canvas.ts`, `task-pinned.ts`, `context.ts`, ADR-0116)

- **`CONTEXT` is the table of context entries**, one row per kind (the
  canvas list, the task's pinned cards, the thread's pinned cards) with
  its decoder, its rule and what `ContextInView` carries of it, in the
  order a run writes them before its prompt: the thread's pinned cards
  last, so its entry stays the prompt's parent. `contextOf` reads a
  compaction's retained tail through it, and `CONTEXT_RULES` are the lines
  `packages/pi` puts in `<rules>`.
- **The canvas list** (`canvasList`): a line per card on the canvas, in
  its order, at most `CANVAS_CAP` (50), the rest counted. `planCanvasRead`
  writes it only when it differs from the newest on the path
  (`canvasInView`), so an unchanged canvas keeps the prompt's cache.
- **A card added or taken while a run goes on** is a fact line steered
  into the lane (`planCanvasFacts`, `encodeCanvasFact`), never a queued fact
  card, which the drain would pop only after the run. Reorders and widths
  wait for the next run's list.
- **Cards pinned to the task** (`task-pinned` places, `taskPinnedOf`) are
  an entry of their own (`pinetrie.task-pinned`), compared as a thread's
  pinned cards are, so a thread's cards entry keeps its shape.

# History messages (`history.ts`)

The host's own messages in a thread (update, stack, land, fact, behind,
carry-on, pinned) are pi `CustomMessage`s: `content` is what the model
reads, `details` what pine·trie reads back.

- **History stores the code's own values.** A message's `details` are the
  code's type as it is now, and `historyMessage(customType, schema)` gives
  each kind its `encode` and `decode`: encoding stores the value, and
  decoding is the schema's check alone. History is never rewritten, so a
  message stored before its shape changed does not decode: the column
  leaves it out (core's `renderableMessage` drops a `custom` message it was
  not given a role for), and the model still reads its `content`. Its
  `merged` or `behind.to` no longer counts either, so a lane may hear its
  base's news once more (`baseKnown`), and a branch read its parent as
  ahead (`parentNow`) until the parent commits again.
- **The schema is the type.** Ids are branded schemas (`decode.ts`:
  `ThreadIdSchema`, `WriterIdSchema`, `CommitSchema`, `ThreadNameSchema`,
  `CardIdSchema`), whose `Static` is the brand, and `List` an array whose
  `Static` is `readonly`. A lane is checked with core's `THREAD_PATTERN`, the
  pattern `isThreadId` tests, so no decoder checks a lane by hand.
- **Every kind is held to it** (`history.test.ts`): `MESSAGE_SPECS` must
  list every spec a module here exports, and each round-trips a sample and
  renders in its role.

# Updates and stacks (`update.ts`, `stack.ts`, ADR-0105)

Two history messages, as is the carry-on message (`stop.ts`, above). An
update (`pinetrie.update`,
role `update`) is a fact in the thread, never a prompt: which of your commits
came in and which files changed, so the agent's next run reads them again,
or that none did. A merge that changed no file is still an update: the
`merged` commit it carries is how `parentNow` knows what the lane caught up
with, and its revision is where a branch below it starts. `incomingWords`
words whose work came in, for the update and for a resolution's prompt.
The card that brought the thread up to date carries what the person wants
done with it (ADR-0108); its text is sent after the update. A stack message (`pinetrie.stack`, role `stack`) is the prompt of the run that
splits an offer: the `offer-stack` skill, the commit the stack starts from,
the tip it must match, and the bookmark to leave on it.

# Facts, base news and agent commands (`fact.ts`, `behind.ts`, `agent-commands.ts`, ADR-0080)

- **A fact is a history message** (`pinetrie.fact`, role `fact`): `content` is what the model reads, `details` the
  `OfferFact`, which the column words as one line (`factLine`). Each offer
  action has one: an acceptance (`acceptedFact`: the change, the
  bookmark, and that bookmark as the thread knows it, accepted work or a WIP),
  and a description asked for again, a squash, a refresh (`actionFact`).
- **A fact always reaches the thread through a fact card** (`planFactCard`,
  ADR-0126): a card of its own kind (`x-` id, `FactCard`), only ever
  queued, made by the host for whoever acted, after the cards there; popped
  in order with the others: at once on an idle lane, when the run ends on a
  running one. It is never written into a running lane. It has no text
  document: the drain loads and destroys none for it.
- **The drain plans before it acts** (`planCarry`, `queue.ts`): a fact, a
  catch-up and what follows it (`after`: the text, or nothing), a split
  with its brief, or a message; every case but a fact carries the text
  card (`QueuedText`), so the shell acts on a typed card. A property named
  `then` is forbidden by the linter, hence `after`.
- **`planBaseNews` is one decision** for a lane whose base has new work:
  `tell` (a behind entry, `pinetrie.behind`, before the run's prompt and its
  cards entry, or a steer into a running lane), `catch-up` (a lane whose
  work changes no file, `BaseRecord.work`, is caught up quietly before a
  chat's run: `planChat`'s `catch-up-first`), or `nothing`. What the thread
  already heard of or merged is read from the tree (`baseKnown`, core), so
  a commit is told once, and again only past a compaction.
- **`planCatchUpCall`** decides `catch_up` from the documents before
  anything is queued: a lane of its own, the only call in its turn, and new
  work (`brings`, or `unknown`, which the merge's own read decides). The
  parent only when it is ahead and idle. `planCopyReady` refuses a working
  copy off its lane's line (`off-line`), and a repo with no bookmark of the
  lane's (`no-bookmark`), for every catch-up. The two are worded apart: the
  missing bookmark was the rename's, not a split's (S114). Each refusal
  says what to do (`catchUpRefusal`); `catchUpAnswer` is the tool's result,
  whose `details.merged` the turn's record reads.
- **`planSplitCall`** queues a split card, made through `planMake`, or
  refuses: no offer open, a split running (the lane's latest prompt is a
  stack message), or one already queued. The tool answers `SPLIT_QUEUED`,
  or the refusal (`splitRefusal`); a refusal of its card's make (`unmade`,
  which none is) is logged and answered `SPLIT_UNMADE`.

# The resolution's prompt (`land.ts`, ADR-0033)

A land message is a pi `CustomMessage`, `customType: "pinetrie.land"`, like a
chat. Its `content` is what the model reads: the resolution skill, then each
conflicted file with its markers and both sides, labelled `ours` (the lane)
and `theirs` (what comes in), each with why it changed the file. Its `details`
are what the column shows: `landLine`'s one line, from the file count.
`renderableMessage` makes it role `land` with that line, so the column shows the
line, never the prompt.

`planResolution` builds it, within a `PromptBudget` in pi's tokens
(ADR-0084, S106): `LAND_BUDGET` (`packages/pi/compaction.ts`), the
`keepRecentTokens` every lane's harness runs with, measured with pi's
`estimateTokens`. A prompt within it is kept whole when pi compacts.

- **The whole message is measured**, never its parts: each candidate is
  rendered and estimated, and the fullest that fits is returned.
- **The files show one way for every file** (`ConflictShown`): `whole`, by
  their conflict sections (`conflictSections`, each headed by its lines),
  by name, or as a `count`. The way is the fullest that fits with each
  side's newest reason; then each side keeps its newest `k` reasons, the
  most that fit, the older counted by `leftOut`. The code gives way before
  the reasons, since the agent can read the files in its lane again.
- **The floor is made before the merge** (`resolutionFloor`): the `count`
  message, from the skill, the person's text and whose work came in. It
  states no number of files, so the message measured before the merge is
  the one `planResolution` returns when nothing fuller fits. Only
  `resolutionFloor` makes a `Floor`, and `planResolution` requires one, so
  it always has a message within the budget. A floor too large is the
  host's refusal (`planCatchUp`), with the lane untouched.
- **`jj resolve --list` is the list of what is left**, and every prompt says
  so: a file not shown whole is read in the lane.
- In every way but the `count`, each file keeps its path and both labelled
  sides (ADR-0010); the `count` lists no file.

The skill's path and a hash of its content are recorded, so a
surprising resolution can be traced to the policy that produced it.

Gotchas:
- jj's markers are longer than seven characters when a file holds lines
  that look like them; a section closes only at a `>` marker as long as its
  `<`.
- A conflict with a deletion is one section the size of the surviving file.
- pi never compacts the newest message, so this budget is the only guard on
  the prompt's size.

- **`planResolution`**'s prompt names the project's work, and ends with the
  card's text, whole, under its own heading (ADR-0108).
- **A resolution has no record** (ADR-0080, S104): in progress, it is a
  running lane whose prompt is a land message; ended, it ended as any run
  does. What it left conflicted is the offer's, and whether the agent asked
  for you is its newest `ask_about_conflict` in the tree
  (`conflictAskedAt`, core), which the strip reads as "needs you" while it
  is newer than the offer's record.

# Agents talking (`relay.ts`, `budget.ts`, `round.ts`, ADR-0128)

Another thread's agent, invited into a thread, is asked there and answers
from its own thread. Who a message invites and asks is `address`
(`@pinetrie/core`), and the chat stores both (`ChatDetails.asks`,
`invites`, absent when none); members, what an agent has heard and whether
a round is done are read from the path (`threadMembers`, `lastHeardEntry`,
`isRoundAnswered`, core). Nothing about them is stored beside the entries.

- **Three history messages.** `pinetrie.heard` (role `heard`, a one-line
  message): what an asked agent was told of the thread that asked, its text
  frozen in `content`, the source ids in `details`. `pinetrie.relay` (role
  `relay`): the ask, the asked agent's prompt, carrying where it came from,
  its asker, its chain's budget and the person behind it (`by`).
  `pinetrie.answer` (role `answer`): the asked agent's last message, in the
  asking thread, a prompt when it `wakes` its asker. Both are prompts
  (`PROMPT_ROLES`), so each is an ask; `transcriptLines` speaks them by
  asker and by thread.
- **`planDelivery`** (`chat.ts`) is the one table of where a message into a
  thread goes by its lane's state; `planChat` and the host's relays and
  answers plan with it. Only an answer that wakes `steers` into a running
  lane; one that wakes nobody waits for the run's end.
- **`planRelay`** hears the asking thread's path after the newest entry
  `lastHeardEntry` names, or from the message that invited it, never the ask
  itself nor the asked agent's own answers; it refuses a non-member, a
  thread with no lane, itself and a spent budget (`relayRefusalText`).
- **`planAnswer`** wakes the asker only when an agent asked and the budget
  is not spent; a stopped or failed run sends no answer, and the asking
  thread is told by an `unanswered` fact.
- **An ask card** is a card of its own kind (`KINDS.ask`, `a-` id), only
  ever queued, made by the host for the person behind the chain
  (`planAskCard`). Its relay is stored as JSON in the row's `fact` string,
  as a fact card's fact is, so no field was added. A held queue holds it;
  nobody moves it, but it may be reordered. The drain carries it as a relay
  (`planCarry`).
- **A budget** (`BUDGET`, keyed by the person's message that set it) holds
  its limit, its count as of the last write, and `over`. `planSpend`
  counts, and returns the record to write only when a spend crosses the
  limit; `mayRequest` reads it. The user config's
  `agents.budget` is `decodeAgentsConfig`'s.
- **Facts**: `dismissed` and `left` (a member gone, read by `threadMembers`),
  `unanswered`, `round` (what the round told the people) and
  `budget-spent`; a stop the budget made names it (`StopFact.budget`) and
  holds no queue (`planStop`).
- **Reach** (`reach.ts`): `threadReach` is the one reader of where a
  thread is (open, archived with its record, held by whom, gone), and
  `reachableAgents` every named thread on an open task's canvas.
  `reachWords` and `awayWords` say why one is out of reach.
  `unreachableRefusal` refuses an ask whose either thread is out of reach,
  first in `planRelay`; `planAnswer` makes an answer to an asker out of
  reach `undelivered`, a fact in the answering thread, worded without
  naming anyone, since a fact's words are fixed when it is written.
- **The round** (`round.ts`): `roundRequest` is the `agents-round` skill,
  the members and the thread's newest lines; `roundReplyOf` reads
  `nothing`, `ask <member>: <text>` or `people: <line>`, and anything else
  as nothing (ADR-0067).

# Participants (`participant.ts`)

A session is its participants (ADR-0021). A `pinetrie.participant` value is a
name, a bare string, keyed by writer id (`PARTICIPANT`, read as
`ParticipantRecord { writer, name }`), which is `w-<email>` (ADR-0037); `displayName` gives an
unnamed writer their email's part before the `@`, which the screen shows and
a mention reaches (`normalizeEmail` requires a letter or digit there); `participants` lists every named writer and every writer in
the tree, sorted, which is what a mention resolves against.

A person's picture (ADR-0098) is a record of its own, `pinetrie.picture`
(`PICTURE`, read as `PictureRecord { writer, sha256 }`): the blob's SHA-256
alone, so a rename never rewrites it, and contents that are not a SHA-256
are malformed. `planPicture` decides a `picture` command from the blob
store's reference, read without the bytes: `null` clears, a blob the store
does not hold is refused (`IMAGE_MISSING`), one wider or taller than
`PICTURE_MOST` (512) is fitted, and the rest is set. The size is never a
refusal: the host fits any client's picture. `pictureWrites` is the one
writer of the record.
