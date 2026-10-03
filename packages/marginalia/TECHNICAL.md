# `@pineta/marginalia` — technical notes

What people write in the margins of the agent's work. Each shape
is stored in pi's extension slots and typed here, by Pineta, which is its single
authority. Every module decodes through `decodeWith` (`decode.ts`), which is
total: a malformed value is dropped, never thrown. `recordsOf` does it for a
namespace's stored values (`records.ts`, below).

A decoder brands the ids it reads, and its `build` may refuse a value too.
**Every lane is checked with `isLaneName`**: on a record's address for a
record keyed by lane (`laneKey`), and in `build` for a lane in its
contents (as `BANNER` checks `isSha256`). A value whose lane fails is
dropped. That is what keeps a malformed lane out of the host's writes:
`agent.lane` finds any lane pi holds (S71). A card is the exception
(`card.ts`, below).

Namespaces are stored data and name the owner, `pineta.`, following pi's own
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
  its root entry, first line, title, counts, writers, the chats that name
  someone, and its images. The host writes it from `readRootRecord`.
- **`LANE`** is written for every lane as it is created, naming its root;
  `work` is null for a lane with no work of its own.
- **The archive gate** reads the root a command writes in (`writesIn`) and
  that root's record by its root entry (`archivedIn`): a command carries its
  root, so no root's document is opened to check.

Each host record is one `RecordSpec<R, K>`: its `namespace`, `keyOf`,
`encode` and `decode`, exported beside its type (`MARK` in `mark.ts`,
`OFFER` in `work.ts`). Everything else goes through the spec:
`setRecord` and `deleteRecord` build the `ValueWrite`s the host hands
`Agent.writeValues`; `recordsOf` decodes a namespace's values, which
`readRecords` in `@pineta/reads` reads from the document; `setIfChanged`
writes only a record that changed.

- **The address holds the key; the contents never repeat it.** `encode`
  leaves the key field out (`entry`, `root`, `lane`, `id`, `prompt`,
  `peer`, `writer`), and `decode(contents, key)` reads the address with a
  key reader (`entryKey`, `laneKey`, `textKey`, `writerKey`, or `fixedKey`
  for a singleton, in `decode.ts`) and sets the field from it: `decodeAt`
  drops the record when the reader finds no key. So a write and a read cannot disagree on a key, and
  `StopRecord`, `DigestRecord` and `SeatRecord` carry their key in memory
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
- **The singletons** (`LINE`, `PROJECT`, `COMMANDS`) have one fixed key
  (`LINE_KEY`, `PROJECT_KEY`, `COMMANDS_KEY`), and `decode` refuses any other.

# Chat (`chat.ts`)

A human message is a pi `CustomMessage`, `customType: "pineta.chat"` (ADR-0018).
`content` is the attributed text the model reads ("Alice: …"); `details` hold
the author (a `WriterId`, from the transport), the display name as written, the
text, and the `Responder` it compels. `encodeChat` and the total `decodeChat`
are the only code that builds or reads the shape.

- **Who a message is for is `address`** (`@pineta/core`, ADR-0021): `@agent`
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
  the composer's `planSend` (`packages/client/send.ts`) runs it before a send,
  so the button's promise and the host's decision cannot drift apart.
- **`planChat` decides what a message does** (ADR-0020), over the thread
  `threadOf` gives, and names exactly where to write:

  | a message… | no lane | idle lane | busy lane (running, or cards queued) |
  |---|---|---|---|
  | plain | `appendToTree` at the end | `appendToLane` | `busy` |
  | compelled `reply`, not raced | `createAndRun` at the end | `run` | `conflict` |
  | compelled `reply`, raced | `conflict` | `conflict` | `conflict` |
  | `queue` (the host's take) | as `reply` | as `reply` | as `reply` when only cards are queued; `busy` while it runs |

  `busy` writes nothing: the dispatcher queues the chat's card in the same step, and answers `queued` (ADR-0059).
  `queue` is the host's own mode (`PlanMode`; a client sends a `ChatMode`), for a card it takes, which heads the queue
  it is in: so only a run makes the lane busy, and a race does not count.
  | `branch` | plain: `appendToTree` at `at`; compelled: `createAndRun` at `at` | the same: a branch never continues a lane | the same |

  A race is another writer's compelled message on the thread's path since what
  the sender saw; plain remarks, agent replies and sibling forks are not. A
  `branch` at a lane's tip is stepping down: a new thread there, the lane left
  where it is.
- **`createAndRun` names the new lane's id**: the one the sender's column
  reserved, unless pi holds it, else the spare the host made (`newLane`,
  ADR-0057). The host decides every new lane's id here; pi makes none.
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
  (keyed by pi's `source`), else `pineta`, else `plugin.json`'s name, else
  the unscoped package name, else pi's scope. Two sources with one label are
  refused together, as are two commands with one full name in one package.
- **`expandSkill`** is pi's block, byte for byte. **`resolveCommand`** is an
  exact match.
- **A command message** keeps `details.text` as typed and `details.command`
  (`CommandRef`: name, kind, file, hash, expansion). `attributed` reads the
  expansion, so the model reads what the command meant when it was sent. `planChat` makes a command compel
  the agent, and refuses an unknown one (`ERR.UNKNOWN_COMMAND`).
- **`pineta.commands`** is a host-written record of every command's summary,
  for the composer's completion. `setIfChanged` is how the host writes a
  record at start only when it changed.

# Runs and startup (`chat.ts`, `startup.ts`)

- **`settleRun`** (`chat.ts`): a compelled message pi refuses to run is kept,
  appended with no reply, rather than lost; the author already heard
  `started`.
- **`planStartup`** (`startup.ts`): a starting host resumes every lane a
  crash interrupted, whose run's end then drains it, and drains every other
  lane with cards queued for it, since no run's end will. What does not
  survive a process (runs and streams) is cleared first, by `clearStreams`
  in `@pineta/schema`.

# Cards (`card.ts`, ADR-0048, ADR-0059)

What you type is a card. Its text is a `TextDoc`, written by clients; its
record is in the places document (`PlacesDoc` in `@pineta/schema`), which
only the host writes. This module decodes a record, decides where a card
sits, which moves the host accepts, which queued card is taken next, and
which are swept.

- **The stored record is flat strings**, "" for none (`encodeCard`,
  `decodeCard`, total). Where a card is goes through core's `placeFields`
  and `placeOfFields`, which the wire's key codec uses too, so the two
  cannot drift. A drafting or queued card's `at` is never the root; a fresh
  card's `column` is never ""; a queued card has its `lane`, `order` and
  `by`, and `seen`, its text's version as its queuer had it (S72), which
  the queue's key carries from the client. Every field is required: the
  host writes a record whole. A
  `command` this build does not know makes the card malformed. A drafting
  card whose lane fails `isLaneName` keeps its place with no lane: dropped,
  it would be swept with its text at the next start (`planCardSweep`), and
  the lane only says which thread it follows. A queued card with such a
  lane does not decode: its lane is where it runs.
- **A handoff is a compare-and-set on where a card is** (`planMove`, pure):
  accepted only if the card is still where its sender saw it, its `PlaceKey`
  (`sameKey`, over its kind, `at` and lane, or an inventory's holder). A
  key leaves out a queue's order and queuer, so a reorder does not make
  someone else's unqueue fail. No `from` creates the card, its sender its
  owner; no `to` removes it, and only a fresh column's card, or one in the
  sender's own inventory, can be removed. Queueing puts it after the lane's
  last card, queued by the sender, and clears why it was not sent before;
  below the line, or into an inventory, it keeps both. Refusals: `gone` (no
  record), `moved`, `exists`, `not-fresh`, `full`, `not-yours`.
- **An inventory is its holder's alone** (`ownsPlace`): a move into or out
  of someone else's is refused `not-yours`, checked on both ends, and a
  move into yours `full` once it holds `INVENTORY_SLOTS` cards, the card
  itself not counted. A creation obeys both. A taken card keeps its owner:
  a take moves its place, not who wrote it.
- **A fresh column's first send carries its other cards**
  (`planFreshFollow`): each card fresh in the sent card's column goes to
  drafting at the message the send wrote. The host's write, so it keeps
  each card's placer, as `planUnsent` does.
- **The placer is who put the card where it is**: the sender of every
  accepted move. A write the host makes itself keeps it (`planUnsent`,
  `planSetCommand`), so a refusal never names the host.
- **`planMoveCommand`** is a move and the lane to drain: the one the card
  ends queued on, when it is not running.
- **A drafting card is resolved, never stored as an end.** `placeEnd` runs
  `threadOf` from where it started and its column's lane, as a reply from
  there would go, so the card follows its thread as the thread grows.
  `cardEnd` is that for a drafting card; `draftingAt(end, …)` is everyone's
  drafting cards whose end is `end`; `yourCard` is your own at an end or a
  fresh column, never another writer's, and the newest of yours there (ids
  are uuidv7), so a card someone unqueued does not take your composer.
- **The queue is fields, not a list** (S69): `queuedOn(cards, lane)` sorts
  a lane's queued cards by `order`, then id. `orderAfter` keys are
  fixed-width base-36 integers, started mid-range and stepped, so string
  order is numeric order and there is room before and between. Only the
  host assigns them now (`planMove`). `planTake` takes nothing while the
  lane runs, else its top card. `planUnsent` is the step a refused take
  writes back: drafting where it was queued, saying why, never queued.
- **`planCardSweep`**: records whose text is empty and that carry no
  command, and stored `card:` documents with no record, a spent or empty
  card's among them.

# Seats (`seat.ts`, ADR-0048)

Who wrote in a text is in its operations: each carries its seat's Yjs
`clientID`. Only the host knows which person a seat is, and only while it is
connected (ADR-0037), so it writes a `pineta.seat` value per seat as the
seat connects (`SEAT`). It is keyed by the seat's Kyneta peer, the seat's
identity as presence's `seatKey` has it. The `clientID` is in the
contents: Yjs derives it from the peer, which this package cannot.

- **`planSeats`**: the connected seats with no record yet. The connected seats
  come mapped by `seatOf` (`@pineta/schema`), which needs Kyneta's
  `yjsClientId`, which this package does not import.
- **`writersOf(clientIds, seats)`**: the people behind a text's `clientID`s,
  each once, in the order their seats were first seen. A card sent by one
  person names the others this way, in `ChatDetails.contributors`: "Ada, with
  Bea". The model reads only the sender's name.
- **`planSeatSweep`**: seat records no stored text names. A store-less client
  is a new seat on every load, so without it the records would grow with every
  visit. It returns the records, and the host deletes each by its `peer`.
  A seat stored under its `clientID` before ADR-0062 reads with that text as
  its `peer`, which is its address, so the delete finds it.

# The archive (`archive.ts`, ADR-0029)

A root put aside for everyone. The record is a host-written `pineta.archive`
value keyed by the root's entry id, `archived` or `restored`, with who changed
it and when. Archiving writes only the record: entries are immutable, so a root
is hidden and made read-only, never removed, and restoring keeps the record.

- **`planArchive` decides**, pure. A root is anything `rootOf` maps to itself
  (a root is always a message, S30). Archiving is refused `root_busy` while
  `rootWork` lists the root: a lane with its tip there runs, or has messages
  waiting. `ROOT_BUSY_REASON` is the one wording, which the tab's menu shows
  too. The state it already has is `unchanged`, and answered the same.
- **The gate keys on the entry a command writes at.** `writesAt` names it for
  every intent (a chat's `at`, a mark's entry), or null for one that writes in no root (a new root, a name, a
  stop, an archive action, a reservation). `archivedAt` maps that entry to its root's
  record. One rule, applied by the host before dispatch
  (`apps/pineta/host/commands/index.ts`); `sendChat` needs no
  copy, since only the `chat` command calls it. A card's move writes at its
  target's `at`, so no card moves into an archived root; a command on a
  card writes nowhere, and the take's own gate stops a card with one.
- **Yjs writes are not refused for archiving.** A card's text in an archived
  root stays writable to the host's policy (a refused write cannot be
  recovered from, S28); the composer there is read-only.
- **Every planner refuses with core's `Refusal`** (`refused(code, message)`),
  the shape the codec decodes to and the host answers as its `Outcome`
  unchanged, so no package spells it out.

# Marks (`mark.ts`, ADR-0045)

A title on an entry. The record is a host-written `pineta.mark` value keyed
by the entry's id, so an entry has at most one by construction. A root's mark
titles its tab; the page offers marks only on roots, while the host accepts
one on any entry, since the rule is the same everywhere.

- **`planMark` decides**, pure: an entry the index lacks is refused
  `unknown_target`; the title already stored, or clearing an entry with none,
  is `unchanged` and writes nothing; otherwise `write`, or `remove` for a
  cleared title. The last write wins: nobody types a title together.
- **Clearing deletes the record.** A stored empty title would read as chosen.
- **A mark in an archived root is refused by the archive's gate:** `writesAt`
  names a mark's entry, so `planMark` has no check of its own.
- **The title rule is `parseTitle`'s** (`@pineta/core`): trimmed, empty
  clears, one line of at most `MAX_TITLE`. The codec and the page both
  decide by it. The decoder checks only the shape (a non-empty title): the
  host is the session's one writer, and stores only parsed titles.

# Stops (`stop.ts`, ADR-0056)

Who stopped an ask's run: a host-written `pineta.stop` value keyed by the
ask's prompt, holding who and when. pi's entries say only that a run was
aborted (S70), so this is the only place a stop is named. `planStop`
(core) decides it, and writes none when the ask has one: the first press is
the one named. A stop recorded for a run that answered anyway is ignored
(`askOutcome`).

# Digests (`digest.ts`, ADR-0056)

A model's short summary of an ask's work, when `{ "digests": { "enabled":
true } }` is in the user config (`decodeDigestConfig`). A host-written
`pineta.digest` value keyed by the ask's prompt, replaced whole each time:
a value, not a text, since nothing accumulates (ADR-0014). No agent reads
it.

- **`digestDue` is asked on events, never on a timer**: each turn done,
  and the run's end. While the run lasts, only when nothing is asked
  already, someone reads the thread (`readsAsk`, over presence's
  `reading`) and `DIGEST_EVERY` has passed; at the end, once, for the
  final one.
- **`planDigest`** is the decision and the request's parts: `digestDue`,
  then the ask's message as one line and its run's messages, walked up from
  the run's last entry (`AskIndex.last`) and kept to the ask's own. The
  ask's line is worded from its prompt entry (`transcriptLine`), since
  `transcriptLines` leaves out land and stack messages.
- **`digestStillWanted` is the race a write settles:** a live digest asked
  during the run can come back after the final one was written, and is
  dropped. A digest is keyed by its prompt, so no other ask's can land on
  it, as long as the host names the right prompt: it takes the ask from
  the entry an event names, never a lane's tip (`apps/pineta/host/TECHNICAL.md`,
  "Digests").
- **`digestRequest`** is the skill, the ask, the run's newest work that fits
  (`fitNewest`: the oldest is cut first), and the last digest.

# Where lanes work (`work.ts`, ADR-0032 to ADR-0034, ADR-0038, ADR-0039, ADR-0060)

Host-written records, each a `RecordSpec` (above) with a total decoder:

| record | namespace | key | written |
|---|---|---|---|
| a lane's setting: its own copy, or directly in a directory | `pineta.lane` | the lane | once, when the lane is created |
| the commit and disk at an entry, and the paths its commit changed | `pineta.revision` | the entry | for every run's prompt, and every assistant message of a lane of its own that made tool calls |
| how a resolution ended | `pineta.landing` | its own id | when its run ends |
| a lane's offer in your repo | `pineta.offer` | the lane | when a trigger changed it, or it was taken |
| the integration line: its commit, the WIP bookmarks above it, your `@-` against it, and whether this host takes `line` commands | `pineta.line` | `line` | when your repo's operation head moves |
| a lane's base, as its newest `Pineta-Base` says it, and whether a WIP base landed or is gone | `pineta.base` | the lane | when a refresh reads the lane |
| a thread's name, `word-word` | `pineta.name` | the lane | once: when a column reserves the lane (ADR-0057), else at the host's start or before the lane's first run |
| a thread's column banner: the image's hash (ADR-0050, ADR-0053) | `pineta.banner` | the lane | when a banner is made or set |
| what the host found where it runs: `lanes`, or `direct` and why | `pineta.project` | `project` | at every start |

- **Every run's prompt has a revision record**, so the nearest record above
  any entry names its lane, its commit and its disk (`nearestRevision`, in
  core, finds the nearest commit and the nearest snapshot independently).
  `planTurnRecord` is the rule:
  - A lane of its own records every turn that made tool calls, with its
    snapshot, because ignored files change without a commit. The commit is
    there only when the turn has one: made by the host, or made by the agent
    itself and adopted (`commitTurn` in `@pineta/lanes`, S56). Otherwise a
    branch pairs the turn's disk with the commit above, and its `jj new`
    puts that commit's files back.
  - A prompt with nothing to commit records the lane's newest commit, so a
    branch from it names what its disk was at.
  - A lane working directly records its prompts with neither: it counts as
    the lane above, and the walk passes it.
  - A record from before lane containers has no `snapshot` key, which decodes
    as null.
  - Only a turn's own commit carries `paths` (`changedPaths`, ADR-0056): a
    prompt's newest revision is what came before it. A record from before
    paths decodes with none. An ask's file count is the union of its turns'
    paths (`workStats`), so it is what its review lists. A project record of kind `workspaces` no longer decodes; the
    host rewrites it at start.
- **`pineta.line` and `pineta.base` are caches** (ADR-0060): the repo is
  the ledger, and the host rewrites each from it. A lost one costs a read.
- **`forkPoint`** is where a new lane of its own starts: the nearest snapshot
  above it, else the base snapshot; and the nearest commit, else the
  thread's base (`planBegin`): the line's commit, or a WIP's copy on the line
  commit under it. The start is always named: a cloned disk carries its
  parent's working-copy change, and the fork must leave it.
- **`planBegin`** refuses a lane with no line (`no_line`), and a base that
  is not a bookmark with the WIP prefix above the line (`bad_base`). The
  host checks it before the lane is created, so a refused send creates
  nothing.
- **`wipState`** says what became of a WIP base: `ok`, `landed` (its
  bookmark in the line's history, or, with the bookmark gone, the lane's
  copy's source there: a squash or a rebase onto the line) or `gone` (S77
  item 2); with no facts, a base on the line, `ok`. **`planUpdateFrom`**
  then says what bringing a thread up to date merges, from the lane's
  `LaneBase`: the base the thread follows by `effectiveBase`, the rule the
  page's button words itself from, so the button names what is merged. A
  WIP's copy is made `on` the lane's previous copy (`LaneBase.start`);
  nothing when the lane already holds the WIP's commit. The line once a WIP
  landed; refused (`base_gone`) for a gone WIP until "continue on the
  line", which `mark`s the move even with nothing to merge; refused
  (`no_line`) with no line. Only those two codes (`UpdateRefusal`).
- **`takeDestinations`** lists where a take may move a bookmark, the
  default first: the thread's WIP, then the line, with how many of the WIP's
  commits land along. A conflicted offer never lands on the line: the line
  is immutable, and the conflict would stay in its history. A gone WIP has
  none.
- **`planRetention`** keeps every snapshot of an open root, and each lane's
  newest when the root is archived; the base snapshot is never deleted.
- **`showHostWorkingCopy`** shows a path under your working copy's root as the same
  path under `/mnt/host-working-copy`, whole path prefixes only. `planChat` applies it to a
  message's text when its thread works, or will work, in its own copy, so
  people and the model read the same stored text (ADR-0034).
- **A resolution in progress has no record**: it is a running lane whose
  prompt is a land message. A `running` state would repeat that, and a crash
  would leave it stale. A run whose prompt is a land message ends with its
  outcome, however it started: from a card that brought the thread up to
  date, or a resume.
- **`planResolution`**'s prompt names the project's work, and ends with the
  card's text, whole, under its own heading (ADR-0055).
- **`landingOutcome`** is resolved only when the agent did not ask for
  guidance and jj finds no conflicts: the agent can always stop, and can never
  claim a success the repository contradicts (ADR-0033). `landingRecord`
  is the record a resolution's end writes, with that outcome.

# Offers (`offer.ts`, ADR-0038)

A lane's work reaches you as an offer: one revision, or a stack, in your
repo. The decisions are here; the jj steps that carry them out, and where an
offer starts (`offerStart`), are `@pineta/lanes`'s.

- **`planRefresh`** decides what a trigger does, from the lane's tip, where an
  offer would start, whether the lane's work changes any file (`empty`), and
  the offer as your repo holds it (`OfferInRepo`); or, for a thread whose
  root is archived, the offer alone (ADR-0061): `build` (none: never built,
  taken, or gone), `follow` (the lane, or where the offer starts, moved under a single
  offer: updated in place, ADR-0039), `withdraw` (where it starts reached the
  tip, the lane's work changes no file, or the thread is archived, edited or
  not), `forget` (no offer and none to build: a record left from one
  goes), `stale` (either moved under a stack), `refresh` (only
  the target moved), `leave` (you edited it), `repair` (a race left it
  divergent), or `none`. An empty lane is never built: withdrawn after a
  build, it would be built again on the next poll. Where it starts is compared as a set: a merge's
  parents come in any order. `follow` is not `update`, which is "update from
  my work" (`planUpdate`). An offer is edited (`offerEdited`) when its
  bottom's parent is not an ancestor of the target (S48 item 7), a commit of
  yours sits between its revisions, or any revision is edited
  (`revisionEdited`): a version an operation not the host's made changed it
  since the host's newest version (S73). A revision the host never made is
  yours. An offer you edit is never touched again, so nothing the host
  writes can hide your version. Moved (`offerMoved`) is its ledger against
  the lane's tip and start; an offer with no ledger reads as moved, and is
  followed once. The record's `stale` uses the same rule.
- **`offerView`** is ADR-0038's state table as a decision: the offer's
  state, its buttons, its menu, and the facts its words are made from
  (`OfferFacts`: files, size, conflicts, bookmark, the base as
  `effectiveBase` gives it, …). It writes no words: the line and the button
  labels are the client's (`offerWords`, `@pineta/client`, ADR-0040). A
  resolution that asked for you counts only when newer than the offer. An
  open offer with no files is `nothing`: its work is already where it sits,
  by a route the ledger does not record. Behind its base (`baseMoved`: the
  bookmark, and the commits it moved from and to, or null), catching up
  moves from the menu to the buttons; a card with the command queued makes
  the offer busy (`catch-up`).
- **`baseName`** (`work.ts`) is the one wording of a base: "the project"
  for the line, the bookmark for a WIP (ADR-0061). `updateLine` uses it
  through the update's stored `line` flag; an update stored before the flag
  names its base by its bookmark.
- **`acceptStack`** takes an agent's stack only when its top has exactly the
  tip's files.
- **`describeRequest`** is the commit-message request: the skill, your
  repo's recent messages, the thread's messages and the diff. Over its
  budget, the thread's oldest messages go first, then the diff is cut; the
  skill never is. `withTrailers` adds the host's own trailers:
  `Pineta-Thread`, `Pineta-Lane` and `Pineta-Entry`.
- **The review's wire** (ADR-0047) is here, since the host and the page both
  import it:
  - Every read is of a span (`DiffSpan`, ADR-0056): a revision, or a range
    from one commit to another. `reviewUrl` and `diffUrl` build
    `/offer/<OFFER_WIRE>/review/<span>` and
    `/offer/<OFFER_WIRE>/diff/<span>?path=…`, the span as `spanKey` writes
    it, `<commit>` or `<from>..<to>`; `parseOfferPath` reads them back, and
    calls anything else under `/offer/` `bad`, another version included. An
    answer is cached as immutable under its URL, so a change to the
    templates (`REVISION_READ`, `RANGE_FILES`, `@pineta/lanes`), the schema
    or `fileDiff`'s flags bumps `OFFER_WIRE`.
  - `decodeRevisionReview` is the one schema: the host decodes jj's JSON
    with it, and the page the host's answer.
  - `planOfferRead` serves only a revision in an open offer's `commits`,
    or a range whose two commits one lane's `pineta.revision` records name
    (an ask's work), each read from the record, never the request; and it
    refuses an empty path or one with a control character.
    `answerReview` and `answerDiff` settle what was read: 502 when the
    read failed, 413 past `MAX_DIFF_BYTES`.
- **An offer's record is the page's cache** (ADR-0060): written from the
  repo after each of the host's steps, never read back to decide. Its
  `commits` are the revisions' commits at that read, what a review may
  read. A divergent offer is recorded only once repaired.
- **`isWipLine`** is the test for "described": the first line is no longer
  this thread's `wipDescription`. **`describeWanted`** says an offer is one
  to ask a message for: one revision, not edited, on its WIP line unless
  asked again.
- **`withoutTrailers`** drops a last paragraph made only of the host's
  `TRAILERS` (`@pineta/core`), which `withTrailers` writes. A paragraph
  with any other line, your own trailers included, stays.
- **`wipDescription`** is the line an offer carries until an agent describes
  it: `WIP (<name>): <first line>`, the first line being the lane's own first
  prompt (`firstPromptOf`, in `@pineta/core`), not its root's, which every
  branch shares. A follow puts it back when the offer carried the agent's
  message, which no longer describes it.

# Thread names (`names.ts`, ADR-0039)

- **A name is two words**, from `ADJECTIVES` and `NOUNS`, 256 each,
  disjoint, lowercase, 3 to 7 letters: `amber-fox`. The unit test holds the
  lists to that.
- **`threadNameFor`** hashes the lane's id (FNV-1a, 32 bits) into the 65,536
  pairs and takes the next free one, wrapping. The hash spreads ids that
  differ only near their end, as uuidv7s made a minute apart do.
- **`planNames`** names every lane that has none, oldest first, each
  avoiding the stored names and those planned before it. The host runs it
  through one queue, at start and before a new lane's first run, so two
  lanes never plan the same name.
- **`planReserve`** names a lane id a column reserved before its lane exists
  (ADR-0057), as `planNames` would: `known` for an id with a name, `held`
  for one pi holds. So a name can have no lane yet: read names by lane
  (`readNames(doc).get(lane)`), never list them as threads.
- **A name is stored, never recomputed**, so a changed word list renames
  nothing, and never changes: the offer's bookmark and older trailers name
  it. The decoder accepts only `word-word`; `ThreadName` is branded in
  `@pineta/core`, and minted only here.

# Banners (`banner.ts`, ADR-0050, ADR-0053)

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

# Updates and stacks (`update.ts`, ADR-0038)

Two pi `CustomMessage`s in `land.ts`'s pattern. An update (`pineta.update`,
role `update`) is a fact in the thread, never a prompt: which of your commits
came in and which files changed, so the agent's next run reads them again.
The card that brought the thread up to date carries what the person wants
done with it (ADR-0055); its text is sent after the update. A stack message (`pineta.stack`, role `stack`) is the prompt of the run that
splits an offer: the `offer-stack` skill, the commit the stack starts from,
the tip it must match, and the bookmark to leave on it.

# The resolution's prompt (`land.ts`, ADR-0033)

A land message is a pi `CustomMessage`, `customType: "pineta.land"`, like a
chat. Its `content` is what the model reads: the resolution skill, then each
conflicted file with its markers and both sides, labelled `ours` (the lane)
and `theirs` (what comes in), each with why it changed the file. Its `details`
are what the column shows: `landLine`'s one line, from the file count.
`renderableMessage` makes it role `land` with that line, so the column shows the
line, never the prompt.

`planResolution` builds it. Over its budget, each side's reasons are trimmed,
oldest first; the labels, both sides and every file's content are always
kept (ADR-0010). The skill's path and a hash of its content are recorded, so a
surprising resolution can be traced to the policy that produced it.

# Participants (`participant.ts`)

A session is its participants (ADR-0021). A `pineta.participant` value is a
name, a bare string, keyed by writer id (`PARTICIPANT`, read as
`ParticipantRecord { writer, name }`), which is `w-<email>` (ADR-0037); `displayName` gives an
unnamed writer their email's part before the `@`, which the screen shows and
a mention reaches (`normalizeEmail` requires a letter or digit there); `participants` lists every named writer and every writer in
the tree, sorted, which is what a mention resolves against.
