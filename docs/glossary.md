# Glossary

One word per concept, in the page, the agent's orientation, the docs, the
code, what is stored and what is sent (ADR-0100). When you write about
pine·trie's work in your repo, use these words. ADRs and findings keep the
words they were written with.

## Your repo

| word | what it is | in code | retired |
|---|---|---|---|
| **accepted work** | The commits finished work lands on, under the bookmark `pinetrie-accepted` (config `accepted.bookmark`). It only moves forward. | `accepted`, `AcceptedRecord`, `AcceptedFacts`, `acceptedBookmark` | the line, the integration line, the project, `onto`, `pinetrie-onto` |
| **accept** | Move an offer into accepted work, or into a WIP: its bookmark moves forward to the offer. | `accept`, `planOfferAcceptance`, `acceptedAs` | integrate, take (of an offer), land, add to the project |
| **accepted-offer commit** | The commit an accepted offer leaves, carrying `Pinetrie-Source`. | `AcceptedOfferCommit`, `acceptedOfferCommits` | integrated-offer commit |
| **offer** | A thread's work, as one revision or a stack, waiting to be accepted, under `pinetrie-offer/<thread name>`. | `offer`, `OfferRecord` | |
| **WIP** | A bookmark (prefix `wip/`, config `wip.prefix`) a thread may start from and be accepted into. | `wip`, `wipPrefix` | |
| **publish** | Move `main` (config `publish.bookmark`) forward to accepted work; with `publish.catchUp` on, catch the working copy up and accept your commits below `@` first (ADR-0099). | `publish`, `publishCatchesUp` | |
| **set up** | Create accepted work's bookmark at your `@-` and write its `immutable_heads()` and `revsets.log` to your repo's config. | `setup`, `planSetup`, `setupProposal` | |

## A thread's work

| word | what it is | in code | retired |
|---|---|---|---|
| **base** | Where a thread started: accepted work, or a copy of a WIP. Its first commit's `Pinetrie-Base` trailer says which (`accepted@<commit>`, or `<wip>@<commit>`). | `base`, `LaneBase`, `BaseTrailer` | the line (as a base) |
| **catch up** | Bring the working copy, or a thread's copy, up to date with what it is based on. Its commit is titled `catch up: accepted work`, `catch up: <thread>`, or `copy of <wip>`. | `catchUp`, `CatchUpFrom`, `catchUpName` | update, follow, bring up to date |
| **lane** | A thread's own copy of your repo, in a container of its own (ADR-0034), named by its thread's id (ADR-0117). | `lane`, `ThreadId`, `laneOf` | |

## Cards and where they are

| word | what it is | in code | retired |
|---|---|---|---|
| **card** | Something present: an identity, one place, and content, which the host keeps; its content's kind decides where it can be, what can be done with it, and how it is drawn (ADR-0126). A text card, a thread card or a note column (ADR-0111, ADR-0116, ADR-0117). | `CardRecord`, `CardId`, `CardKind`, `PLACES_OF` | |
| **surface** | Where cards are put: part of some content or of a person (a task's canvas, a thread's dock, a note column, an inventory). Every place is a surface's, with a rank there (ADR-0111, ADR-0126). | `CardPlace` | |
| **text card** | Unsent text, with a place, drawn in one frame coloured by that place. | `TextCard`, `TextCardId`, `CardPlace`, `CardFrame`, `cardFrame` | |
| **thread card** | A thread, as a card: on a task's canvas or in someone's inventory, one place either way (ADR-0117, ADR-0124). | `ThreadCard`, `threadFace` | a root, as the board and the sidebar draw it; board item |
| **your message** | The text card in your composer at a thread's end, which only you see. | `composing` (stored as `drafting`), `yourCard` | the composer's card, drafting card (yours) |
| **note** | A text card in a note column, which everyone in the task sees and no agent reads (ADR-0116). | `note`, `noteOf`, `notesIn`, `NoteCardEditor` | drafting card, draft; a note below the line on its thread's notes board |
| **note column** | A card on a task's canvas holding notes in one order, titled or "Notes" (ADR-0116). | `NoteColumnId`, `NoteColumnCard`, `NOTE_COLUMN`, `nearestNoteColumn`, `NoteColumn` | notes board |
| **queued card** | A text card above the line, which the agent reads once, when the host pops it. | `queued`, `queuedOn`, `QueuedCardEditor` | |
| **pinned card** | A text card the agent reads on every run, at the top of its thread's column. | `pinned`, `pinnedOf`, `PinnedCardEditor` | |
| **inventory** | Your own grid of cards, text cards and thread cards, on every task and device. A thread there is yours alone, read only and run by nobody (ADR-0124). | `inventory`, `InventoryPanel`, `holderOf`, `ThreadPreview` | |
| **the line** | What divides a thread's queued cards, which the agent reads, from your message, which it does not. | | |
| **the dock** | A column's foot: the queue, the line and your message (ADR-0113). | | |
| **the sidebar** | The column down the left of the page, of your open tasks. | `Sidebar`, `sidebarView`, `OpenThreads` | your list |
| **your open tasks** | The tasks in the sidebar, yours on every device. | `open:<you>` (stored), `OpenThreads` | your list, your open threads |

## Threads

| word | what it is | in code | retired |
|---|---|---|---|
| **thread** | A line of conversation, from where it forks to its end, with an id of its own, which each of its entries names (ADR-0125) and its lane is named by (ADR-0117). Its context is its path to its root. | `ThreadId`, `ThreadRecord`, `threadEnd`, `threadAt`, `ChatAt` | a thread known by its lane, or by its end; `LaneName` |
| **copy** (a thread) | A new thread branched at a thread's end as its copier saw it, put as its own card; its fork row leads back to the original (ADR-0117). | `copy-thread`, `planCopy`, `ThreadOrigin` | |
| **take** (a thread) | Move a thread's card into your inventory: its run stops, and only you open it until you put it on a canvas (ADR-0124). A link to it anywhere else says who has it. | `takenIn`, `runsIn`, `heldIn`, `linkTo`, `ThreadLink` | |
| **root** | A code word, not the interface's: the first message a thread's path leads back to, and the document of every thread that branched from it (`root:<RootId>`), which is also one pi session. Nothing a person reads says "root" (or "tree"): ＋ starts a thread (ADR-0116). | `RootId`, `rootSeed`, `RootRecord` | the root as the board's item, and "root" on screen |

## The past

What is in a thread (ADR-0126). Nothing a person reads calls a kind of
thing a "row" or a "record": those are how a column draws entries and how
a value is stored.

| word | what it is | in code | retired |
|---|---|---|---|
| **entry** | Anything in a thread's past: immutable, with an author and a time. A message or a fact. To change one, fork. | `EntryId`, `EntryLike` | row (as a kind of thing) |
| **message** | An entry a person or the agent wrote. | `TranscriptMessage`, roles `chat` and `assistant` | |
| **fact** | An entry the host wrote: a catch-up, an acceptance, the base's news (ADR-0080). | roles `update`, `land`, `behind`; `OfferFact` | |
| **run** | The agent's work in answer to an ask: the entries it wrote, and any fact steered into it. A run has an ask (ADR-0106). | `AskIndex.work`, `runOf` | |
| **ask** | The message that started a run (ADR-0106). | `askOf`, `indexAsks` (by prompt) | |
| **fork** | The point, at an entry, where threads diverge; not an entry. Forking before an entry edits it (ADR-0043); after it, branches. | `ThreadOrigin.fork` | |
| **derivation** | What the host computes from a thread's entries and replaces as they grow: a digest, a verdict. Never an entry, never a card, never read by the agent; one a model made says so. | `DigestRecord`, `VerdictRecord` | host record (for these), annotation |

## The board

| word | what it is | in code | retired |
|---|---|---|---|
| **task** | The board's card: a piece of work in one workflow state, holding the cards needed to do it, threads of any root among them. | `TaskId`, `TaskRecord`, `TaskIndex` (ADR-0116) | the root as what the board holds; "the root you are on" |
| **workflow state** | A column of the board: Backlog, Doing, or any a team makes. Every task is in one. | `WorkflowState`, `Workflow`, `BoardPlace` | |
| **the archive** | The board's last workflow state, always there, named Done in a new session and renamed as any state is. | `Workflow.archive` | the closed state, the Archive tab |
| **archived** | In the archive: read-only for everyone, unloaded by the host, its threads' offers withdrawn, until moved out (**restore**). | `archivedOf`, `archivedIn`, `planArchive`, `readArchived` | closed |

## The canvas

| word | what it is | in code | retired |
|---|---|---|---|
| **canvas** | Where a task opens: its cards laid out as columns, in an order everyone shares (ADR-0116). | `canvas` (a `CardPlace`), `CanvasCard`, `canvasOf`, `canvasColumns`, `Strip` | |
| **column** | A card on the canvas, opened: a thread's path or a note column (ADR-0116). | `CardColumn`, `Column`, `ColumnKey` | a column as only a thread's path |
| **task column** | The strip's first column, outside the canvas's order: the task's title, state, readers, the cards pinned to the task and the canvas list. | `TaskColumn`, `taskColumnView` | |
| **fold** (a column) | Hide a column for yourself; it keeps its place as a narrow strip with its title. Every column is folded until you open it. | `CardView.unfolded`, `FoldedColumn` | close (a column) |
| **pinned to the task** | A text card every thread's agent in the task reads on every run, in the task column. | `task-pinned`, `taskPinnedOf` | |

## Accepted, not yet built: tasks, the canvas and sources

Words of ADR-0116 to ADR-0119 and ADR-0126, accepted and not yet built.
Nothing in the code uses them yet, beyond a reserved id (`MediaId`,
`FileCardId`); each becomes current as its part is built.

| word | what it is | ADR | replaces |
|---|---|---|---|
| **file card** | A card showing one file of a source: as it is on disk for a live or read-only source, as accepted work has it for a branched one. | ADR-0116 | |
| **media card** | A card showing an image, a video or a piece of art, kept as a blob. | ADR-0116 | |
| **source** | A folder the host's owner registers, which a thread's lane gets in one of three modes. | ADR-0118 | the host's one project |
| **branched**, **live**, **read-only** | A source's modes: its own copy in the lane, whose work comes back as an offer; a read-write mount, never branched; a read-only mount. | ADR-0118 | |
| **runner** | Where a lane runs: the host that holds it, that host's machine, and the model of each run. | ADR-0119 | |
| **content** | What a card holds: a text, a thread, a note column, a task, a fact, a reference. Its kind decides the card's places, acts and renderings. | ADR-0126 | the card's kind (as where it may be) |
| **task card** | A task, as a card, on the board's workflow states. | ADR-0126 | `BoardPlace` as a place of its own |
| **fact card** | A fact on its way into a thread: a card of its own kind, only ever queued, until the thread's end consumes it. | ADR-0126 | a text card carrying a fact |
| **consume** | What a thread's live end does to a card: a send, a spin, a fact popped. The card ends; the entry it became is the record. | ADR-0126 | |
| **block** | Part of a message: a paragraph, a table, code, an image, a tool call with its result. | ADR-0126 | |
| **address** | What names a thread, an entry, a block, a range of text or a card, and optionally its version: with one, a snapshot; without, it follows its target. | ADR-0126 | |
| **reference** | A card holding an address. A link, a quote and a transclusion are its renderings. Edited, it becomes a copy. | ADR-0126 | |
| **origin** | Where a copy came from: an address every copy keeps (a thread's copy does today, `ThreadOrigin`). | ADR-0126 | |
| **margin** | An entry's surface, for notes on it. | ADR-0126 | |
| **comment** | A note on an entry, in its margin: people read it; the agent does once it is queued. | ADR-0126 | annotation |
| **face**, **normal**, **wide**, **whole** | A card's four renderings, which every kind draws: a strip or a grid cell; one column; two columns; an open column or the pane. | ADR-0126 | |
| **preview** | A selected card's normal rendering, read only, in the inventory. | ADR-0126 | |
| **signal** | What a card or a list says by a mark: unsent text of yours, needs you, running, done. Each named for what it says. | ADR-0126 | card marks (the pips, `card-marks.ts`) |
| **in your hand** | Your inventory's selected slot: what the put key puts. | ADR-0126 | |
| **put key** | Puts the card in your hand where focus is: a reference into a text box, the card onto a surface. A reference stays in your inventory; a card of the present leaves it. | ADR-0126 | |

(**thread card**, **copy**, **root**, **note** and **note column** are
built: threads are cards, notes are in note columns, and "root" is a code
word alone.)

## Words that look alike and are not these

- **line**: a line of text (`firstLine`, a column's one-line fact), the
  cards' line in a column (above it queued, below it your message,
  ADR-0048, ADR-0113),
  and Kyneta's command **Line** (`host/control.ts`), one per seat. None of
  them is accepted work.
- **take**: take a card into your inventory (ADR-0083); a thread's run
  stops as it is taken (ADR-0124). Nothing is done to an offer by taking
  it.
- **close**: what × does in the sidebar, for you alone, writing nothing
  shared. Nothing archives by closing.
- **done**: a run's verdict, a ✓ that fades when it ends with nothing to
  do (ADR-0077), and the archive's default name. A thread can be done
  while its task is in Doing.
- **task** and **ask**: a task is a card on the board (ADR-0116); an ask is
  the message that started a run (ADR-0106, ADR-0126).
- **record**: a stored value (`CardRecord`, a host record in `records`),
  never the past. What is in a thread is entries (ADR-0126).
- **row**: how a column draws entries (a tool row, a fork row), a places
  row, an SQL row. Never a kind of thing a person reads about.
- **mark**: a task's title (ADR-0045). The pips that show your unsent
  text are a signal (ADR-0126).
- **copy**: a thread's copy, a new thread at its end (ADR-0117); a copy
  from the past, a card made from an entry, a block or a selection; and
  Cmd+C, which makes that card and writes markdown to the system
  clipboard (ADR-0126). Every copy keeps its origin.
- **fact**: an entry the host wrote, and a fact card, the same fact before
  its thread's end consumes it.
- **column**: a card opened on a task's canvas, and each workflow state's
  column on the board. The board's are **states**.
- **fold**: hiding something on screen (a column, an ask's work, the
  sidebar to icons), and the context merge of `docs/00-vision.md`, a
  branch folded back into its parent (ADR-0010).
- **accept** in plain English: the host accepts a command or a write
  (`acceptsWrite`, a move `accepted`). Only an offer is *accepted* into
  accepted work.

## Where these are configured

`pinetrie.json` in the project, or `$XDG_CONFIG_HOME/pinetrie/config.json`;
the project's value wins (`docs/the-jujutsu-repo.md`):

```json
{ "accepted": { "bookmark": "pinetrie-accepted" },
  "wip": { "prefix": "wip/" },
  "publish": { "bookmark": "main", "catchUp": false } }
```
