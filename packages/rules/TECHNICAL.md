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

Where a rule lives, as `@pinetrie/core` and `@pinetrie/jj` state it too:

> Core holds the vocabulary (ids, intents, every record's type) and the
> reads of the tree. A format or type that `lanes` or `jj` must read,
> write or name lives in core too, since neither can declare
> `@pinetrie/rules`. What a stored shape says, and how the host changes it,
> is `@pinetrie/rules`', whoever reads it. One client's own in-flight state
> (its moves, held roots, slot repair, commands out) is
> `@pinetrie/session`'s. What a person sees and can do, and its words, is
> `@pinetrie/interface`'s, for any client; how the page draws it is
> `@pinetrie/web`'s (ADR-0093).

So `planStop` is here beside `STOP`, and `agentByDefault` beside
`addressMessage`; `address`, `parseMentions` and `moveOf`, which know no
record, are core's; the trailer format and the proposed changes' facts and decisions
are core's (`trailers.ts`, `proposed.ts`), since `@pinetrie/jj` reads them.

## Where things are

`index.ts` exports, by name, only what another package imports; its groups
follow this list. A name only this package uses is imported from its module.

- `records.ts`, `specs.ts`, `decode.ts`: `RecordSpec`, the writes it builds
  and every spec (`RECORD_SPECS`); the
  total decoders and key readers every module uses.
- `config.ts`: `modelRef`, the parser a model setting's kind wraps; the
  config's files are `@pinetrie/config`'s, and the host declares every
  setting. `request.ts`: what fits a model request's budget.
- `message.ts`, `participant.ts`, `shares.ts`, `commands.ts`: a person's
  message, who is in the session, the files a message shares, and `/`
  commands (`pinetrie.commands`).
- `history.ts`: the history message builder (`historyMessage`), whose spec
  each kind of host message in a thread is (below).
- `land.ts`, `update.ts`, `stack.ts`, `pinned.ts`: the resolution's prompt,
  the update and stack messages, the pinned cards a run reads.
- `markdown.ts`: `parseMarkdown`, the one mdast parse every reader of a
  message's markdown here uses (`shares.ts`, `blocks.ts`, `links.ts`).
- `card-words.ts`: `wordsOf`, what a card says from where its kind keeps
  its words (`textSourceOf`).
- `fact.ts`, `behind.ts`, `agent-commands.ts`: what a command on proposed changes
  did, as a fact in the thread; the base's new work, told or caught up; the
  agent's `catch_up` and `split_proposed_changes` (ADR-0080).
- `live.ts`: what each stream event, and a run's end and a host's start, do
  to `pinetrie:live`, as `LiveOp`s `@pinetrie/schema`'s `applyLiveOps` writes
  (`packages/schema/TECHNICAL.md`, Streams; ADR-0014, ADR-0107). A stream
  stays until its entry is written, which is before the next reply's request
  and by the run's end (S55); a reply's own entry moves its lane's tip in the
  commit that writes it (S35).
- `card.ts`, `notes.ts`, `queue.ts`, `moves.ts`, `in-place.ts`,
  `move-history.ts`: a card's record, where it is and the sweep; note
  columns and where a card leaving a thread goes; the queue's pops and
  carries; handoffs and their targets; reorders, a card's width and its
  command; each sender's history of moves and its undo.
- `rank.ts`: a rank on a canvas, a drop's, and where a branch lands.
- `held.ts`, `copy.ts`: a thread in an inventory (where a command runs,
  who holds it, what a change takes) and a thread copied (ADR-0117,
  ADR-0124).
- `gate.ts`: the gate: what a command, or a send made for one, may do
  now, and its one pass (`Cleared`).
- `queue-hold.ts`, `seat.ts`, `startup.ts`: a held queue, who wrote in a
  text, what a starting host resumes.
- `board.ts`, `archive.ts`, `order.ts`: the board's workflow states and
  each root's place, what crossing the archive's edge does, and order
  keys (a queue's, the pinned cards' and the board's).
- `roots.ts`, `mark.ts`, `title.ts`, `stop.ts`, `digest.ts`, `verdict.ts`:
  the directory of roots, titles, who stopped a run and carrying on after
  it, an ask's digest, and how a thread's last run ended.
- `names.ts`, `banner.ts`: a thread's name and its banner, each with its
  record; `banner.ts` also holds the icon source (`icons.source`) and its
  published record.
- `work.ts`: where lanes work (`pinetrie.lane`, `pinetrie.revision`,
  `pinetrie.project`).
- `accepted.ts`: accepted work (`pinetrie.accepted`): its record, setup and
  publishing.
- `base.ts`: a thread's base (`pinetrie.base`): where a lane begins, what
  catching up would do and merge, and the thread a lane branched from.
- `catch-up-from.ts`: what a catch-up merges (`CatchUpFrom`), as history
  stores it and as every wording names it.
- `proposed.ts`, `work-strip.ts`, `review.ts`: proposed changes' record and the
  host's decisions about it, the page's view of it, and the review's wire.
- `ignores.ts`, its own export (`@pinetrie/rules/ignores`, which the page
  never imports): whether a project's `.gitignore` files ignore a path,
  with no repo (`ignoredPaths`, below).

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
cannot reach the wrong document and needs no guard at run time. The home is
in the write's type too, `ValueWrite<H>` (`@pinetrie/core`): the host's
port that modules get at startup takes `ValueWrite<"session">` alone, so a
root's record is written only through a step's documents (ADR-0162).
`records.test.ts` lists every spec's home.

- **`ROOT`** (`roots.ts`): a root's directory record, keyed by its `RootId`:
  its root entry, first line, title, counts, writers, each thread's writers
  on its path (`threads`, its followers, ADR-0077), the sends that name
  someone, and its images. The host writes it from `readRootRecord`.
  Each mention names its thread (`threadAt`), so the inbox reads its canvas.
  `ROOT` is `derived`: built from the root's document alone, so a record
  that does not decode in this build's shape is rebuilt at a host's start
  (`host/directory.ts`, `planRebuild`), never migrated. The host refreshes
  it whenever the root's document changes, so it lags a running turn by one
  step of the host's queue.
- **`VERDICT`** (`verdict.ts`, ADR-0077): a thread's last run's verdict,
  keyed by lane, in the session: the run's prompt and last entry, and what
  happened (pending, said, failed, stopped, unclassified), never a level,
  which each client decides for its person.
- **`LANE`** is written for every lane as it is created, naming its root;
  `work` is null for a lane with no work of its own.
- **`WORKFLOW`** (`board.ts`, ADR-0122): the session's workflow states, a
  singleton. A canvas is a card on the board (ADR-0126): no record says
  where it is, who opened it or when; its card and its card's history do.
- **`ACCESS`** (`access.ts`, ADR-0140): a lane's ssh identities, keyed by
  lane, in the session: its use of its owner's (waiting, approved,
  refused, unanswered), and the service identities and hosts it used, each
  name once. `ACCESS_ANSWERS` is what the owner may answer from each state:
  `planAccessAnswer` refuses any other, and the page offers exactly these.
  `planAccessChange` says what a change does to a held signature (release,
  refuse, or cut), and `planAccessRecovery` what a starting host leaves
  (nothing waiting). The owner is the project record's (`PROJECT`'s
  `owner`), never a lane's.
- **`QUEUE_HOLD`** (`queue-hold.ts`, ADR-0048 step 7): a thread's queue
  held, keyed by lane, in the session: who held it and when.
- **`STATE`** and **`CONFLICT`** (`folder-records.ts`, ADR-0142): a folder
  project's history, in the session. `STATE` is each state keyed by its
  snapshot's name, with its parents, how it was made, when and by whom;
  `@pinetrie/folder` decides which may be recorded, and none is ever
  deleted, since merge bases walk every state's parents. `CONFLICT` is
  each path a merge into a lane left conflicted, keyed by its lane and
  then its path (`conflictKey`; a lane's id holds no `:`, so the first
  ends it), with the states of its base, ours and theirs.
- **The archive gate** reads the canvases a command writes in (`writesIn`) and
  looks each up among the archived (`archivedIn`, over `archivedOf`): a
  command carries its canvases, or its places and cards, which the
  `CanvasIndex` maps to canvases, so no root's document is opened to check.

Each host record is one `RecordSpec<R, K>`: its `namespace`, `keyOf`,
`encode` and `decode`, exported beside its type (`MARK` in `mark.ts`,
`PROPOSED_CHANGES` in `proposed.ts`). Everything else goes through the spec:
`setRecord` and `deleteRecord` build the `ValueWrite`s the host writes
(`Records.writeValues`, ADR-0095), grouped by document with `byTarget`;
`recordsIn` decodes a namespace as stored, which `readRecords` in
`@pinetrie/reads` reads from the document; `setIfChanged` writes only a
record that changed. `RECORD_SPECS` (`specs.ts`) lists every spec, its
address and decoder, for a check over every record, as a migration's
(ADR-0096); a test fails when a spec is left out of it. A starting host
deletes every record whose namespace no spec declares, or that is stored
outside its spec's home (`planUndeclaredSweep`, ADR-0100), so a renamed,
retired or rehomed record type leaves nothing behind.

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
  order than the planner that made the new record (`PROPOSED_CHANGES` rebuilds field
  by field), and comparing `JSON.stringify` strings would then rewrite an
  unchanged record on every check. The host writes only a changed record: a
  write compacted with no client connected moves the document's base past
  what a new client reports.
- **The singletons** (`ACCEPTED`, `PROJECT`, `COMMANDS`, `ICONS`, `WORKFLOW`)
  have one fixed key (`ACCEPTED_KEY`, `PROJECT_KEY`, `COMMANDS_KEY`,
  `ICONS_KEY`, `WORKFLOW_KEY`), and
  `decode` refuses any other.

# A person's message (`message.ts`)

A human message is a pi `CustomMessage`, `customType: "pinetrie.chat"`
(ADR-0018), not a custom entry, so the host can append one to a lane without
a run (S19).
`content` is the attributed text the model reads ("Alice: …"); `details` hold
the author (a `WriterId`, from the transport), the display name as written, the
text, and the `Responder` it compels. `encodeMessage` and the total `decodeMessage`
are the only code that builds or reads the shape.

- **Mentions are read once** (`mentionSpans`, core): what is sent
  (`parseMentions`) and what the composer completes at the caret
  (`typedMention`) are both its spans, so a list never opens where a send
  would read no mention.
- **A mention in code is no mention** (`withoutCode`, core, ADR-0128):
  inline code spans and fenced blocks are blanked first.
  A four-space indented block is not: a line scan cannot tell it from a
  paragraph's continuation.
- **Who a message is for is `address`** (`@pinetrie/core`, ADR-0021): `@agent`
  asks the agent; a message naming only participants is for them; with no
  mention that resolves, the thread decides (`agentByDefault`: the agent where
  the thread has a lane, and never by a lane's default for a `branch`, which
  is a new thread; a thread with no lane asks only through `@agent`, which a
  new thread's composer starts with, ADR-0164). A handle resolves
  by `mentionTargets`, which the composer's list is drawn from, so it offers
  only what a send would reach: a handle names one target, another thread's
  agent before a person and, of two people sharing one (ADR-0037), the later
  in `participants`. Only `@agent` as typed names the agent. People are
  `participants`: every named writer and every writer in the tree,
  the unnamed by their email's part before the `@` (ADR-0037), through
  `handleOf`: letters and digits in
  any script, `_` and `-`, lower-cased and composed (NFC), so "José" typed
  either way is `@josé`. An unknown handle (`@types/node`) is ignored, so it
  never silences the agent; `normalizeName` refuses a name with no handle, or
  the handle `agent`.
- **`addressMessage` is the one rule for who a chat is for:** `address` with
  `agentByDefault`, and a command for the agent whoever else it names
  (ADR-0036), keeping the people it names. `planMessage` runs it on the host, and
  the composer's `planSend` (`packages/interface/send.ts`) runs it before a send,
  so the button's promise and the host's decision cannot drift apart.
- **`planMessage` decides what a message does** (ADR-0120), over the thread
  `threadOfSend` (core) gives for where it goes (`SendAt`), and names
  exactly where to write:

  | a message… | no lane | idle lane | busy lane (running, cards queued, or its queue held: `sendWaits`) |
  |---|---|---|---|
  | plain | `appendToTree` at the end | `appendToLane` | `busy` |
  | compelled `reply`, not raced | `createAndRun` at the end | `run` | `conflict` |
  | compelled `reply`, raced | `conflict` | `conflict` | `conflict` |
  | `queue` (the host's pop) | as `reply` | as `reply` | as `reply` when only cards are queued; `busy` while it runs |

  `busy` writes nothing, since a lane is never written while it runs (S21):
  the dispatcher queues the chat's card in the same step, and answers `queued` (ADR-0059).
  `queue` is the host's own mode (`PlanMode`; a client sends a `SendMode`), for a card it pops, which heads the queue
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
  column, from the commit that writes it. Every `MessageDecision` that writes
  names its thread once, as `thread`: the one the send continues, or the
  one a branch starts. A chat stores no `starts`. The host writes the
  thread's record (`THREAD`, `thread.ts`: its root, who started it, when,
  and a copy's fork) just before a branch's first message, then names it.
- **Each chat stores its send's id** (`sendId`, the command's id), so the
  column that sent it finds it exactly (`TreeIndex.bySend`).
  `detailsFromStored` is the one conversion of stored details.
- **`renderableMessage`** turns a stored person's message (`MESSAGE_TYPE`,
  `pinetrie.message`) into role `person` with its author
  and whether it compelled the agent, for `core`'s projections, which only
  admit the role and so need no schema library.
- **A chat's images are references** (ADR-0042). `details.images` lists an
  `ImageRef` (hash, type, size) for each `/blob/` image its text shows, in
  order: the host fills it when the message is sent. `content` stays the attributed text, so no image's bytes are stored.
  `withMessageImages` is what the model reads: each chat with images gets
  `[text, ...image parts]`, from base64 the caller gathered
  (`messageImageShas` says which), with a missing blob named as text.
  `packages/pi` runs it in pi's `toProviderMessages`. It takes base64, not
  bytes, because this package ships to the browser.
- **Names are labels, never identities** (`participant.ts`). The name is copied
  into each message, so a rename never rewrites what the agent already read,
  nor invalidates the provider's prompt cache.

# Shares (`shares.ts`, ADR-0042, ADR-0151)

- **`textBlobs` is which blobs a text shares**: `image` and `link` nodes,
  and their reference forms resolved through the text's definitions (the
  first definition of an identifier wins), whose URL `blobOfUrl` accepts:
  exactly `/blob/<64 lower-case hex>`. In order, each once, with the name
  its alt text or link text gives it. It parses with `parseMarkdown`
  (`markdown.ts`): `mdast-util-from-markdown` and the GFM extensions, the
  packages under the client's remark-parse and remark-gfm at the same
  versions (`workspace.test.ts`), so the host and the drawing read one
  tree. A link in code is text.
- **`shareMarkdown` is the one writer of a share's link**: `![name](url)`
  for an image, `[name](url)` for anything else, the name on one line with
  its brackets and backslashes escaped. A test reads back every written
  link, for any name.
- **`planShares`** turns the named blobs and what the store holds of each
  (`StoredShare`: ref, size, fitted copy, location) into a message's
  `shared`, and its `images`, each image's `shown`: the original when it
  fitted, else its copy. A blob not stored refuses the message with
  `ERR.IMAGE_MISSING`. The host gathers first; the decision is pure.
- **A text share is quoted or described** (`shareQuote`): quoted whole up
  to the host's `shares.quoteBytes`, else described by size and lines with
  a pointer to `save_blob`, as is an opaque one (`shareQuoteMarkdown`). A
  quote's fence is one backtick longer than the longest run in the file
  (`fenceFor`), so no file can close it. `withQuotes` heads it `Shared:`.
- **A fitted image is read with a line before it** (`fittedLine`, in
  `withMessageImages`): the original's size and the scale back to it.
- **`isUtf8Text` and `hasLocation` read bytes**: text is valid UTF-8 with
  no NUL, its byte-order mark kept; a location is a GPS latitude in any
  embedded EXIF TIFF structure, which JPEG, PNG, WebP and HEIC each embed as
  it is, or XMP's `GPSLatitude` (S213). No `Buffer`: the page imports this.
- **`readableBlobs` is what a thread's path showed its model**: every
  `/blob/<sha256>` in its messages' text, read as raw text (a cards entry
  wraps each card in tags a markdown parser takes for HTML), and every
  stored image part. `planSaveBlob` saves only what it holds, typed so it
  cannot be called without it (`ReadableBlobs`).

# Commands (`commands.ts`, ADR-0036)

- **The syntax is pi's, qualified by package:** `/<package>:<name>` for a
  prompt template, `/<package>:skill:<name>` for a skill. `parseCommand`
  reads the first word: two `:`-separated parts is a prompt, three with
  `skill` in the middle a skill; anything else is text, `/etc/hosts`
  included.
- **`labelCommands`** gives each package its label: `commands.names`' rename
  (keyed by the command's source: a listed package's path), else
  `pinetrie`, else `plugin.json`'s name, else the unscoped package name,
  else the layer that listed its folder. `isCommandLabel` is what a rename
  may be. Two sources with one label are
  refused together, as are two commands with one full name in one package.
- **`expandSkill`** is pi's block, byte for byte. **`resolveCommand`** is an
  exact match.
- **A command message** keeps `details.text` as typed and `details.command`
  (`CommandRef`: name, kind, file, hash, expansion). `attributed` reads the
  expansion, so the model reads what the command meant when it was sent. `planMessage` makes a command compel
  the agent, and refuses an unknown one (`ERR.UNKNOWN_COMMAND`).
- **`pinetrie.commands`** is a host-written record of every command's summary,
  for the composer's completion. `setIfChanged` is how the host writes a
  record at start only when it changed.

# Runs and startup (`message.ts`, `startup.ts`)

- **`settleRun`** (`message.ts`): a compelled message pi refuses to run is kept,
  appended with no reply, rather than lost; the author already heard
  `started`.
- **`planStartup`** (`startup.ts`): a starting host resumes every lane a
  crash interrupted, before anything queued for it, since it holds its
  operation open (S36); its run's end then drains it. It drains every other
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
  (`card-words.ts`) reads it: the drain's pop and the pinned cards a run reads
  (`pinnedReads`) gather through it, so no reader branches on kind.
- **What may be where is read from `PLACES_OF`, never listed by hand.**
  `hasPlaceKind(card, place)` (a `CardInPlace<P>`: every kind `KINDS` puts
  at `P`, its place narrowed) is how the queue (`queuedOn`), the canvas
  (`isCardOnCanvas`) and a margin (`marginCards`) find their cards;
  `cardFitsPlace(card, place)` is whether its kind is ever there (the
  page's take and put into an inventory); and
  `isMovable(card)` is `KINDS`' `moves`. A kind added to a place's row is
  queued, taken or put there with no other change. A test of what a kind
  *is* (a fact's row in the dock) still reads its kind.
- **A card's id is built from `KINDS`** (`cardIdOfKind(kind, uuid)`, core's
  `index.ts`): its prefix and the rest, typed by `IdOf<K>`. `parseCardId`'s
  pattern is built from the same prefixes, so a kind's id parses as soon
  as its row has one. Each kind keeps its own brand (`NoteColumnId`,
  `FactCardId`, …).
- **An address names a thread, an entry, a block, a range or a card**
  (core's `address.ts`, ADR-0126): one codec, `printAddress` and
  `parseAddress`, total, for the record, the wire, the pane and links in
  text (`/a/<address>`, `addressLink`, `addressLinks`). An entry names its
  thread, so it resolves without a walk. A block is numbered once
  (`blocks.ts`: `numberBlocks`, `blocksOf`, `blockSource`), the walk the
  page draws by too; a past address's markdown is `pastMarkdown`.
- **A reference is a card holding an address** (`ReferenceCard`, `q-`
  ids): its content is the address and its quote's blob, so it draws
  without loading the referent's root. It is a note, a comment, queued, in
  an inventory, or discarded; never pinned, since the readers of pinned
  cards read no quote. Queued, it is a message (`QueuedMessage`,
  `isQueuedMessage`): the drain reads its quote's blob before the pop
  (`queuedQuotes`, `wordsOf`'s `blob` reader) and sends it as its queuer's;
  one whose quote reads empty (its blob missing) is skipped, not sent
  (`planCarry`'s `skip`); a Stop holds the queue for it, and unqueue all
  takes it back. A put moves it, as any card (ADR-0132). It is made by a
  paste (`planPaste`, the host's `paste`, through `planMake`), in its
  paster's history. *Edit as text* is a paste too: a `text` paste replacing
  the reference, in its very place, its `origin` the address, the reference
  to the trash first, undone whole. A text card's `origin` is stored
  printed ("" for none).
- **`planPaste`** (ADR-0132, ADR-0133) plans one paste as one step: the
  card it replaces (`Replacing`: a slot's card, a reference edited as text)
  discarded first, so a replacement into a full inventory never meets
  `full`, then a new text card or reference made through `planMake` (in
  the replaced card's very place when the target is its place), or a cut
  card moved out of a trash by its cutter (`planFromTrash`'s `uncut`). "The replaced
  card is discarded first" holds in two places: here, for a paste, and in
  the client's `moveCards` set for a drop on a filled slot, which
  `planMoves` plans in order.
- **One rule makes every card** (`planMake`, `moves.ts`): it takes a card
  already made (`makeCard`, whose place type is its kind's, so a misplaced
  card does not compile) and refuses `exists`, then as any move into its
  place is (`refuseInto`). Its sender is a person, or `"host"` for the
  kinds no person moves (a fact), refused only by a full inventory. A
  person's creation (`planMove` with no `from`), a thread's card as it
  opens (`planThreadOpen`: a branch, a new canvas's thread, a copy, a spin-off, or a
  branch's first send that names no thread opened yet), a note column made
  for a note (`toNotes`), a fact's card (`planFactCard`) and a split's card
  (`planSplitCall`) all go through it, each made by the person it names. A refusal of the host's own make is a value the host's
  shell logs, never a silent write; none is refused today.

- **The stored record is flat strings**, "" for none (`encodeCard`,
  `decodeCard`, total): its place's fields and its content's. A kind's
  content columns are one table (`CARD_CODEC`, a row per kind with
  records, so a kind without one does not compile): the columns it holds,
  and their codec. A row holding a column of another kind's is refused by
  comparing with the codec's own columns, and a decoded card needs no
  cast (`kindedId` gives the id its kind's type). A text card holds its
  `command`, `unsent` and `origin`; a reference its `address` and `quote`;
  a fact its `fact`; an ask its `relay` (ADR-0128); a thread's card and a
  note column none. Where a card is goes through core's `placeFields`
  and `placeOfFields` (`core/places.ts`), which the wire's key codec uses
  too, so the two cannot drift. Each stored kind's row has its fields in
  one table (`ROWS`): a row is written through it and read narrowed to its
  kind, so neither can touch a field its kind does not store. Your
  message, a pinned card and a queued card name their thread alone (stored
  in `lane`), and resolve to its end (`placeEnd`, `threadEnd`): every entry
  names its thread (ADR-0125). Their rows keep no `at` (migration
  `0009-card-content` cleared the old ones); the row's `at` field is a
  comment's entry. A canvas card has its canvas, rank and width; a card in a
  trash is stored as the place it left, its row's kind that place's
  prefixed `discarded-` (`discarded-note`, `discarded-canvas`, …), so no
  field was added; a queued card has its `order` and `by`, and `seen`, its text's version as its queuer had it (S96), which
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
  or a note column on a canvas (`n-` id), which is then in its canvas's
  history. Where each kind of card may be is one table, core's
  `PLACES_OF`, which `fitsPlace`, `placed` and each record's place type
  (`PlaceOf`) read. Nobody removes a card:
  `Move.to` is never null. A discard is a move to a trash (`DISCARDED`,
  ADR-0134), from any place the sender may move out of: a text card, a
  reference, a thread's card or a note column (`KINDS`). Its key names no
  place left: the host fills it in from where the card is (`placeAt`:
  `{ kind: "trash", left }`), and the sender is its placer, as for any
  move. Nothing else decides where it is: whose trash it is, who sees it,
  where a restore goes and which history it is in follow from `left`
  (`ownerOf`, `livePlaceOf`, core). Its history (`historyOf`, over
  `Discards`) is the canvas it left (`canvasOfPlace`), or for a card in an
  inventory the canvas its sender is on (`here`, which a `move` carries),
  or, on none, its sender's history outside any canvas. A spin-off's `here`
  is the canvas its sender will be on: the new one for a drop in the
  sidebar, else the tab's. A queueing passes no canvas here (`here` null),
  since its target is a queue. A card in a trash keeps its record and text, is drawn
  nowhere (every read of a place names the kinds it draws), and moves only
  by an undo or `planFromTrash`: `planMove` refuses any other handoff from
  a trash `gone`. `planFromTrash` takes a card out for its cutter's paste
  (`uncut`: its placer only, to the paste's target) or a restore (back to
  `left`, a canvas at its old rank, for anyone a move into `left` allows;
  refused `left-gone` when what `left` is on is trashed or has no record,
  `left-taken` for your message's place where you have a newer one, and
  `not-yours` for someone else's message). A move to `BACK`, or out of a
  trash to the very place the card left, is a restore. All of them share
  `handoff`, the compare-and-set and every check after it. A thread's
  card in a trash is held by nobody (`holdingOf`: `trashed`), but its run
  stops (`takenIn`) and its queue waits. `planTrashSweep`
  (`card-history.ts`) deletes it once `trashDeadline` (its newest history
  event, `trashedAt`, plus the keep it is given) has passed, and with it every card
  on a surface it owns, down the owners: a thread's message, pinned,
  queued and margin cards, a note column's notes. The keep is a
  parameter of `trashDeadline` and `planTrashSweep`: `TRASH_KEEP_MS` (7
  days) is read only where the host's sweep and the page are wired
  (`housekeeping.ts`, `App`), so they cannot disagree, and a keep from
  configuration replaces it in those two places alone. The host's sweep removes
  a deleted thread's lanes as an archive's teardown does
  (`planLanesGone`). Queueing puts it after the lane's
  last card, queued by the sender, and clears why it was not sent before;
  below the line, or into an inventory, it keeps both. A move to where the
  card already is is refused `moved`: it would queue the card last under its
  sender's name, and a card changes its place in line by a reorder.
  Refusals (`MoveRefusal`): `gone` (no record, or discarded), `moved`,
  `exists`, `full`, `not-yours`, `no-place` (a place the card's kind is
  never in, or a kind no person moves: every move of a fact is refused so,
  with no check of its own), a restore's `left-gone` and `left-taken`, and
  an undo's `replied`. A move to `new-canvas` makes a canvas (`planCanvasOpening`,
  `canvas-index.ts`, by the mover, at the end of the board's first state; `no-place`
  before the board has states) and puts the card first on its canvas, one
  step in the new canvas's history.
- **A reorder is a card's action in place, not a move** (`planReorder`,
  ADR-0048 step 7). It names the card, its place's key, and the two cards
  it goes between as its sender saw them; the host checks them against the
  places alone, since a thread's pinned cards are found through the tree,
  which a handoff does not read. Where a reorder may be is core's
  `REORDER_PLACES` (`ReorderAt`, `isReorderAt`, which the codec and
  `reorderOf` read too), and `REORDERS` has a row for each, so a place a
  reorder may be at cannot lack its siblings: the lane's queue, its note
  column's notes, its canvas's pinned cards, its canvas, or every
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
- **The placer is who put the card where it is**: the sender of every
  accepted move. A write the host makes itself keeps it (`planUnsent`,
  `planSetCommand`), so a refusal never names the host.
- **Several moves are one** (`planMoves`): each planned against the cards
  as the ones before it left them, accepted whole, or refused by the first
  that is, naming its card. A keep's cards are one command, so it is undone
  whole too (ADR-0066). `planMoveCommand` is that and the lanes to drain:
  each one a card ends queued on, when it is not running.
- **Which history a move enters is `historyOf`'s** (ADR-0066), a
  `MoveHistoryScope` (core): a canvas's, or a person's outside any canvas.
  A creation enters one when its command's cause is a paste (a paste, a
  thread's copy, ADR-0132) or it is a note column made for a note: the
  canvas it lands in, or with none (a slot) its sender's history outside any
  canvas, so the undo key takes it back. A creation a move makes (a
  composer's new card, an empty note) and a send, which is no move, enter
  none. Otherwise the canvas the card goes to, when it goes to one,
  else the canvas it leaves, read from its record, since a move is accepted
  only from there; a discard's is `discardHistory`'s canvas, or with none its
  sender's history outside any canvas (ADR-0126). A place is in a canvas by
  `canvasOfPlace`, so no tree is read. An inventory is in no canvas.
- **`undoAnswer`** reads what a whole undo did: the cards its step wrote,
  from their footprints in the places document (`["cards", <id>]`), each
  with its place now; or, refused, the first card it could not undo as it is
  now, `moved` (its placer names who) or `gone`; or `nothing`.
- **`planHistorySweep`** gives the histories of moves to retire: a canvas's
  `ARCHIVED_HISTORY_MS` (7 days) after it was archived, and, at startup
  only, those of a canvas the session does not hold. A person's history
  outside any canvas (`moves:<writer>`) is kept, and an id that names no
  history is left: the histories once kept by root were retired by
  migration `0005-tasks`, since deleted.
- **A card at a thread's end is resolved, never stored as an end**: your
  message, a pinned card. `placeEnd` is its thread's end (`threadEnd`), so
  the card follows its thread as the thread grows; a thread not yet
  started has none. `pinnedAt(end, …)` is everyone's pinned
  cards whose end is `end`, by `order`, then by id. `cardEnd` is your
  message's end only (`composing`), and `yourCard` finds yours through it,
  at an end, or by its thread before it starts (ADR-0126), never another writer's and never a note,
  the newest of yours there (ids are uuidv7). Were `cardEnd` to resolve
  pinned cards too, your composer could bind to one of yours.
- **A note is in a note column** (ADR-0116), at a rank there (`order`), the
  host's to give as a queued card's is: a move into a column lands at its
  end (`noteAt`), and ↑ and ↓ are reorders among the column's notes
  (`notesIn`). A note's key names its column alone, so a reorder there
  does not make someone else's move fail.
- **A card leaving a thread's queue or pinned strip goes to the note
  column nearest the thread** (`nearestNoteColumn`, pure): in the canvas of
  the thread's canvas, the note column fewest places from the thread's card,
  the one after it on a tie; with none, one made just after the thread's
  card (`orderBetween`, or `respace` with no room), untitled, read as
  `NEW_NOTES_TITLE`. `notesNear` decides which, minting nothing: a
  column, one to make (its canvas, rank and the canvas cards renumbered
  around it), or, for a thread whose card is in an inventory, that
  inventory (ADR-0117). `toNotes` turns that into a place and the steps to
  write first, minting a column's id (`newColumn`, `n-` and a uuidv7 on
  the host) only when one is made; moves and unsent cards go through it. The page names the target `notes`
  (`noteOf`), and the host resolves it (`planMoveTargets`, inside
  `planMoveRequest`, which ranks a spot on a canvas, `canvas-at`, too), each move against the cards the ones before it
  left, so a column made for the first takes the rest, and writes the
  column in the same step as the moves. The page draws a pending one in
  the column the host would choose (`drawnPlace`), or where it was while
  the host would make one.
- **A margin is an entry's place for comments** (ADR-0126): `{ kind:
  "margin", entry, thread, order }`, stored as a `margin` row, the entry in
  `at` and its thread in `lane`. It is a text card's and a reference's
  place, and a reorder place (`REORDERS`: the entry's comments,
  `marginCards`, the neighbours next to each other); a move or a make puts
  a card at its end (`marginEnd`). Its canvas is its thread's
  (`canvasOfPlace`), so it is found without a tree; the host checks that
  thread against the entry's own before it plans (`planMoveTargets`'
  `entryThreads`, read from the entry's root by `marginEntryThreads` in
  `commands/cards.ts`), and refuses one naming another, `no-place`.
- **A drop resolves to a place** (ADR-0126). A card of a kind no canvas
  takes, sent to a spot on one (`canvas-at`), lands in the container its
  kind is made in there: `WRAPS` (core's `places.ts`) says which, a note
  column for a text card or a reference, so a later kind is a row. It is
  part of `TargetOf` (`isTargetOf`, the wire's check), and
  `planMoveTargets` resolves it: the spot ranked as any card's there
  (`rankOnCanvas`), a note column made at that rank by the mover
  (`makeNoteColumn`, through `planMake`, as `toNotes` makes one), and the
  card moved in as its first note. Both are one `planMoveRequest` write, so
  one gesture: the mover's history in that canvas (`historyOf`) undoes both.
  The page draws the card where it was until the host writes the column,
  as it does for a column `toNotes` would make. A reference or a text card
  pasted on a spot (`paste`) resolves the same way, its column made in the
  same step of its paster's history.
- **A card the host could not send** (`planUnsent`) goes to the note column
  nearest its thread the same way, saying why. Where it has nowhere to go
  (its thread's holder's inventory full, or a thread with no card) it stays
  queued, saying why, and the host holds its queue, so the drain passes it
  by until someone moves it.
- **A note column's title** is its own record (`NOTE_COLUMN`, keyed by its
  id: title, who set it, when), absent while untitled. `mark` sets it as it
  sets a canvas's (`planMark` over a `MarkTarget`): last write wins, null
  clears it, the agent never sets one, and a column on no canvas is refused
  `UNKNOWN_TARGET`. The archive gate reads a note column's canvas from its
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
  running and whose queue is held is `held` in `threadsWork` (core), which
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

# A card made a thread (`spin-off.ts`, `root.ts`, ADR-0111, ADR-0126)

- **`planSpinOff`** checks a spin-off before anything is written: its move
  must be a text card's to its sender's trash; the new root's and thread's
  ids, which the request names with its new canvas, must be free; the card's
  text, trimmed, not blank; and the move as `planMove` decides it, so a
  card someone moved first, or one in another's inventory, is refused as
  any move is. It returns the thread's opening (`planThreadOpen`: its
  record, `origin` `spun` from the card, its new canvas's record and board
  place, its card on that canvas), its first message (the text, its
  mentions without the agent: a chat has no lane) and the
  card's write. The host writes the records, sends the message, and only
  once the send took the card writes the thread's card and the card's move
  to the trash, in its history's step; a send that took nothing deletes
  the records again.
- **`planLiftRoot`** decides an undo that would move cards spun into
  threads (S139: the host reads the step's cards from the stack's `top`
  first, then the threads whose record says they were spun from one of
  them, `SpunThread`). Each thread the directory still names must hold its
  first message alone (its tree's writers, oldest first), with no lane and
  no card in it but those the undo moves; otherwise `replied`, naming who
  wrote second (null for the agent, a lane or a card). A card is in the
  root by `rootOfPlace`. Its thread's card must also be where the spin-off
  put it (ADR-0124): on a canvas, never moved since (its card history holds
  its making alone), with no other card on that canvas and none pinned to
  the canvas, so an undo restores exactly what was there or does nothing. A
  thread already gone lifts nothing; `delete` names each root and its
  thread, read before the undo reverts the card.
- **`planRootDelete`** (`root.ts`) is what deleting a lifted thread
  writes: its directory record (`ROOT`), its thread's (`THREAD`), and its
  canvas's title (`MARK`), every card still in the root or on the canvas's
  canvas removed, the canvas's own card with them, its document named
  for destruction, and the canvas for its stacks to be unloaded;
  `planHistorySweep` retires those stacks at the next start, as for any
  canvas the session lacks.
- **`emptiedCanvases`** (`root.ts`): the canvases a step leaves empty that were
  a new canvas's: a thread card that left its canvas for a trash, its thread a
  new root's not yet started (its root one the directory does not name),
  and nothing left whose owner is the canvas (`ownerOf`). The host sends
  each one's card to the trash in the same step (`planCanvasesTrashed`, its
  board place as `left`, its closer the placer), in their history outside any
  canvas, since the canvas leaves their view: the undo key on no canvas brings
  the canvas and its thread back (ADR-0126).
- **The history's verb is `discarded`** (`verbOf`): the spin-off's card is
  in its sender's trash, as any discard's is.

# Card history and traces (`card-history.ts`, ADR-0048 step 6)

Each card's history and the traces left where someone else moved your card.
Both are session records the host writes: `CARD_HISTORY`
(`pinetrie.card-history`, keyed by the card, deleted with it) and `TRACE`
(`pinetrie.trace`, keyed by its own id, since a trace outlives its card). A
place in them is stored as core's flat key fields (`placeFields`,
`keyOfFields`), the wire's own codec; an event whose place this build cannot
read is dropped, not its history. The places document holds neither: it
grows for good (S90), and a field every event changes would refuse each
whole undo of a move (S82).

- **`planProvenance` is the one decision**, from the cards before and after
  a write, the cause, the records, the presence pairs (`reading`) and each
  shared card's thread end before the write (`ends`). It diffs card by
  card, so an undo, whose revert Kyneta writes, is read like any other
  write, and the host gives it only the cards one change touched
  (`apps/pinetrie/host/places.ts`): what another change wrote meanwhile is
  not this one's. Every change records it, the host's own too, so every
  card the host makes (a fact, an ask, a split's card) has its `created`.
  - A card that appeared is `created`; one whose key changed gets `moved`,
    `undone`, `redone` or `unsent` (the host wrote a queued card back below
    the line with `unsent`); one that went has its history deleted. A reorder changes no key, and adds
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
  person names the others this way, in `MessageDetails.contributors`: "Ada, with
  Bea". The model reads only the sender's name.
- **`planSeatSweep`**: seat records no stored text names. A store-less client
  is a new seat on every load, so without it the records would grow with every
  visit. It returns the records, and the host deletes each by its `peer`.
  A seat stored under its `clientID` before ADR-0062 reads with that text as
  its `peer`, which is its address, so the delete finds it.

# Canvases (`canvas-index.ts`, ADR-0116)

A canvas is a card on the board (`board.ts`, ADR-0126), its id its
`CanvasId`, its owner who opened it; what it holds is where the places
document puts each card: a `canvas` place names the canvas, a rank and a
width, so a card has one place by construction.

- **One `CanvasIndex`** (`indexCanvases(cards, threads)`): each canvas in
  order, each canvas card's canvas (`canvasOfCard`), each thread's canvas
  (`canvasOfThread`), each canvas's threads and roots, each root's canvases, each
  recorded thread's root (`rootOfThread`). The host (`canvasesNow`, once per
  command, `commands/index.ts`) and the page (`canvasesOnBoard`) both read it, so
  they cannot disagree on where something is. A note is in its note
  column's canvas (`canvasOfCard`).
- **A trashed card is in the canvas its `left` is in.** The index records a
  trashed thread's or note column's canvas in `canvasOfThread` and
  `canvasOfCard`, never in `canvases`: so its own cards keep their canvas (their
  history, the archive gate) while nothing trashed is drawn, and
  `canvasOfPlace` of any place is its owner's canvas (`ownerOf`).
  A reader that means "on the canvas" reads `canvases` (`cardsOnCanvas`,
  `isOnCanvas`), never `canvasOfThread`. A trashed thread is live
  (`isLivePlace`), so a restore or a link within the week still reaches it.
- **One way to make a canvas** (`planCanvasOpening`): its card by the host,
  its opener its owner, at the end of its state on the board (`boardEnd`);
  `no-place` before the board has states. A thread opening in a new canvas's
  canvas (`planThreadOpen`) and a card dropped between canvases (`new-canvas`)
  both use it.
- **A place at a thread names its thread and no root** (composing, pinned,
  queued; the thread in the row's `lane`). Its canvas is its
  thread's (`canvasOfPlace`), and its root its thread's record's
  (`rootOfPlace`): one field per fact, so the two cannot disagree.
- **A thread opens before its first entry** (`planThreadOpen`, ADR-0126):
  its record, which says how it began (`ThreadOrigin`: a root's first
  thread, spun from a card or not, or a fork at an entry, a branch or a
  copy, whose source is the thread its entry is in), its card where its
  `ThreadPlacement` says (on a canvas just after the thread it forks
  from, `branchAfter` and `rankAfter`, else at its end; where it was
  dropped, `rankOnCanvas`; or in an inventory), and for a canvas the session
  does not hold (`CanvasOpening`, a new canvas's) the canvas's card, made by the
  host with its opener its owner, at the end of its state (`boardEnd`);
  refused `no-place` before the board has states. The one planner for a
  thread as its column opens (`planOpenThread`, `open.ts`), by its
  `ThreadStart`: a branch, a new canvas's new root, or a new
  root in a canvas the session holds, placed as a drop after its `after`
  would be (`spot`, ADR-0138); refused `taken` for an id in use or a new
  tab's canvas the session holds, `unknown` for a branch's entry its root
  lacks or a canvas the session should hold and lacks. A branch's root's
  tree is planned from only as part of its start (`GatheredStart`), so
  nothing else gathers one. Also a copy (`planCopy`) and a spin-off
  (`planSpinOff`). A
  first send to a thread opened writes only its entry; a branch's first
  send that names no thread opened yet (a script's) opens it with the send
  (`sendMessage`), as its column would have, and `executeSend` writes that
  before the message.
- **`unstartedThreads`**: each thread opened and not yet started, and where
  its column ends: no entry of it in the tree, and either its fork in the
  tree (its root held here), or its root one the directory does not name
  yet (a new canvas's, or a new root's in a canvas already held). The page draws its card's column from it.
  For a branch opened from a proposal by the reader, it carries the
  composer's start, `proposalDraft`: the row's brief asked of the agent
  (core's `agentAsk`), read from the proposal by row, never stored, and
  gone once the thread starts (ADR-0157).
- **A branch's opening is one planner** (`planBranchOpen`, `open.ts`): the
  `taken` and `unknown` checks, then `planThreadOpen` after the thread
  it names (`after`), or the thread its fork is in. `planOpenThread`'s
  branch case calls it once; a proposal's press, once per row
  (`planBranchOut`).

- **`forkOf`**: each forked thread's fork (`ThreadFork`), a branch's or a
  copy's, from its record's `origin`: where its column ends before its
  first send, and whether its fork row says "copied from".

# Threads as cards (`held.ts`, `copy.ts`, ADR-0117, ADR-0124)

A thread's card is a canvas's, an inventory's or a trash's
(`PLACES_OF.thread`), and moves between them as any card does
(`planMove`, typed at the codec by `typedMove`). An inventory, and a
trash, have no agent and no runner. Where its card leaves it is
`holdingOf`: `free` on a canvas, `held` by an inventory's holder, or
`trashed`, held by nobody.

- **Where each command runs** (`runsIn`, beside `writesIn`): what each
  command or send (`Gated`) runs or writes a message in: a send at a
  thread's end or popped from its queue, a carry-on, and an action on proposed changes
  that may ask the agent (all but an acceptance) run in their thread; a branch in the thread its
  fork is in, read from its root's tree; a new root in none. Exhaustive, so
  a new kind of command does not compile until it says. `threadsOf` turns
  each into its thread, and `heldIn` finds the first of those held or
  trashed (`holdingOf`); a copy's first send, at its own record's fork,
  runs in the copy. `foreignIn` (ADR-0150) finds the first place a run
  would start on a lane of another kind than the project's: a thread's own
  lane (`proveRunnable`), or for a send at an entry the lane whose disk it
  would clone (`sourceHistory`, its snapshot taken as kept), so a copy's
  first send is checked against the lane it copies. The gate refuses
  every command and send by them (`planGate`, below: held first, a
  person's own hold being the nearer reason, then foreign, worded by
  `foreignLaneWords`), and the drain asks before it pops
  (`planNextQueuedCardPop`'s `away`: its own thread's `holdingOf`, and the
  lane's kind), so its messages wait. A
  fact on top is popped there all the same: it starts no run, and a take's
  stop must be in the thread for its face to say so (ADR-0126). Refused
  with `HELD_WORDS`, "put it on a canvas first", or for a trashed thread
  `TRASHED_WORDS`, "restore it first" (`holdingWords`).
- **A take stops the run** (`takenIn(before, after)`): every thread card
  in an inventory or a trash after a change that was not there before. The host's
  provenance step reads it from every person's change to the places (a
  move, an undo or a redo, a copy), so no path that writes places can
  take a running thread and leave it running. The stop is the taker's own,
  through the one stop command (`handleStop`, `planStop`), so it is a fact
  in the thread.
- **A moved thread is told** (`canvas.ts`, `planCanvasFacts`): a running
  thread whose card moved from one canvas to another's is steered
  "Bea moved this thread to the canvas …"; the canvases' other running threads
  are told it was taken and added.
- **`planCopy`**: a copy of `source` at `end`, refused unless `end` is in
  the source (`threadAt`), the copy's id is new, and nobody else holds the
  source. It opens through `planThreadOpen`: its record's `origin` is
  `{ kind: "fork", at: end, how: "copy" }`, kept after its first send, so
  its fork row can say "copied from"; its card is made by **`planMake`**
  (`moves.ts`), the one rule every card is made by: `exists`, then
  `refuseInto`'s refusals (a place its kind is never in, another's
  inventory, a full one). It lands on a canvas by **`rankOnCanvas`**, as a
  move's drop does. No entry is written: its first send is a branch at its
  fork, which the gate lets through by the copy's own holding
  (`threadsOf`'s fork rule) and `sendMessage` writes in the thread whose
  record names that fork (`forkEntry`), with no second record or card.

# The gate (`gate.ts`)

What a person's command, or a send the host makes for one (a popped
queued card's, a spin-off's first message), may do now. Agents' relays are
not gated here: they ask `threadReach` (`reach.ts`).

- **One pass, one maker.** `planGate` is the only maker of a
  `Cleared<C>`, as `planCopyReady` is of core's `ReadyCopy`; the host's
  `sendMessage` takes only a `Cleared<Send>`, and its dispatcher carries out
  only a `Cleared<Intent>`. What the gate decides on is core's `Gated`, a
  command or a `Send`.
- **The order is the plan's.** The archive first (`writesIn`,
  `archivedIn`), which needs no root, so a command it refuses opens none;
  then the roots a branch forks in, which it asks for as `read` until
  `GateFacts.roots` holds them, so no caller can pass a branch it never
  read (`threadsOf` reads a missing tree as no thread); then a thread held
  or trashed (`threadsOf`, `heldIn`); then a lane of another kind
  (`foreignIn`).
- **Its words are its own** (`gateRefusal`): `canvas_archived` naming the
  archiver through a `nameOf`, as `reachWords` takes one; `holdingWords`;
  `foreignRefusal`. The host words none.
- **A pass proves the check ran, nothing more.** It does not say the facts
  it was planned from still hold: the host clears and sends in one keeper
  step. And a spread of a cleared value keeps the brand
  (`{ ...cleared, at }` compiles), so a cleared value is passed on as it
  is, never rebuilt.

# The board (`board.ts`, ADR-0122)

Every canvas on the board is in one workflow state. A new session's are
Topics, Active and Archive (`defaultWorkflow`, ADR-0158). The workflow is a host-written
singleton (`WORKFLOW`): the open states in board order, then the closed
state, always there and always last. A canvas is a card (`KINDS.canvas`,
ADR-0126), its id its `CanvasId`, placed `{ kind: "board", state, order }`
(the row's `state` and `order`): the places document is the one record of
where it is, and its card's history of who moved it there and when. The
board is the team's: everyone in the session shares it.

- **What a canvas on the board is, is its state** (`canvasRole`,
  ADR-0158): a topic in the first open state, a task in a later one,
  archived in the archive; a state the workflow lacks is read as the first,
  as `boardOf` places its canvases there. Never stored, so reordering the
  states changes the role and nothing else.
- **The canvases the session holds are the cards on the board**
  (`boardCanvases`): a canvas's card in a trash (a new canvas closed unsent) is on
  no board and in no list until the undo key brings it back.
- **The board is total** (`boardOf`): every canvas's card on it, in its
  state, by rank, then by id; one in a state the workflow no longer holds
  at the end of the first open state, so a stale place never hides a canvas.
- **Archived is derived, never stored** (`archivedOf`): the canvases whose
  card is in the archive, with who moved them there and when
  (`ArchivedCanvas`), read from the newest event of each card's history that
  put it there, which a history always keeps; its placer at 0 for a card
  with none. Every reader of the archive reads it (`readArchived`).
- **No person's move takes a canvas's card** (`KINDS.canvas.moves` false: a
  move onto the board is refused `no-place`): `planBoardMove` decides the
  board's own move. The sender names the state it saw the canvas in; one
  that has left it is refused `moved`, the card as it is saying where and
  who put it there. `before` is the canvas it goes before, or the end.
  Within one state it is a reorder: its rank alone, its placer kept, so no
  history step and no event; between states, a move, its sender its
  placer. With no room between its neighbours the fewest are renumbered
  (`rankAfter`), each keeping who put it there. The host carries it as any
  card's write (`placeCanvas`), a move in its mover's history outside any
  canvas.
- **No undo crosses the archive's edge** (`crossesArchive`,
  `move-history.ts`): an undo or a redo of a step whose canvas's card last
  went into or out of the archive is refused `archived`; the board
  gathers what crossing it needs.
- **`transitionOf` says whether a move crosses the archive's edge**:
  `within`, `close` or `reopen`. The host gathers the canvas's roots'
  documents only to cross it (`apps/pinetrie/host/commands/board.ts`).
- **`planWorkflowEdit`**: add (before a state, or after every open one),
  rename (trimmed; names may repeat), move, remove. The archive is
  renamed only; a state holding a canvas is not removed, nor the only open
  state.
- **`boardEnd`** places a new canvas's card at the end of the state its
  chat names, or of the first open state when it names none, one gone, or
  the closed one.
- **Order keys are `order.ts`'s**, shared with cards' queues and pins:
  fixed-width base-36, so string order is numeric order; `keyAfter`,
  `orderBetween` (null with no room), `orderKeys`.

# The archive (`archive.ts`, ADR-0029, ADR-0122, ADR-0116)

A canvas put aside for everyone: one in the archive. Moving it there or out
writes only its card's place: entries are immutable (ADR-0004), so a canvas is hidden
and made read-only, never removed.

- **`planLanesGone`**: what lanes that will not run again lose, an
  archived canvas's or a thread the trash sweep deleted: each forgotten, its
  ref deleted (which withdraws its proposed changes), and every snapshot but its
  newest and the one nearest each thread's end in the trees given. An
  archive's teardown and the trash sweep both ask it.
- **`planArchive` decides what crossing the edge does**, pure, for a
  `Crossing` (`close` or `reopen`). Closing is refused `canvas_busy` while
  any lane of the canvas's threads runs or has cards queued (`threadsWork`).
  `CANVAS_BUSY_REASON` is the one wording, which your list's and the board's
  Move to ▸ show too. Reopening is never busy.
- **A crossing is planned whole, in three parts** (ADR-0065): the place,
  written on the documents' keeper; the `teardown`, carried out off it
  (the canvas's threads' own lanes to forget and remove, their refs in your
  repo, null on close and each tip's nearest revision's commit on reopen,
  and `planRetention`'s snapshots); and `unload`, for a close, on the
  keeper again: the canvas's roots no canvas outside the archive, and no
  inventory, still holds a thread of (`stillHeld`). The host passes its
  lanes of their own (`own`, each with its root's index) and the revision
  records, so no part decides anything when it runs.
- **An archive settles its threads' pending verdicts** (`verdicts`,
  `unclassifiedPending`, `verdict.ts`): the run's end that would write one
  is a late write, which an archived canvas refuses, so the archive writes
  `unclassified` with its place, as a starting host does for a request it
  lost (`planStartup`).
- **The gate keys on the canvases a command writes in** (ADR-0063). `writesIn`
  names them for every intent (a chat's thread's canvas or a branch's, a
  mark's, a retitle's, an undo of moves', proposed changes' lane's, a queue hold's
  and an unqueue all's lane's, a reorder's place's, and for a move the canvas
  each card goes to and the one it leaves), or none for one that writes in
  no canvas (a name, a stop, a move on the board or a change to its states,
  a reservation, a command on a card, traces seen), so an archived canvas can
  always be restored, and nothing moves out of one (`canvas_archived`,
  "restore the canvas first"). `archivedIn` finds an archived one by its
  `CanvasId`. One rule, the gate's first (`planGate`), for every command and
  every send, a popped queued card's among them (its thread's canvas),
  worded by `gateRefusal`.
- **Yjs writes are not refused for archiving.** A card's text in an archived
  canvas stays writable to the host's policy (a refused write cannot be
  recovered from, S28); the composer there is read-only.
- **Every planner refuses with core's `Refusal`** (`refused(code, message)`),
  the shape the codec decodes to and the host answers as its `Outcome`
  unchanged, so no package spells it out.

# Marks (`mark.ts`, ADR-0045, ADR-0116)

A canvas's title. The record is a host-written `pinetrie.mark` value in the
session, keyed by the canvas's id, so a canvas has at most one by
construction. A mark once kept in a root's document, on its root entry, is
deleted at startup (`planUndeclaredSweep`: stored outside its spec's
home).

- **`planMark` decides**, pure: a canvas the session does not hold is
  refused `unknown_target`; the title already stored, or clearing a canvas
  with none, is `unchanged` and writes nothing; otherwise `write`, or
  `remove` for a cleared title. The last write wins: nobody types a title
  together, so it is session JSON, not a text (ADR-0023).
- **Clearing deletes the record.** A stored empty title would read as chosen.
- **A mark in an archived canvas is refused by the archive's gate:**
  `writesIn` names a mark's canvas, so `planMark` has no check of its own.
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
`{ "digests": { "enabled": false } }` is in the config (`digests.enabled`,
ADR-0071, settled by the host's table). A host-written `pinetrie.digest` value keyed
by the ask's prompt, `{ headline, points, at, final }`, replaced whole each
time: a value, not a text, since nothing accumulates (ADR-0014). A null
headline is a digest with nothing to draw. No agent reads it.

- **`digestDue` is asked on events, never on a timer**: each turn done,
  and the run's end. While the run lasts, only when nothing is asked
  already, someone reads the thread (`readsAsk`, over presence's
  `reading`, ADR-0024) and `DIGEST_EVERY` has passed; at the end, once, for the
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

# A model setting (`config.ts`)

`modelRef` reads `provider/id`, split at its first `/`, since an OpenRouter
id holds one. It is the parser the host's model settings wrap (`model`,
`titles.model`, `icons.model`); a value it refuses is a refusal the host and
the setup page name.

# The setup record (`setup.ts`, ADR-0146)

| record | namespace | key | written |
|---|---|---|---|
| what the host read of its config and what its model setup loaded, for the setup page | `pinetrie.setup` | `setup` (`SETUP_KEY`) | at host start, and when accepted work's config changes it |

It holds only what no other record publishes: each layer's file and state,
every refusal, every setting with its value as JSON text and its origins,
the model or why there is none, the providers with a credential and where
it is (never the credential), the refused packages and the context files.
The commands are `pinetrie.commands`'.

# Titles (`title.ts`, ADR-0074)

A model's few words for a canvas, written as its mark (`MARK`, ADR-0116),
so Rename edits it and every place a title shows reads it. Titling still
reads a root's tree: Phase 2 holds one root a canvas.

- **`TitleConfig`**: `titles.enabled` (on unless a layer turns it off, as
  digests are) and `titles.model` (null for the run's), as the host settles
  them.
- **`planTitling` is the decision and the request's lines.** Unasked (a
  lane just created, `trigger.kind` `lane`): only for the root's first lane
  (no other lane record names the root), with titles on, the canvas unmarked
  (`marked`), and none in flight; the lines are the path to where the lane
  starts and its prompt, which the tree does not hold yet. Asked: always,
  from the path to the root's newest message; refused for a root with no
  message. It also names the mark's author: the agent, or the person who
  asked.
- **`titleRequest`** keeps the first line whatever the budget, since how a
  thread began usually says what it is for, then the newest that fit
  (`fitNewest`).
- **`titleOf` refuses rather than cuts**: more than `TITLE_WORDS` words, or
  what `parseTitle` refuses, is null, and the canvas keeps its label. It
  unwraps quotes and trailing punctuation with `bareLine` (`request.ts`),
  as a digest's headline is.
- **`titleStillWanted`**: an asked title is always written; an unasked one
  only over no mark.

# Where lanes work (`work.ts`, ADR-0032 to ADR-0034)

Host-written records, each a `RecordSpec` (above) with a total decoder:

| record | namespace | key | written |
|---|---|---|---|
| a lane's setting: the root it works in, and the kind of history its own copy keeps (`history`: `"jj"`, `"folder"`, or null for no copy of its own) (ADR-0102, ADR-0150) | `pinetrie.lane` | the lane | once, when the lane is created |
| the state (`point`) and disk at an entry, and the paths its turn changed, written whole: every field present (`0016-revision-point` moved the older shapes) | `pinetrie.revision` | the entry | for every run's prompt, and every assistant message of a lane of its own that made tool calls |
| what the host found where it runs: its root, its kind (`jj` or `folder`, what a lane's history must be to run), and its owner; a record from before the kind decodes as none until the host's start rewrites it | `pinetrie.project` | `project` | at every start |

- **Every run's prompt has a revision record**, so the nearest record above
  any entry names its lane, its state and its disk (`nearestRevision`, in
  core, finds the nearest state and the nearest snapshot independently,
  each with the lane that recorded it).
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
  - Only a turn's own state carries `paths` (`changedPaths`, ADR-0106): a
    prompt's newest is what came before it. An ask's file count is the union of its turns'
    paths (`workStats`), so it is what its review lists.
  - **A lane's runs are folded on the host** (`runs.ts`, ADR-0135), from
    core's `RunEvent`s, whatever observes the lane:
    - **A path is made relative to the lane by `pathUnder`, not
      `node:path`:** this package is in the page's bundle, where a
      builtin is a stub that throws when called. The observer sends a
      missing path as the call named it, so `..` reaches the fold, and a
      path that climbs out of the lane is dropped.
    - **An event is an attempt:** whether a path is there is read at each
      drain (`present`, from the lane), never inferred, so a temporary file
      renamed away, or a call that failed, reports nothing.
    - **A path's first event decides whether it was there before the
      run,** so a write is created or not, and a read counts only of what
      was there before the run wrote it.
    - **Events are folded as they arrive, in batches** (ADR-0145), by
      `laneFold`, which the lane's `RunSource` applies
      (`packages/lanehost/TECHNICAL.md`).
      - Their source holds traces, never events, so a lane's runs cost
        the paths they touched inside the lane, not how often they
        touched them.
      - **A change to `foldRunEvents` must keep it a left fold:** a
        sequence folded batch by batch gives the traces of it folded at
        once. A test holds it to that over random splits.
      - The fold holds the lane's directory and shared directories
        (`LanePlaces`), from the helper's hello. A trace does not carry
        them.
      - It copies a trace's maps once per call, so it is never called per
        event.
      - A trace's `accesses` is the exception: a log of every open and
        release under a shared directory, which `sharedTouches` reads in
        time order.
    - **A drain is given the traces only after a flush:** `drainLane` runs
      inside the `RunSource`'s `drain`, whose callback is the only way to
      the traces. `tracesWithCommands` gives each launched run its
      command, which comes from the helper at the drain, not with the
      events.
    - **A drain's runs are in launch order** (by run number: by length,
      then as strings), whatever order their events came in. A turn's
      classes let the last run that wrote a path decide (`disk.ts`).
    - **A run with a loss** carries `observed: lost`, and is no recipe
      (`CompleteRun`, `disk.ts`).
    - **A remote release whose stamp was raced** (`raced`) is a contested
      version (`planSharedLineages`).
  - A turn's record says what it did to its disk beyond its commit
    (`disk`, `TurnDisk`, ADR-0135), from its runs (`disk.ts`):
    - **Asking and classing cannot drift apart.** `writesToClass` names
      the paths whose `.gitignore` standing it needs (each write and the
      directories above it, each read and failed lookup), and its
      `classify` throws on a path it never named. `registryAfter` names the
      paths to hash (new recipes' inputs, new roots' `CACHEDIR.TAG`), and
      its `next` throws on an answer short of one.
    - **A path through a symlink stands as the first symlink on its way**
      (`ignoreQuery`, S179). A failed lookup is reported by the name the
      process gave, which can run through one: pnpm's
      `node_modules/.pnpm/*/node_modules/<dep>` are symlinks. Git sees a
      symlink as one entry, so what lies beyond it shares its standing.
      The host gathers the symlinks from the lane, asks about `asked`, and
      `ignored` reads the answer back for the paths, so `classify` is still
      answered for exactly the paths it named.
    - **`.gitignore` is read as git reads it, with no repo**
      (`ignoredPaths`, `ignores.ts`, ADR-0142, S180). One matcher (npm
      `ignore`) per `.gitignore` above the paths (`ignoreDirs`), walked
      from the root, the last match deciding; `own`, the lanes' ignore
      file, is weaker than any `.gitignore`, as git ranks an excludes file.
      A path under an ignored directory is ignored whatever a deeper
      negation says, and a pattern ending in `/` matches only a directory,
      so the lane says which paths asked about are directories. The host
      gets the symlinks, the directories and the files in one call to the
      lane (`ignoreFacts`, `@pinetrie/pi`). It agrees with `git
      check-ignore` by test (`ignores.test.ts`), on S180's hard cases and
      git itself.
    - **`classifyWrites` classes each path a run or a write tool wrote.** Not
      ignored is source. Ignored and written by a run that read source,
      unless the run read it before writing it (an edit in place), is
      derived, and so is any ignored write under a root the registry
      already holds. The rest is local, and a write tool's ignored write is
      always local, inside a derived root too.
    - **A derived path's root** is the registry root it is under, else its
      topmost ignored directory short of the lane's home
      (`.pinetrie-lane/home`, whose top directories are roots of their
      own). So pnpm's files in a store that was there before the registry
      come under the store, not each a root.
    - **A recipe's key** (`nextRegistry`): its command, the lane's image,
      the hash of each source file it read and each file under the lane's
      home outside a derived root, the paths it looked for and did not find
      (an input gone before it was hashed joins them), and each shared file
      it read by its stamp. A newer recipe takes an older one's outputs,
      and a recipe left with none goes; a root deleted whole leaves the
      registry.
    - **A cache** (`isCache`, core) is a root holding a `CACHEDIR.TAG`, or
      one a later run only added files to once it existed; a run that
      changes or deletes anything under a root makes it never a cache
      again. A root's first making shows neither: a first `pnpm install`
      only adds, and `node_modules` must not be kept as a cache when its
      recipe's key breaks. The evidence is kept per root
      (`RootEvidence`).
    - **The record lists** derived roots and local paths, topmost, at most
      `DISK_LISTED` each with how many more (`turnDisk`); directories a run
      made from source that `.gitignore` misses; and source files written
      that the commit left out (jj's size limit). A path in the turn's
      whole-disk diff that no run or tool wrote is local when ignored
      (`unattributed`); else it is source, and in the commit.
    - **`unattributed` is linear:** a `pnpm install` turn writes tens of
      thousands of paths, its diff names as many, and it runs on the host's
      main thread. A scan of every write for each path took 44 s there
      (S179); two sets made once, the written paths and every directory
      above one, and a walk up each path's parents, take milliseconds. A
      test counts its collection steps at 1,000 writes
      (`collectionSteps`).
    - **A known limit:** a run's write named through a symlink is classed
      by that name, while the diff names the real path, which
      `unattributed` cannot match to it: the real path may be listed local
      as well. Matching them would mean resolving links.
    - A prompt's record and an update's have none.
    - **What a turn did to shared files** (`disk.shared`, `shared.ts`):
      the versions it wrote, each flagged concurrent when another version
      landed after the one it was based on and before it. What it read
      is not recorded: nothing read it back (S224).
      - **A version is a stamp, size and ctime** (core's `Stamp`), which a
        lane and the host read alike (S169), and versions order by its
        ctime (`stampTimeUs`), the host's clock for every writer, not by
        when they are learnt.
      - **`sharedTouches` pairs a lane's accesses** (its runs', and the
        read and write tools') in its monotonic order: a write is an open
        for writing and the last release of that file by the same process.
        It is based on what the lane last read of the file, in this turn
        or an earlier one (kept on the line, `read`, `laneReads`), else on
        what its open found. An append is based on what its open found. A
        write that changed nothing is a read. A file found missing was
        missing its open-to-release time before its write's ctime.
      - **`planSharedLineages`** keeps each file's lineage (`SHARED_LINEAGE`, the
        newest `SHARED_KEPT`). A stamp no lineage has seen is a version made
        outside every lane: the host's watcher's (`seen`), or one a lane
        reads first. A lane's write whose stamp is already there claims
        that version. Concurrency is reckoned over the whole lineage, so a
        write recorded before an earlier rival is found concurrent once
        the rival is, and named in `revised`.
      - **A version another lane turn's write already claimed is
        contested** (`SharedVersion.contested`): a release's stamp is read
        after the call returns, so one of the two read the other's
        version. It keeps its first writer, both writes are concurrent
        (the first named in `revised`), and so is any write based on it.
        One turn's writes leaving one stamp contest nothing.
      - **A lineage goes when its file is gone** (`planGoneLineages`): a
        full scan of its shared directory did not find it, and every
        version is older than the host's start. A turn the host records
        began after its start, so none of its writes lands between those
        versions, and a stamp it reports of the gone file comes back as a
        version made outside at its ctime, ordered as before. A lineage
        begun again numbers from 1; no record is misread, since a record
        names a version with its writer's turn, and a turn's writes are
        planned once (S224). A lineage with a newer version waits for the
        next host's scan.
      - **A lane leaves the lineages it read only when its thread is
        deleted for good** (`planForgottenReaders`), from the trash. An
        archived or trashed thread can be restored, and its next write must
        still be based on what it read; once its files are gone, their
        lineages take its entries with them.
    - **The registry** (`.pinetrie-lane/recipes.json`) decodes totally:
      a broken file is an empty registry (`decodeRegistry`). A recipe's
      outputs are `DiskPath`s (core), checked as the file is read: what
      `planStaleOutputs` deletes can never leave the disk, whoever wrote
      the file, the agent included.
  - Every record with a state carries its `conflicts`, a prompt's
    included, since a branch from it is cloned with them (ADR-0072);
    `conflictsAt` (core) reads them by point.
- **`sourceHistory`** is the kind of the disk a fork clones (ADR-0150): the
  lane's whose snapshot it is, or the project's from the base snapshot.
  A new lane's record takes it, and the gate checks a send at an entry by
  it (`foreignIn`).
- **`forkSource`** is where a new lane of its own starts: the nearest snapshot
  above it, else the base snapshot; and the nearest state, else the
  thread's base (`planBegin`): accepted work's state, or a WIP's copy on accepted work
  commit under it. It answers a `ForkSource` tagged `kind: "source"`, or
  refuses a disk of another kind than the new lane's record
  (`ForeignLane`), never told apart by a missing field. The start is always named: a cloned disk carries its
  parent's working-copy change, and the fork must leave it (S42). A snapshot
  that is gone (`kept` false, which the host asks the runtime) is read as
  missing: the fork starts from its base, and names the snapshot `lost`;
  the host records it (`FILES_LOST`, `pinetrie.files-lost`, keyed by lane),
  which a copy's fork row reads (ADR-0124).
- **A project record of kind `workspaces` no longer decodes**; the host
  rewrites it at start.
- **`planRetention`** keeps every snapshot of an open root, and each lane's
  newest when the root is archived, and the one nearest each thread's end
  in its roots (`keep`, from `planArchive`'s `trees`), whatever canvas the
  thread is in, which a copy from the archive clones (ADR-0124); the base
  snapshot is never deleted.
- **`showHostWorkingCopy`** shows a path under your working copy's root as the same
  path under `/mnt/host-working-copy`, whole path prefixes only. `planMessage` applies it to a
  message's text when its thread works, or will work, in its own copy, so
  people and the model read the same stored text (ADR-0034).

# Proposed changes (`proposed.ts`, `work-strip.ts`, `review.ts`, ADR-0105)

A lane's work reaches you as proposed changes: one revision, or a stack, in your
repo. Its record is `PROPOSED_CHANGES` (`proposed.ts`):

| record | namespace | key | written |
|---|---|---|---|
| a lane's proposed changes in your repo | `pinetrie.proposed` | the lane | when a trigger changed it, or it was accepted |

The namespace was `pinetrie.offer` until ADR-0156. Records are the page's
cache of your repo, so the undeclared sweep deleted the old ones and the
first full observation wrote the new: every field is required, and none
reads a shape from before.

What the host decides about it is `proposed.ts`'s, from the facts
`@pinetrie/jj` gathers, as decisions typed in `@pinetrie/core`
(`core/proposed.ts`): `@pinetrie/jj` turns each into jj steps
(`proposedChangesEffects` and the rest), and the host connects the two, deciding
nothing itself. Where proposed changes start (`startOfProposed`, `proposedStart`) is
`@pinetrie/jj`'s. What the page reads is `work-strip.ts`, the review's wire
`review.ts`, the commit-message format `@pinetrie/core`'s `trailers.ts`
(`withTrailers`, `withoutTrailers`, `wipDescription`, `isWipLine`), and the
commit-message request `request.ts` (`describeRequest`).

## What the host decides (`proposed.ts`)

- **`planRefresh`** decides what a trigger does (`RefreshDecision`), from
  `RefreshFacts`: for a placed lane, its place (`Placed`: tip, base,
  target, a known start), whether the lane's work changes any file
  (`FilesTouched`: `none`, `some` or `unknown`) and the proposed changes as your repo
  holds it (`ProposedChangesInRepo`); for an untraced start or a thread whose root is
  archived (ADR-0061), the proposed changes alone. Each decision carries what its
  steps need: `build` (none: never built,
  accepted, or gone), `rebuild` (the lane, or where the proposed changes start, moved under single
  proposed changes: rebuilt in place, ADR-0039), `withdraw` (where it starts reached the
  tip, the lane's work changes no file, its start is untraced and the host
  made it, or the thread is archived, edited or not), `forget` (no proposed changes and none to build: a record left from one
  goes, and with `hostLeft` the host's version of proposed changes you deleted,
  ADR-0154), `stale` (either moved under a stack), `refresh` (only
  the target moved), `leave` (you edited it), `repair` (a race left it
  divergent), `mark` (unchanged and the host's, but its top is not the
  host's version: a host step stopped before its mark, or the proposed changes were
  built before proposed changes had one; ADR-0154), `none`, or `untouched`: an untraced start with proposed changes you
  edited, or one divergent, which nothing touches until the lane catches up
  (a gap ADR-0067's untraced start leaves). Only work known to change a file, from a known
  start, is built (ADR-0067): one built from less would be empty, or bring
  back what you accepted, and withdrawn after a build it would be built again on
  the next poll. `unknown` keeps proposed changes that are there, and builds none. Where it starts is compared as a set
  (`sameStart`): a merge's parents come in any order. `rebuild` is not the work strip's
  `update`, which catches the thread up (`planUpdateFrom`, `base.ts`). Proposed changes are edited (`isProposedEdited`) when its
  bottom's parent is not an ancestor of the target (S48 item 7), a commit of
  yours sits between its revisions, or any revision is edited
  (`revisionEdited`): a version an operation not the host's made changed it
  since the host's newest version (S73). A revision the host never made is
  yours. Proposed changes you edit are never touched again, so nothing the host
  writes can hide your version. Moved (`isProposedMoved`) is its ledger against
  the lane's tip and start; proposed changes with no ledger read as moved, and is
  rebuilt once. The record's `stale` uses the same rule.
- **`proposedChangesRecord`** is the record, the page's cache, from the proposed changes as
  your repo holds it: its files and conflicts, your edits (its files that
  `@` changes), described (its first line no longer the WIP line), edited,
  stale (a stack whose lane moved past its ledger), its bookmark (as the
  gather found it) and its commits. **`planYourEdits`**: only `@` moved, so
  each record not yet accepted has its `yourEdits` rewritten from one
  shared read.
- **`planAcceptance`** decides an acceptance from the proposed changes
  read in its own command and what only an acceptance reads (`AcceptanceFacts`: the WIP's commits above accepted work,
  and which bookmarks sit below the proposed changes). Refused, in this order: no
  proposed changes (`no_offer`), a WIP gone (`bad_destination`), nothing shown
  (`offer_changed`), divergent proposed changes (`no_offer`), other work than was
  shown or a new conflict (`offer_changed`, ADR-0065), and a destination
  that is not one of the proposed changes' or not below it (`bad_destination`). Its
  destinations are `acceptanceDestinations`': the thread's WIP, then accepted work,
  with how many of the WIP's commits land along. Conflicted proposed changes never
  lands on accepted work: accepted work is immutable, and the conflict would stay in
  its history. A gone WIP has none. An untraced place can be accepted: an
  acceptance moves a bookmark and needs no start.
- **`planStackEnded`**: a split's stack replaces the proposed changes only when its
  top has exactly the tip's files (`acceptStack`, private), built at the
  proposed changes' place from the stack's own start and tip, which its ledger names;
  an untraced place accepts it. **`planRebuild`**, for squash and refresh,
  rebuilds from the lane's tip as one revision on its WIP line, from a known
  start only. Both are a `Rebuild`, as a build is, with the thread's name.
- **`describeWanted`** says proposed changes are one to ask a message for: one
  revision, not edited, on its WIP line unless asked again.
  **`planDescribeAsk`** names the commit to ask for; **`planDescribeSettle`**
  writes the answer only to that commit, read again in the command that
  writes it, keeping the proposed changes' ledger (or the place's tip and start
  without one). **`planDescribeAgain`** refuses `describe` without named
  proposed changes.
- **`proposedChangesStatus`** decodes a `pinetrie.proposed` record once (ADR-0067): `none`,
  `accepted`, `held` or `open`. Every reader on the page switches on it, never
  on the record's fields: the strip, the header's activity badge and the tab's Archive
  item (`openProposed`, client), and the review read (`planReviewRead`). An
  record not yet accepted, with no files, that you did not edit is `held`: its work is
  already where it sits, by a route the ledger does not record (S89), so
  nothing counts it, warns about it, reviews it or accepts it. One you edited
  is `open` whatever its files.
  The host's records not yet accepted, open or held, are `isNotYetAccepted`: the lanes it
  marks on a full observation, and the records `@` rewrites.
- **Proposed changes' record is the page's cache** (ADR-0104): written from the
  repo after each of the host's steps, never read back to decide. Its
  `commits` are the revisions' commits at that read, what a review may
  read. Divergent proposed changes are recorded only once repaired.

## What the page reads (`work-strip.ts`, `base.ts`)

- **`workStripView`** is the work strip's states (ADR-0105) as a decision, from an
  `ProposedChangesStatus`: the proposed changes' state, its buttons, its menu, which of those
  are `quiet` (listed, but drawn disabled: changing nothing now, or not
  yet possible), and the facts its words
  are made from (`WorkStripFacts`: files, size, conflicts, bookmark, held, the
  base as `effectiveBase` gives it, the catch-up, untraced, …). It writes
  no words: accepted work and the button labels are the client's (`workStripWords`,
  `@pinetrie/interface`, ADR-0040). A resolution that asked for you counts only
  when newer than the proposed changes. Held proposed changes are `nothing`, with no
  destinations. When catching up `brings`, or the thread is untraced,
  catching up moves from the menu to the buttons; when it is `current` or
  `nothing-new` it stays in the menu, quiet; `unknown` leaves it there,
  enabled. An untraced thread offers no refresh, squash or split: each
  rebuilds from a start it does not have. A card with the command queued
  makes the proposed changes busy (`catch-up`). Conflicted proposed changes' catch-up is the
  base's `update` (there is no `resolve`), unless its conflict came with
  its copy (`conflictCause`) and the parent, ahead, holds none of those
  files conflicted: then `catch-up-parent`. While the parent is ahead,
  `catch-up-parent` is in every idle state's menu, quiet while it runs.
- **Where an acceptance goes is `workStripView`'s `into`** (`AcceptsInto`):
  a `bookmark` asks `acceptanceDestinations` with it; a `folder`
  asks for none, and keeps `accept`, quiet, since accepting into a folder
  project is not built yet; null, a jj project's accepted work not yet
  read, has no destination, so `accept` is dropped. `WorkStripFacts.into`
  carries it to the words, which name a bookmark only from a `bookmark`.
- **`conflictCause`** says where proposed changes' conflict comes from: `start`
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
  (it moved by work the lane holds, as after you accepted its own proposed changes,
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
    `/review/<REVIEW_WIRE>/review/<span>` and
    `/review/<REVIEW_WIRE>/diff/<span>?path=…`, the span as `spanKey` writes
    it, `<commit>` or `<from>..<to>`; `parseReviewPath` reads them back, and
    calls anything else under `/review/` `bad`, another version included. An
    answer is cached as immutable under its URL, so a change to the
    templates (`REVISION_READ`, `RANGE_FILES`, `@pinetrie/lanes`), the schema
    or `fileDiff`'s flags bumps `REVIEW_WIRE`.
  - `decodeRevisionReview` is the one schema: the host decodes jj's JSON
    with it, and the page the host's answer.
  - `planReviewRead` serves only a revision in open proposed changes' `commits`,
    or a range whose two commits one lane's `pinetrie.revision` records name
    (an ask's work), each read from the record, never the request; and it
    refuses an empty path or one with a control character.
    `answerReview` and `answerDiff` settle what was read: 502 when the
    read failed, 413 past `MAX_DIFF_BYTES`.

# Accepted work and a thread's base (`accepted.ts`, `base.ts`, ADR-0104, ADR-0061, ADR-0072)

| record | namespace | key | written |
|---|---|---|---|
| accepted work: its commit, the WIP bookmarks above it, the publish bookmark and your work against it (`yours.ahead`, `yours.catchUp`), and `publish.catchUp` (`catchUp`) | `pinetrie.accepted` | `line` | when your repo's operation head moves |
| a lane's base, as its newest `Pinetrie-Base` says it, whether a WIP base landed or is gone, what catching up would change and where that was read, and its untraced accepted thread commits (S97) | `pinetrie.base` | the lane | when a refresh reads the lane |

- **`planAcceptedRecord`** is accepted work's record from what the host read
  (`AcceptedFacts`), beside what setting accepted work up would write to your
  repo's config, which `@pinetrie/jj` words (`setupProposal`: jj's config
  text), and `publish.catchUp` from accepted work's config (ADR-0099).
- **`planAcceptedAction`** decides a setup or publish from the record read in
  its own step (`AcceptedWorkDecision`): setup writes exactly the heads and log the
  record proposed, the text you were shown; a publish (`PublishDecision`,
  ADR-0090) says whether the working copy catches up first (`catchUp`) and whether
  your commits move with accepted work (`accept`), both false with
  `publish.catchUp` off. `@pinetrie/jj` turns it into steps (`planSetup`,
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
  because `@pinetrie/jj` does not import this package.
- **`effectiveBase`**, **`catchUpOf`** and **`parentNow`** are in `base.ts`,
  with the `pinetrie.base` record; **`catchUpName`** (accepted work is
  "accepted work", ADR-0090) and **`baseMovedOn`** (a base that moved,
  worded once) in `catch-up-from.ts`. How the page reads them is under
  Proposed changes, "What the page reads".
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
- **`pinetrie.proposed`, `pinetrie.accepted` and `pinetrie.base` are unions on
  the project's kind** (`kind`: `jj` or `folder`, ADR-0150), each decoded by
  its `kind`; one stored before records had a kind does not decode, and
  reads as unknown until the host writes it again. A folder's hold only
  their own fields: proposed changes its `start` and `tip` states, files,
  conflicts and whether it is described; accepted work its
  `newest` state; a base its `start` state and what catching up would
  change. Every reader switches on `kind`: folder proposed changes are never a stack
  and never split (`workStripView`), starts on no conflict (`conflictCause`),
  and is reviewed as its `start..tip` range (`planReviewRead`, whose
  `parseSpan` takes a folder state's id in a range, never as a revision);
  a folder project's accepted work has nothing to set up or publish to
  (`acceptedActionState` refuses both); `catchUpOf` compares a folder
  base's `start` with accepted work's `newest`. At start the host deletes those of the other kind
  (`planKindSweep`, `specs.ts`); a folder's `STATE` and `CONFLICT` records
  are never among them.
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
  read in `@pinetrie/jj` (`wipState`, `readWipState`), since the gather
  needs it to know where proposed changes sit. **`planUpdateFrom`** then says what
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
  chat's (ADR-0117), oldest first, each avoiding the stored names and
  those planned before it. The host runs it through one queue, at start and
  before a new lane's first run, so two threads never plan the same name.
- **`planReserve`** names a thread a column opened before it has a message
  (ADR-0057), as `planNames` would: `known` for an id with a name, `held`
  for one pi holds. So a name can have no lane yet: read names by lane
  (`readNames(doc).get(lane)`), never list them as threads.
- **A name is stored, never recomputed**, so a changed word list renames
  nothing, and never changes: the proposed changes' bookmark and older trailers name
  it. The decoder accepts only `word-word`; `ThreadName` is branded in
  `@pinetrie/core`, and minted only here.

# Icons and banners (`banner.ts`, ADR-0050, ADR-0053, ADR-0143)

| record | namespace | key | written |
|---|---|---|---|
| a thread's banner, drawn or pasted: the image's hash (ADR-0050, ADR-0053) | `pinetrie.banner` | the lane | when a banner is made or set |
| where icons come from, for the page (ADR-0143) | `pinetrie.icons` | `icons` (`ICONS_KEY`) | at host start, when changed |

- **`iconConfig`** builds the host's icon source from the settled
  `icons.source` (one of `ICON_SOURCES`, core; `built-in` when no layer
  sets it) and `icons.model`: a drawn icon's model is the one set, else
  `DEFAULT_ICON_MODEL`. `IconsRecordSchema` takes the same list, so the
  config and the published record cannot accept different sources.
- **Both decisions take whether the host draws** (the source is `drawn`),
  and have no outcome in common. `bannerDue`: a thread just named, or at its
  run's end, gets a drawn one only while the host draws, and when it has
  none and none is being made. `planAsk`, for `set_banner`: a pasted image
  is used when stored, under any source; anything else makes a new one
  while the host draws, and is refused `off` otherwise. The host's shell
  holds no condition of its own.
- **`bannerStillWanted`**: a due one gives way to any banner written
  meanwhile. One the person asked for is always written.
- **`bannerPrompt`** fills the template's `{adjective}` and `{noun}` from
  the thread's name (`threadNameParts`, core) and puts the person's
  direction after it. A record written when banners had a crop still decodes: its `focus`
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

# What a run is told of its canvas (`canvas.ts`, `canvas-pinned.ts`, `context.ts`, ADR-0116)

- **`CONTEXT` is the table of context entries**, one row per kind (the
  canvas list, the canvas's pinned cards, the thread's pinned cards) with
  its decoder, its rule and what `ContextInView` carries of it, in the
  order a run writes them before its prompt: the thread's pinned cards
  last, so its entry stays the prompt's parent. `contextOf` reads a
  compaction's retained tail through it, and `CONTEXT_RULES` are the lines
  `packages/pi` puts in `<rules>`.
- **The canvas list** (`canvasList`): a line per card on the canvas, in
  its order, at most `CANVAS_CAP` (50), the rest counted: its kind, its
  title and who put it there, never its contents, which only pinned cards
  give. `planCanvasRead`
  writes it only when it differs from the newest on the path
  (`canvasInView`), so an unchanged canvas keeps the prompt's cache.
- **A card added or taken while a run goes on** is a fact line steered
  into the lane after the turn in flight, as base news is (S103) (`planCanvasFacts`, `encodeCanvasFact`), never a queued fact
  card, which the drain would pop only after the run. Reorders and widths
  wait for the next run's list.
- **Cards pinned to the canvas** (`canvas-pinned` places, `canvasPinnedOf`) are
  an entry of their own (`pinetrie.canvas-pinned`), compared as a thread's
  pinned cards are, so a thread's cards entry keeps its shape.

# History messages (`history.ts`)

The host's own messages in a thread (update, stack, land, fact, behind,
carry-on, pinned) are pi `CustomMessage`s: `content` is what the model
reads, `details` what pine·trie reads back.

- **History stores the code's own values.** A message's `details` are the
  code's type as it is now, and `historyMessage(customType, schema)` gives
  each kind its `encode` and `decode`: encoding stores the value, and
  decoding is the schema's check alone. A shape change is not migrated by
  default, so a message stored before it does not decode: the column
  leaves it out (core's `renderableMessage` drops a `custom` message it was
  not given a role for), and the model still reads its `content`. When a
  stored word changes, a record migration renames `customType` and
  `details` in every root, raw, and never `content`
  (`apps/pinetrie/host/TECHNICAL.md`, "The stored schemas"). Its
  `merged` or `behind.to` no longer counts either, so a lane may hear its
  base's news once more (`baseKnown`), and a branch read its parent as
  ahead (`parentNow`) until the parent commits again.
- **A state any kind of project has is a point; what only jj has is a
  commit** (ADR-0150). `PointSchema` and `CommitSchema` store the same
  bare string, so a message stored before points decodes unchanged.
  `update`'s `merged`, `land`'s `yours`, `behind`'s `to` and a
  `catch_up`'s `merged` are points; proposed changes, WIPs, accepted work's and a
  base's jj records (`JjProposedChangesRecord`, `JjAcceptedRecord`, `JjBaseRecord`,
  `CatchUpRead`) and the stack's message are jj's, and commits; a base's
  move (`BaseMove`) is points. Where a
  jj-only fact meets the shared history, the rule converts it at that
  site with `pointFromCommit` (`planUpdateFrom`'s WIP, `catchUpOf`'s
  base move), so each crossing is visible; nothing here turns a point back
  into a commit, or tests one for more than equality (core's rule).
- **The schema is the type.** Ids are branded schemas (`decode.ts`:
  `ThreadIdSchema`, `WriterIdSchema`, `CommitSchema`, `PointSchema`,
  `ThreadNameSchema`, `CardIdSchema`), whose `Static` is the brand, and `List` an array whose
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
splits proposed changes: the `proposed-changes-stack` skill, the commit the stack starts from,
the tip it must match, and the bookmark to leave on it.

# Facts, base news and agent commands (`fact.ts`, `behind.ts`, `agent-commands.ts`, ADR-0080)

- **A fact is a history message** (`pinetrie.fact`, role `fact`): `content` is what the model reads, `details` the
  `ProposedChangesFact`, which the column words as one line (`factLine`). Each proposed changes
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
  cards entry, or a steer into a running lane, S103), `catch-up` (a lane whose
  work changes no file, `BaseRecord.work`, is caught up quietly before a
  chat's run: `planMessage`'s `catch-up-first`), or `nothing`. What the thread
  already heard of or merged is read from the tree (`baseKnown`, core), so
  a commit is told once, and again only past a compaction.
- **`planCatchUpCall`** decides `catch_up` from the documents before
  anything is queued: a lane of its own, the only call in its turn (a
  sibling's edit would leave the copy, S103), and new
  work (`brings`, or `unknown`, which the merge's own read decides). The
  parent only when it is ahead and idle. `planCopyReady` (`@pinetrie/core`,
  the one maker of the `ReadyCopy` a merge takes) refuses a working copy
  off its lane's line (`off-line`), and a repo with no bookmark of the
  lane's (`no-bookmark`), for every catch-up. The two are worded apart: the
  missing bookmark was the rename's, not a split's (S114). Each refusal
  says what to do (`catchUpRefusal`); `catchUpAnswer` is the tool's result,
  whose `details.merged` the turn's record reads.
- **`planSplitCall`** queues a split card, made through `planMake`, or
  refuses: a folder lane, whose proposed changes are its files, never a stack; no proposed changes open, a split running (the lane's latest prompt is a
  stack message), or one already queued. The tool answers `SPLIT_QUEUED`,
  or the refusal (`splitRefusal`); a refusal of its card's make (`unmade`,
  which none is) is logged and answered `SPLIT_UNMADE`.
- **A press on a proposal leaves a `branched` fact** in the proposing
  thread, naming who pressed, Start or Open, and the titles of the rows
  pressed. It only tells: whether the proposal is spent is read from the
  thread records ("A proposal's branches", below), since a fact can wait in the
  queue while a later run runs.

# A proposal's branches (`proposal.ts`, ADR-0157, S218)

An agent's `propose_branches` call proposes threads; a person's press opens
them, or opens and starts them.

- **One rule reads a proposal** (`parseProposal`): the tool's arguments
  and the stored result's `details` alike (`decodeProposal` is it, with the
  refusal read as undefined), so what a call proposed and what a page reads
  cannot drift. Titles and briefs are trimmed; none may be blank; at least
  one branch.
- **Spent is read from the thread records**, never the facts: a branch
  opened from a proposal names it and its row in its origin
  (`ThreadFork.proposal`, core), written in the same step as the press,
  and a sweep keeps a thread's record, so a proposal stays spent even once
  every branch is closed. `proposalState` (core) reads it from
  `branchesByProposal`, one pass over the records.
- **The fork is the proposing run's last entry**, a tool result included
  when a Stop left one last: a reply after a Stop goes there too, and the
  message before may hold a call that would then have no result.
- **`planBranchOut` folds `planBranchOpen` over the rows**, each after the
  branch before it, the first after the proposing thread: opened one by one
  after their parent, N branches would land reversed (S218 item 2). Each
  made card is added to the cards the next row plans against. It refuses a
  run still running, a spent proposal, a row past the proposal's end, and a
  canvas that is not the proposing thread's; the codec has already made the
  rows strictly increasing and the threads distinct.
- **Start's message is built here, from the brief** (`agentAsk`, its
  mentions parsed as `planSpinOff` parses its own), so every Start branch
  asks the agent whatever its brief mentions. Only Start's plan carries
  sends (`BranchOutPlan`).

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
  does. What it left conflicted is the proposed changes', and whether the agent asked
  for you is its newest `ask_about_conflict` in the tree
  (`conflictAskedAt`, core), which the strip reads as "needs you" while it
  is newer than the proposed changes' record.

# Agents talking (`relay.ts`, `budget.ts`, `round.ts`, ADR-0128)

Another thread's agent, invited into a thread, is asked there and answers
from its own thread. Who a message invites and asks is `address`
(`@pinetrie/core`), and the chat stores both (`MessageDetails.asks`,
`invites`, absent when none); members, what an agent has heard and whether
a round is done are read from the path (`threadMembers`, `lastHeardEntry`,
`isRoundAnswered`, core). Nothing about them is stored beside the entries.

- **Three history messages.** `pinetrie.heard` (role `heard`, a one-line
  message): what an asked agent was told of the thread that asked, its text
  frozen in `content` (S144), the source ids in `details`. `pinetrie.relay` (role
  `relay`): the ask, the asked agent's prompt, carrying where it came from,
  its asker, its chain's budget and the person behind it (`by`).
  `pinetrie.answer` (role `answer`): the asked agent's last message, in the
  asking thread, a prompt when it `wakes` its asker. Both are prompts
  (`PROMPT_ROLES`), so each is an ask; `transcriptLines` speaks them by
  asker and by thread.
- **`planDelivery`** (`message.ts`) is the one table of where a message into a
  thread goes by its lane's state; `planMessage` and the host's relays and
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
  its limit, its count as of the last write, and `over`. A run's request
  spends what it adds to the talk (`addedTokens`): its output, and the
  context new since the run's previous request; never the context it
  re-reads, which is the whole thread at every request (ADR-0144).
  `planSpend` counts, and returns the record to write only when a spend crosses the
  limit, or at a run's end, so a session write is not made for every model
  request: the host counts what runs spend live (`budgets.ts`). `mayRequest`
  reads it. `agents.budget` is the host's setting, limited by a system
  file.
- **Facts**: `dismissed` and `left` (a member gone, read by `threadMembers`),
  `unanswered`, `round` (what the round told the people) and
  `budget-spent`; a stop the budget made names it (`StopFact.budget`) and
  holds no queue (`planStop`).
- **A late write's gate** (`reach.ts`, `lateAway`): what the host decided
  before a gap lands only in a thread at a live place (`isLivePlace`,
  `canvas-index.ts`), whose late step then loads its root (ADR-0162); a thread not
  opened yet (named for a column before its
  first message) is in no canvas and takes one; a canvas scope (a title's)
  takes one unless it is archived. A refusal is an `Away`, worded by
  `awayWords`. Three readings of whether a thread can take work, each for
  its own question: `holdingOf` (`held.ts`), whether a person's command or
  send may run or write a message there, which decides `planGate`'s held
  step and the drain's `away` (held and trashed refuse); `isLivePlace`,
  whether the host may write there late (held and trashed take it, a trash
  from an archived canvas does not); `threadReach`, whether another
  thread's agent may reach it, and how a refusal is worded (only `open`
  takes one). They differ on two trash places (S199): `threadReach` calls
  a thread trashed from an archived canvas `trashed`, and one trashed from
  an inventory `gone`, since `Reach.trashed` names a canvas. One reader the
  three derive from is not built.
- **Reach** (`reach.ts`): `threadReach` is the one reader of where a
  thread is (open, archived with its record, held by whom, gone), and
  `reachableAgents` every named thread on an open canvas.
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
