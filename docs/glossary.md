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
| **lane** | A thread's own copy of your repo, in a container of its own (ADR-0034). | `lane`, `LaneName` | |

## Cards and where they are

| word | what it is | in code | retired |
|---|---|---|---|
| **card** | Something you pick up and put down: a text card or a thread card (ADR-0111). | | |
| **text card** | Unsent text, with a place, drawn in one frame coloured by that place. | `CardRecord`, `CardPlace`, `CardFrame`, `cardFrame` | |
| **thread card** | A root, as the board and the sidebar draw it. | `ThreadCard` | board item |
| **your message** | The text card in your composer at a thread's end, which only you see. | `composing` (stored as `drafting`), `yourCard` | the composer's card, drafting card (yours) |
| **note** | A text card below the line, which everyone at the thread sees and the agent does not (ADR-0113). | `note`, `noteOf`, `NoteCardEditor` | drafting card, draft |
| **queued card** | A text card above the line, which the agent reads once, when the host pops it. | `queued`, `queuedOn`, `QueuedCardEditor` | |
| **pinned card** | A text card the agent reads on every run, at the top of its thread's column. | `pinned`, `pinnedOf`, `PinnedCardEditor` | |
| **inventory** | Your own grid of text cards, on every root and device. | `inventory`, `InventoryPanel` | |
| **the line** | What divides a thread's queued cards, which the agent reads, from its notes and your message, which it does not. | | |
| **notes board** | A thread's notes laid out in a grid, in its column's pane (ADR-0113). | | |
| **the dock** | A column's foot: the queue, the line and your message (ADR-0113). | | |
| **the sidebar** | The column down the left of the page, of your open threads. | `Sidebar`, `sidebarView` | your list |
| **your open threads** | The roots in the sidebar, yours on every device. | `open:<you>` (stored) | your list |

## The board

| word | what it is | in code | retired |
|---|---|---|---|
| **workflow state** | A column of the board: Backlog, Doing, or any a team makes. Every root is in one. | `WorkflowState`, `Workflow`, `BoardPlace` | |
| **the archive** | The board's last workflow state, always there, named Done in a new session and renamed as any state is. | `Workflow.closed` (to be renamed `archive`) | the closed state, the Archive tab |
| **archived** | In the archive: read-only for everyone, unloaded by the host, its threads' offers withdrawn, until moved out (**restore**). | `archivedOf`, `archivedIn`, `planArchive`, `readArchived` | closed |

## Accepted, not yet built: tasks, the canvas and sources

Words of ADR-0116 to ADR-0119, accepted and not yet built. Nothing in the
code uses them yet; each becomes current as its part is built.

| word | what it is | ADR | replaces |
|---|---|---|---|
| **task** | The board's card: a piece of work in one workflow state, holding the cards needed to do it. | ADR-0116 | the root as what the board holds; "the root you are on" |
| **canvas** | Where a task opens: its cards laid out as columns, in an order everyone shares. | ADR-0116 | |
| **column** | A card opened on the canvas: a thread's path, a note column, a file or a medium. | ADR-0116 | a column as only a thread's path |
| **fold** (a column) | Hide a column for yourself; it keeps its place as a narrow strip with its title. | ADR-0116 | close (a column) |
| **thread** | A line of conversation, from where it forks to its end, with an id of its own. Its context is its path to its root. | ADR-0117 | a thread known by its lane, or by its end |
| **thread card** | A thread, held by a task or by someone's inventory. | ADR-0117 | a root, as the board and the sidebar draw it |
| **copy** (a thread) | A new thread branched at a thread's end, put as its own card; its fork row leads back to the original. | ADR-0117 | |
| **note column** | A card holding notes in one order, a task's or an inventory's. | ADR-0116 | notes board |
| **note** | A text card in a note column, which everyone in the task sees and no agent reads. | ADR-0116 | a note below the line on its thread's notes board |
| **file card** | A card showing one file of a source: as it is on disk for a live or read-only source, as accepted work has it for a branched one. | ADR-0116 | |
| **media card** | A card showing an image, a video or a piece of art, kept as a blob. | ADR-0116 | |
| **source** | A folder the host's owner registers, which a thread's lane gets in one of three modes. | ADR-0118 | the host's one project |
| **branched**, **live**, **read-only** | A source's modes: its own copy in the lane, whose work comes back as an offer; a read-write mount, never branched; a read-only mount. | ADR-0118 | |
| **runner** | Where a lane runs: the host that holds it, that host's machine, and the model of each run. | ADR-0119 | |

As they are built, these current words change: **thread card** is a thread,
not a root; **note** is a note column's, not a thread's, and the **notes
board** goes; **the dock** is the queue, the line and your message, without
the notes line; **the sidebar** holds **your open tasks**; **the line**
divides a thread's queued cards from your message; and the **inventory**
holds any card.

## Words that look alike and are not these

- **line**: a line of text (`firstLine`, a column's one-line fact), the
  cards' line in a column (above it queued, below it notes and your
  message, ADR-0048, ADR-0113),
  and Kyneta's command **Line** (`host/control.ts`), one per seat. None of
  them is accepted work.
- **take**: take a card into your inventory (ADR-0083). Nothing is done to
  an offer by taking it.
- **close**: what × does in the sidebar, for you alone, writing nothing
  shared. Nothing archives by closing.
- **done**: a run's verdict, a ✓ that fades when it ends with nothing to
  do (ADR-0077), and the archive's default name. A thread can be done
  while its root is in Doing.
- **task** and **ask**: a task is a card on the board (ADR-0116); an ask is
  a message to the agent and its run (ADR-0106).
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
