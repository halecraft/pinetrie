# `@pineta/marginalia` — technical notes

What people write in the margins of the agent's work. Each shape
is stored in pi's extension slots and typed here, by Pineta, which is its single
authority. Every module decodes through `decodeWith` (`decode.ts`), which is
total: a malformed value is dropped, never thrown. `decodeAll` does it for a
namespace's stored values.

Namespaces are stored data and name the owner, `pineta.`, following pi's own
`pi.` convention. They deliberately do not follow the package name: renaming a
package must never require changing stored data.

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

  | a message… | no lane | idle lane | busy lane (running, or messages waiting) |
  |---|---|---|---|
  | plain | `appendToTree` at the end | `appendToLane` | `hold` |
  | compelled `reply`, not raced | `createAndRun` at the end | `run` | `conflict` |
  | compelled `reply`, raced | `conflict` | `conflict` | `conflict` |
  | compelled `queue` | `createAndRun` | `run` | `hold` |
  | `branch` | plain: `appendToTree` at `at`; compelled: `createAndRun` at `at` | the same: a branch never continues a lane | the same |

  A race is another writer's compelled message on the thread's path since what
  the sender saw; plain remarks, agent replies and sibling forks are not. A
  `branch` at a lane's tip is stepping down: a new thread there, the lane left
  where it is.
- **Each chat stores its send's id** (`sendId`, the command's id), so the
  column that sent it finds it exactly (`TreeIndex.bySend`).
  `detailsFromStored` is the one conversion of stored details, for a chat and
  for a held message alike.
- **`renderableMessage`** turns a stored chat into role `chat` with its author
  and whether it compelled the agent, for `core`'s projections, which only
  admit the role and so need no schema library.
- **A chat's images are references** (ADR-0042). `details.images` lists an
  `ImageRef` (hash, type, size) for each `/blob/` image its text shows, in
  order: the host fills it when the message is sent, and a held message keeps
  it. `content` stays the attributed text, so no image's bytes are stored.
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
  expansion, so a message held in the outbox, whose details are encoded
  later, gives the model the same text. `planChat` makes a command compel
  the agent, and refuses an unknown one (`ERR.UNKNOWN_COMMAND`).
- **`pineta.commands`** is a host-written record of every command's summary,
  for the composer's completion. `recordChanged` is how the host writes a
  record at start only when it changed.

# The outbox (`outbox.ts`)

A thread's lane is never written while it runs (S21), so every message for a
busy thread waits in `pineta.outbox`, keyed by its own id (ADR-0016), with a
total decoder like every shape here. An update waits there too (ADR-0038): a
held item is `kind: "chat"` or `kind: "update"`, and a record with no `kind`
decodes as a chat. `heldBy` and `heldRuns` read either kind; `planDrain`
takes a held update, which may run the resolution. Ids are uuidv7, so `heldMessages` sorts
into send order, and `nextHeld` takes a lane's oldest. "A lane with messages
waiting" counts as busy even between two of them, or a new message would jump
the queue. The host executes three pure decisions from here:

- **`planDrain`**: when a lane's run ends, its oldest held message is appended
  (plain) or run (compelled); that run's end brings the next step. A plain
  message is released only once it is written, so a refused append stays held.
- **`settleRun`**: a compelled message pi refuses to run is kept, appended with
  no reply, rather than lost; the author already heard `started`.
- **`planStartup`**: a starting host drains every lane with messages held for
  it, since no run's end will. What does not survive a process (runs and
  streams) is cleared first, by `clearStreams` in `@pineta/schema`.

# Notes (`note.ts`, ADR-0025)

A note is about a message, everyone's to edit, or a draft of a thread's next
message. Its text is its own Yjs document (`NoteDoc` in `@pineta/schema`); its
record is a host-written `pineta.note` value keyed by note id, typed here as
`NoteRecord` (`@pineta/core`) and stored through `encodeNote`/`decodeNote`.

- **`subject` says what a note belongs to**, as a union: the message it is
  about (`entry`); a draft's place, kept as a send carries it (where it was
  started, and its column's lane); or, once sent, the send's id (`sent`: the
  message's origin). `noteEntry` (not exported) finds its message (a sent
  draft through `TreeIndex.bySend`, so a draft still waiting in an outbox has
  none yet); `noteAt` is where it sits now, a draft at its thread's end.
- **`messageNotes` is what the screen draws with each message** (ADR-0043):
  its `about` note, and its `origin` only while that is not done or once it
  has changed since, because until then its text is the message's.
- **A draft is resolved, never stored as an end.** `noteAt` runs `threadOf` from
  its place, as a reply from there would be sent, so the draft follows its
  thread as the thread grows. `draftFor(end, …)` is the draft whose resolved end
  is `end`: one per thread end.
- **`planNote` decides every action**, pure: `open` (a new, empty note about
  a message the index holds, or the one it has; an `origin` note is not one),
  `draft` (the thread's draft, or a new one;
  what its requester had typed is theirs), `send` (only a draft; the host sends
  its text through `sendChat`, the one send path, and marks it sent on
  `appended`, `started` or `queued`), `done` and `reopen`.
- **`planNoteEdit` decides what one edit changes**, pure: contributors are the
  `clientID`s whose clocks moved, as the people behind the seats connected
  when the edit arrived (`noteAuthors`), in order of first edit; an unknown
  `clientID`, the host's own among them, is nobody's. A
  reopened note, once edited, is `changedSinceDone`. It returns null when
  nothing changes, so an edit writes nothing to the session unless it matters.
  `changedSinceDone` is stored, not derived: deriving it would open every note's
  document to filter the index.
- **A sent draft's message is its sender's**, with the others in
  `ChatDetails.contributors`, "Ada, with Bea". The model reads only the
  sender's name.

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
  every intent (a chat's `at`, a note's entry or place via
  `noteAt`), or null for one that writes in no root (a new root, a name, a
  stop, an archive action). `archivedAt` maps that entry to its root's
  record. One rule, applied by the host before dispatch; `sendChat` needs no
  copy, because a sent draft reaches it only through a `note` `send`.
- **Yjs writes are not refused for archiving.** A note's text in an archived
  root stays writable to the host's policy, as ADR-0026 requires (a refused
  write cannot be recovered from, S28); the screen offers no editor there.

# Where lanes work (`work.ts`, ADR-0032 to ADR-0034, ADR-0038, ADR-0039)

Host-written records, each with a total decoder. `encodeWorkRecord` is
the one place their namespaces and keys are chosen, and the agent writes them
through one `setWorkRecord`:

| record | namespace | key | written |
|---|---|---|---|
| a lane's setting: its own copy, or directly in a directory | `pineta.lane` | the lane | once, when the lane is created |
| the commit and disk at an entry | `pineta.revision` | the entry | for every run's prompt, and every assistant message of a lane of its own that made tool calls |
| how a resolution ended | `pineta.landing` | its own id | when its run ends |
| a lane's offer in your repo | `pineta.offer` | the lane | when a trigger changed it, or it was taken |
| a commit you have of a lane: delivered by a take, or a copy of your `@`; a start until a newer copy in the lane's history supersedes it (S51) | `pineta.have` | the commit | at a take, a fork from your `@`, and an update |
| a lane's name, `word-word` | `pineta.name` | the lane | once, at the host's start or before the lane's first run |
| what the host found where it runs: `lanes`, or `direct` and why | `pineta.project` | `project` | at every start |

- **Every run's prompt has a revision record**, so the nearest record above
  any entry names its lane, its commit and its disk (`nearestRevision`, in
  core, finds the nearest commit and the nearest snapshot independently).
  `planTurnRecord` is the rule:
  - A lane of its own records every turn that made tool calls, with its
    snapshot, because ignored files change without a commit. The commit is
    there only when one was made.
  - A prompt with nothing to commit records the lane's newest commit, so a
    branch from it names what its disk was at.
  - A lane working directly records its prompts with neither: it counts as
    the lane above, and the walk passes it.
  - A record from before lane containers has no `snapshot` key, which decodes
    as null. A project record of kind `workspaces` no longer decodes; the
    host rewrites it at start.
- **`forkPoint`** is where a new lane of its own starts: the nearest snapshot
  above it, else the base snapshot; and the nearest commit, else a copy of
  your `@` (ADR-0038), made in the lane on `@`'s parents so the lane sees your
  uncommitted edits. The start is always named: a cloned disk carries its
  parent's working-copy change, and the fork must leave it.
- **`planRetention`** keeps every snapshot of an open root, and each lane's
  newest when the root is archived; the base snapshot is never deleted.
- **`showHostWorkingCopy`** shows a path under your working copy's root as the same
  path under `/mnt/host-working-copy`, whole path prefixes only. `planChat` applies it to a
  message's text when its thread works, or will work, in its own copy, so
  people and the model read the same stored text (ADR-0034).
- **A resolution in progress has no record**: it is a running lane whose
  prompt is a land message. A `running` state would repeat that, and a crash
  would leave it stale. A run whose prompt is a land message ends with its
  outcome, however it started: from an update, the outbox or a resume.
- **`planUpdate`** refuses a lane with no copy of its own, and holds an
  update for a busy lane as it would a message (`isBusy`).
- **`landingOutcome`** is resolved only when the agent did not ask for
  guidance and jj finds no conflicts: the agent can always stop, and can never
  claim a success the repository contradicts (ADR-0033).

# Offers (`offer.ts`, ADR-0038)

A lane's work reaches you as an offer: one revision, or a stack, in your
repo. The decisions are here; the jj steps that carry them out, and where an
offer starts (`offerStart`), are `@pineta/lanes`'s.

- **`planRefresh`** decides what a trigger does, from the lane's tip, where an
  offer would start, and the offer's facts: `build` (none, or the last was
  taken), `follow` (the lane, or where the offer starts, moved under a single
  offer: updated in place, ADR-0039), `withdraw` (where it starts reached the
  tip: nothing left), `stale` (either moved under a stack), `refresh` (only
  the target moved), `leave` (you edited it), `repair` (a race left it
  divergent), or `none`. Where it starts is compared as a set: a merge's
  parents come in any order. `follow` is not `update`, which is "update from
  my work" (`planUpdate`). An offer is edited when any of its
  revisions fails any of three tests against what the host last wrote: the
  description, `jj interdiff`, and the bottom's parent an ancestor of the
  target (S48 item 7). A revision you edit is never touched again.
- **`offerView`** is ADR-0038's state table as a decision: the offer's
  state, its buttons, its menu, and the facts its words are made from
  (`OfferFacts`: files, size, conflicts, bookmark, …). It writes no words:
  the line and the button labels are the client's (`offerWords`,
  `@pineta/client`, ADR-0040). A resolution that asked for you counts only
  when newer than the offer.
- **`acceptStack`** takes an agent's stack only when its top has exactly the
  tip's files.
- **`describeRequest`** is the commit-message request: the skill, your
  repo's recent messages, the thread's messages and the diff. Over its
  budget, the thread's oldest messages go first, then the diff is cut; the
  skill never is. `withTrailers` adds the host's own trailers:
  `Pineta-Thread`, `Pineta-Lane` and `Pineta-Entry`.
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
- **A name is stored, never recomputed**, so a changed word list renames
  nothing, and never changes: the offer's bookmark and older trailers name
  it. The decoder accepts only `word-word`; `ThreadName` is branded in
  `@pineta/core`, and minted only here.

# Updates and stacks (`update.ts`, ADR-0038)

Two pi `CustomMessage`s in `land.ts`'s pattern. An update (`pineta.update`,
role `update`) is a fact in the thread, never a prompt: which of your commits
came in and which files changed, so the agent's next run reads them again.
`updatePrefill` is the composer's editable intent after a clean update. A
stack message (`pineta.stack`, role `stack`) is the prompt of the run that
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

A session is its participants (ADR-0021). `pineta.participant` values are names
keyed by writer id, which is `w-<email>` (ADR-0037); `displayName` gives an
unnamed writer their email's part before the `@`, which the screen shows and
a mention reaches (`normalizeEmail` requires a letter or digit there); `participants` lists every named writer and every writer in
the tree, sorted, which is what a mention resolves against.
