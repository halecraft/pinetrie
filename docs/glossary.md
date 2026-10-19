# Glossary

One word per concept, in the page, the agent's orientation, the docs, the
code, what is stored and what is sent (ADR-0100). When you write about
pine·trie's work in your repo, use these words. ADRs and findings keep the
words they were written with.

## Your repo

| word | what it is | in code | retired |
|---|---|---|---|
| **accepted work** | The commits finished work lands on, under the bookmark `pinetrie-accepted` (config `accepted.bookmark`). It only moves forward. A folder project's accepted work is its folder, read into states on its line. | `accepted`, `AcceptedRecord`, `AcceptedFacts`, `acceptedBookmark`, `AcceptsInto`, `FolderAcceptedRecord`, `folderNewest` | the line, the integration line, the project, `onto`, `pinetrie-onto`, your folder |
| **accept** | Move proposed changes into accepted work, or into a WIP: its bookmark moves forward to the proposed changes. | `accept`, `planAcceptance`, `acceptedAs` | integrate, take (of proposed changes), land, add to the project, merge |
| **concurrent save** | A write through a file an app held open across an accept, which landed in the file the accept moved aside: kept as a state of its own on the accept's (ADR-0159). | `StateMade` `concurrent`, `planAsides`, `concurrentStateId` | late write |
| **accepted thread commit** | A commit in accepted work that a thread's work became, carrying `Pinetrie-Source` (ADR-0153). Every commit in accepted work is accepted, yours too, so the name says it was a thread's. | `AcceptedThreadCommit`, `acceptedThreadCommits` | accepted-offer commit, integrated-offer commit |
| **proposed changes**, read as **changes** | A thread's work waiting to be accepted: one revision or a stack under `pinetrie-proposed/<thread name>`, or a folder project's files. People read **changes** ("2 files changed", **accept changes**); code, docs and the agent say **proposed changes**, and *changes* is never bare in code (ADR-0156). | `ProposedChangesInRepo`, `ProposedChangesRecord`, `ProposedChangesStatus`, `proposedBookmark`, `PROPOSED_CHANGES` (`pinetrie.proposed`) | offer |
| **WIP** | A bookmark (prefix `wip/`, config `wip.prefix`) a thread may start from and be accepted into. | `wip`, `wipPrefix` | |
| **publish** | Move `main` (config `publish.bookmark`) forward to accepted work; with `publish.catchUp` on, bring the working copy the latest and accept your commits below `@` first (ADR-0099). | `publish`, `publishCatchesUp` | |
| **working copy** | `@` in your repo, with your commits below it that accepted work lacks (ADR-0172). A lane's is always "the lane's working copy"; to people, a thread's copy. | `workingCopy`, `ERR.WORKING_COPY_CONFLICT`, `workingCopyEdits` | yours, your files, the host's working copy |
| **set up** | Create accepted work's bookmark at your `@-` and write its `immutable_heads()` and `revsets.log` to your repo's config. | `setup`, `planSetup`, `setupProposal` | |
| **tidy** | Cut your repo's op log to a window (seven days by default) with `pnpm tidy`, while no host serves the repo; a starting host logs when one is due (ADR-0155). | `pnpm tidy`, `planTidy` | trim, prune |

## A thread's work

| word | what it is | in code | retired |
|---|---|---|---|
| **base** | Where a thread started: accepted work, or a copy of a WIP. Its first commit's `Pinetrie-Base` trailer says which (`accepted@<commit>`, or `<wip>@<commit>`). | `base`, `LaneBase`, `BaseTrailer` | the line (as a base) |
| **get the latest** | Bring the working copy, or a thread's copy, up to date with what it is based on (ADR-0172). Its commit keeps its jj title, `catch up: accepted work`, `catch up: <thread>`, or `copy of <wip>`, and the agent's tool its id, `catch_up`. | `getLatest`, `LatestFrom`, `latestSourceName`, `GET_LATEST_TOOL` | catch up, catch-up (ADR-0172); update, follow, bring up to date |
| **lane** | A thread's own copy of your repo, in a container of its own (ADR-0034), named by its thread's id (ADR-0117). | `lane`, `ThreadId`, `threadLane` | |
| **work strip** | The row of a column's header that says what became of its thread's files, with its buttons and its ⋯ (ADR-0153). | `WorkStripView`, `workStripView`, `WorkStripButton`, `WorkStripWords`, `.work-strip` | offer view, offer strip |
| **review** | The pane that shows proposed changes' or an ask's revisions, files and diffs, read by commit id (`/review/…`, ADR-0047, ADR-0153). | `ReviewAsk`, `ReviewAnswer`, `parseReviewPath`, `REVIEW_WIRE` | offer read, `/offer/` |
| **ready** | An inbox item for proposed changes you follow, waiting to be accepted; "Dismiss" dismisses it (ADR-0091, ADR-0153). | raised kind `ready`, `dismissReady`, `dismissedReady` | |
| **change id** | jj's id of a revision, kept across its rewrites; never called "change" alone (ADR-0153). | `changeId`, `revisionChangeIds` | change (for the id) |
| **files touched** | Whether a lane's work since its start changes any file: `none`, `some` or `unknown` (ADR-0067, ADR-0153). | `FilesTouched`, `filesTouched` | `WorkChanges` |

## A folder project

| word | what it is | in code | retired |
|---|---|---|---|
| **folder project** | A project whose folder is no jj repo: pine·trie keeps its history itself, as states (ADR-0142). | `ProjectKind` `"folder"`, `startFolderProject` | |
| **state** | A snapshot of a folder project's disk, recorded with its parents: a read of the project's folder, a lane's start, turn or getting the latest. | `StateRecord`, `PointId` | |
| **conflict** | A path getting the latest left conflicted in a folder lane: a record of its three versions' states, shown under `/pinetrie-states/conflicts/`. | `ConflictRecord` | |
| **resolve** | Close a conflict with the version chosen: the lane's own (`ours`), `theirs` or `base`, by the agent's tool or a person's choice on the page. In a folder project it is a state of the lane's own (`resolve`). | `resolve_conflict`, `LaneHistory.resolve`, `planResolve`, `ResolvedFact` | |

## A lane's disk

| word | what it is | in code | retired |
|---|---|---|---|
| **lane's history** | The kind of history a lane's own copy keeps, jj's or a folder's, for its whole life: on its record, a new lane's the kind of the disk it clones. A lane of another kind than the project's is refused, whole and intact (ADR-0150). | `LaneRecord.history`, `ForeignLane`, `laneFits` | a lane's own copy (as a yes or no, `ownCopy`) |
| **point** | A state in the project's history, a lane's or accepted work's, named by an opaque id: a jj commit's, or a folder's snapshot's, read by the kind of the lane it is read in (ADR-0150). | `PointId`, `pointFromCommit`, `commitFromPoint` | a turn's commit (as what lane work names) |
| **state** (of a folder project) | A point of a folder project's history: a snapshot, recorded with its parents when it is made, never changed after (ADR-0142). | `StateRecord`, `STATE`, `planState`, `StateGraph` | |
| **history** (of a folder project) | Accepted work's line of states, newest first, as the history page shows it: each kept one with who made it, when and how (ADR-0165). | `historyView`, `lineStates`, `FolderAcceptedRecord.kept` | |
| **restore** (a state) | Write an earlier kept state of a folder project's accepted work into its folder, as a new state of the line, checked as an accept is (ADR-0165). Not a trashed card's restore, nor an archived canvas's. | `restoreNow`, `RestorePreview`, `writeStateNow` | |
| **merge base** | Where two states' histories last met: their lowest common ancestor; several are merged first into one virtual base, never one chosen (ADR-0142). | `mergeBases`, `planBase`, `BasePlan` | |
| **conflict** (a folder lane's) | A path a merge into a lane could not merge, kept as the lane's, recorded with the states of its base and both sides, whose three versions the lane reads (ADR-0142). | `ConflictRecord`, `CONFLICT`, `planPathMerge` | |
| **source** | A path `.gitignore` does not ignore: what the project is made of, committed and proposed (ADR-0135). | `PathClass` `"source"` | tracked (as a class) |
| **derived** | An ignored path a command made from source: a lane drops it when what it was made from changes, and makes it again. | `PathClass` `"derived"`, `TurnDisk.derived` | recipe output |
| **private** | An ignored path no command made from source, such as `.env`: it stays on its disk, and is never sent. The page counts **private files**. | `PathClass` `"private"`, `TurnDisk.private` | ignored file, local (ADR-0172) |
| **recipe** | A recorded command that made derived files, kept with what it read; never declared. | `Recipe`, `Registry` | `lanes.install` |
| **cache** | A derived directory commands only add to, or one holding a `CACHEDIR.TAG`, such as pnpm's store: kept when its recipe goes stale. | `isCache` | `installCaches` |
| **shared file version** | One write to a file in a shared directory, a thread's or yours; one based on a version another write replaced is concurrent. | `SharedVersion` | |
| **lineage** | A shared file's versions in order, each based on the one its writer last read, and what each thread last read of the file. | `SharedLineage`, `planSharedLineages` | line (of a shared file) |
| **your identity** | Your own ssh keys, in your agent, which a lane uses only once you allow that lane (ADR-0140). | `PersonalSsh`, `PersonalAccess`, `mayUsePersonal` | your ssh agent |
| **service identity** | A key pair in the `ssh/` folder beside your config: a project's or a team's, which every lane uses unasked (ADR-0140). | `serviceKeyCheck`, `startServiceAgent` | |
| **access row** | The row of a column's header that says which ssh identities its lane holds and used, and offers you, its owner, allow, deny or take back (ADR-0140, ADR-0172). | `AccessRecord`, `ACCESS`, `ACCESS_ANSWERS`, `accessView` | approve, refuse, revoke (ADR-0172) |

## Cards and where they are

| word | what it is | in code | retired |
|---|---|---|---|
| **card** | Something present: an identity, one place, and content, which the host keeps; its content's kind decides where it can be, what can be done with it, and how it is drawn (ADR-0126). A text card, a thread card, a note column or a fact card (ADR-0111, ADR-0116, ADR-0117). Every card is made by one rule. | `CardRecord`, `Card<K>`, `CardId`, `CardKind`, `KINDS`, `makeCard`, `planMake` | |
| **surface** | Where cards are put, which some content or a party has: a team's board, a canvas, a thread's dock, a note column's list, a person's inventory. A card is placed on one surface, and has the surfaces its content gives; a surface is data, never a view (ADR-0111, ADR-0126). | `CardPlace` | |
| **content** | What a card holds, beside its identity and its place: a text card's command, a fact, nothing for a thread's card or a note column; later a canvas, a reference. Its kind decides the card's places, acts and renderings (ADR-0126). | `Card<K>`, `ContentOf`, `KINDS`, `cardTextSource` | the card's kind (as where it may be), `CardCarries` |
| **fact card** | A fact on its way into a thread: a card of its own kind, only ever queued, until the thread's end consumes it (ADR-0080, ADR-0126). | `FactCard`, `FactCardId` (`x-`), `planFactCard` | a text card carrying a fact |
| **reference** | A card holding an address and its quote, kept as a blob: a link, a quote, or whole, by where it is drawn. What a paste of a message or a block makes on a surface; edited as text, it becomes a text card that keeps its origin, a paste replacing it (ADR-0126, ADR-0132). | `ReferenceCard` (`q-`), `planPaste`, `planEditAsText`, `messageReference` | taking a copy of a message as bare text; taking a reference from the past |
| **origin** | Where a copy came from: an address a text card made from a reference keeps; a thread's copy keeps its fork (ADR-0126). | `ContentOf.text.origin`, `ThreadOrigin` | |
| **clipboard** | The system clipboard, holding one copy: what copy and cut write and paste lands. pine·trie adds its own data beside the text, and owns nothing there (ADR-0132). | `clipboard.ts` (the page's), `CLIP_MIME` |  |
| **copy** (to the clipboard) | Cmd+C on anything you can read, past or present: written to the clipboard, nothing moved or taken (ADR-0132). | `clipOfFocus`, `planCopy`, `Clip` | Cmd+C taking a reference into your inventory |
| **cut** | Cmd+X on a card you can discard: a copy, then a discard, one undo step (ADR-0132). | `clipOfFocus`'s `cut`, `isDiscardable` | Cmd+X as a take into the inventory |
| **paste** | Cmd+V: what the clipboard holds landed where focus is, a new thing keeping its origin; the first paste after a cut moves the cut card. A selection lands as text; an entry, a block or a card as a link in a text box, as a card on a surface (ADR-0132). | `readPaste`, `putLanding`, `planPut`, `planPaste`, `paste` (the command) |  |
| **clipboard cell** | The chip in the inventory panel's header: the last thing copied in pine·trie, not a slot (ADR-0132, ADR-0171). | `clipboardCellView`, `ClipboardChip` |  |
| **save** | Paste the clipboard cell into a free slot: how a message or a block reaches your inventory, as a reference (ADR-0132); the page says "save to your inventory". | the `save` intent | taking from the past (a message's take, a block's ❝); keep (ADR-0172) |
| **carrier** | pine·trie's data on the clipboard beside the text: `application/x-pinetrie`, and `data-pinetrie` in `text/html`. It counts only when the pasted text is the text it was written with (ADR-0132). | `Carrier`, `CLIP_ATTRIBUTE` |  |
| **replace** (a slot) | A drop or a paste aimed at a filled slot of your inventory: the new card takes the slot, and the one there goes to your trash, one undo step (ADR-0133). | `Landing`'s `replace`, `Replacing` | landing in another empty slot |
| **in your hand** | Your inventory's selected slot: what the put key puts. Every card leaves it when put (ADR-0126, ADR-0132). | `selectedCard` | a reference staying in your hand |
| **put key** | Puts the card in your hand in the column you were last in (ADR-0126, ADR-0132); never into a text box, which a paste types into. | Ctrl+Shift+O, `keyAct` | the put key's link in a text box |
| **text card** | Unsent text, with a place, drawn in one frame coloured by that place. | `TextCard`, `TextCardId`, `CardPlace`, `CardFrame`, `cardFrame` | |
| **thread card** | A thread, as a card: on a canvas, in someone's inventory or a trash, one place either way (ADR-0117, ADR-0124). A thread is a card from the moment its column opens, before its first entry (ADR-0126). | `ThreadCard`, `threadGlance`, `planThreadOpen`, `unstartedThreads` | a root, as the board and the sidebar draw it; board item; a fresh column, a new tab's column |
| **your message** | The text card in your composer at a thread's end, which only you see; at a thread not yet started too (ADR-0126). | `composing` (stored as `drafting`), `yourCard` | the composer's card, drafting card (yours); a fresh card |
| **trash** | Not a place of its own: a discarded card records where it was, and is in the trash of what it left, a canvas's for a column, a note column's for a note, a thread's for your message, your own for your inventory; seen by whoever saw it there, until restored, undone or deleted a week on (ADR-0134). | `trash` (`{ kind: "trash", left }`, stored as `discarded-<kind>`), `DISCARDED`, `surfaceOwner`, `planTrashSweep`, `trashDeadline` | the `gone` place; a person's trash |
| **restore** (a trashed card) | Bring a trashed card back where it was, at its rank: from a canvas column's trash, or by following a link to a trashed thread; anyone who could see it there may (ADR-0134). Refused when that place is gone or taken. Not a canvas's restore from the archive. | `planFromTrash`'s `restore`, `BACK`, `planRestore` | undo |
| **note** | A text card in a note column, which everyone on the canvas sees and no agent reads (ADR-0116). | `note`, `notesTarget`, `notesIn`, `NoteCardEditor` | drafting card, draft; a note below the line on its thread's notes board |
| **media column** | A card on a canvas, in an inventory or in a trash: a title and its images in one order. Images only; video waits for a decision of its own (ADR-0116, ADR-0182). | `MediaId`, `MediaCard`, `MediaColumn`, `MediaColumnView` | media card |
| **image** (a card) | A card in a media column, or in a trash: its versions, its title, and its margin of comments (ADR-0182). | `ImageId`, `ImageCard`, `ImageView`, `put_image` | |
| **version** (of an image) | One of an image's blobs, oldest first, with who added it and when; the newest is drawn, and none is removed (ADR-0182). | `ImageVersion`, `planVersion` | |
| **card's title** | One record for every titled card on a canvas (a note column, a media column, an image), keyed by its id; a canvas's title stays a mark (ADR-0182). | `CARD_TITLE`, `TitledKind` | a note column's title record |
| **note column** | A card on a canvas whose content is a list of notes, titled or "Notes" (ADR-0116). Named by how it is drawn (ADR-0126). | `NoteColumnId`, `NoteColumnCard`, `CARD_TITLE`, `nearestNoteColumn`, `NoteColumn` | notes board |
| **queued card** | A text card above the line, which the agent reads once, when the host pops it. | `queued`, `queuedOn`, `QueuedCardEditor` | |
| **pinned card** | A text card the agent reads on every run, at the top of its thread's column. | `pinned`, `pinTargetKey`, `PinnedCardEditor` | |
| **inventory** | Your own grid of cards, text cards and thread cards, on every canvas and device. A thread there is yours alone, read only and run by nobody (ADR-0124). | `inventory`, `InventoryPanel`, `threadCardHolding`, `ThreadPreview` | |
| **consume** | What a thread's live end does to a card: a send, a fact popped. The card ends; the entry it became is the record. A spin sends its card to the trash instead, so it can be undone (ADR-0126). | | |
| **compact**, **normal**, **full** | The three sizes every kind of card is drawn at, chosen by the surface it is on, each a box of its own: compact, half a column wide, a header row and two lines (an inventory slot); normal, one column wide, its height capped (the bench, a dock, a list); full, one column or more, scrolling (a canvas's column, a card opened on the bench). A folded column's strip and a shut margin's count are no size (ADR-0126, ADR-0171). | `Detail`, `DETAIL_ON`, `Compact`, `cardCompact`, `CompactCard`, `RENDERINGS` | face, whole |
| **bench** | Beside the inventory's grid, the selected slot: a bar of put and trash, then its card normal and read only, or full and editable once opened with Enter or a click, closed by its × (ADR-0171, ADR-0177). | `Bench`, `InventoryState`, `threadPreview` | preview |
| **the line** | What divides a thread's queued cards, which the agent reads, from your message, which it does not. | | |
| **the dock** | A column's foot: the queue, the line and your message (ADR-0113). | | |
| **the sidebar** | The column down the left of the page, of your open canvases; its ＋ makes a canvas (ADR-0158). | `Sidebar`, `sidebarView`, `OpenThreads` | your list |
| **your open canvases** | The canvases in the sidebar, yours on every device. | `open:<you>` (stored), `OpenThreads` | your list, your open threads, your open tasks |
| **the stage** | The page's main area, beside the sidebar: it shows the board or a canvas's strip, and a page such as the profile covers it (ADR-0126). | `#stage`, `Stage`, `showsStage` | the workspace |
| **signal** | What a card or a list says by a mark, each named for what it says: unsent text of yours, needs you, worth a read, running, done (ADR-0126). | `Signal`, `signalWords`, `signalOfLevel`, `statusSignal`, `unsentSignals`, `SignalMark`, `.signal[data-signal]` | card marks, pips; `LEVEL_WORDS`, `LEVEL_CLASS`, `.root-status` |

## Threads

| word | what it is | in code | retired |
|---|---|---|---|
| **thread** | A line of conversation, from where it forks to its end, with an id of its own, which each of its entries names (ADR-0125) and its lane is named by (ADR-0117). Its context is its path to its root. | `ThreadId`, `ThreadRecord`, `threadEnd`, `entryThread`, `MessageAt` | a thread known by its lane, or by its end; `LaneName` |
| **chat** | A thread nobody's agent works in: no lane, so a message naming no one goes to the people in it, and `@agent` asks the agent. Not stored (ADR-0021, ADR-0158). | `CHAT_LABEL`, a `NewColumn` that `opens` `"chat"` | conversation; `chat` for a person's message (`ChatAt`, `ChatDetails`, role `chat`) |
| **focus** (a thread's) | What a thread is doing now, in a few words, in its column's header: named by a model after each of its runs, from its asks and their digests' headlines, and kept while the work goes on (ADR-0173). Not the canvas's title, and not a **topic**, which is a canvas in Topics. | `FocusRecord`, `FOCUS` (`pinetrie.focus`), `ThreadFocus`, `threadFocus`, `.head-focus` | topic (of a thread), cue |
| **agent thread** | A thread whose agent works in it: it has a lane, and a message naming no one asks the agent. Not stored (ADR-0021, ADR-0158). | `agentByDefault`, `AGENT_PREFILL`, `branchPrefill` | agent work (as a kind of thread) |
| **copy** (a thread) | A new thread branched at a thread's end as its copier saw it, put as its own card; its fork row leads back to the original (ADR-0117). | `copy-thread`, `planCopy`, `ThreadOrigin` | |
| **proposal** | The branches an agent's `propose_branches` call offers, each a title and a brief, drawn as one card below its ask's last word. A person's press opens or starts them at the end of the run that proposed them; it is then **spent**, and never pressed again (ADR-0157). | `Proposal`, `proposalState`, `planBranchOut`, `branch-out`, `ThreadFork.proposal` | |
| **put away** (a card, a thread among them) | Move a card into your inventory: a thread's run stops, and only you open it until you put it on a canvas (ADR-0124, ADR-0172). A link to it anywhere else says who has it. | `putAway`, `takenIn`, `runsIn`, `heldIn`, `threadLink`, `ThreadLink` | take (ADR-0172) |
| **member** | Another thread's agent invited into a thread: a mention of it there asks it (ADR-0128). Read from the thread's path, never stored. A member whose thread is no longer on an open canvas is away, and asking it is refused. | `threadMembers`, `AgentCandidate` | |
| **invite** | The first mention of another thread's agent in a thread, which makes it a member without asking it (ADR-0128). | `Address.invites`, `MessageDetails.invites` | |
| **heard** | What an asked agent was told of the thread that asked, copied into its own thread before the ask (ADR-0128). | `pinetrie.heard`, `HeardDetails`, `lastHeardEntry` | |
| **budget** | The tokens agents talking may spend, set by the person's message the talk began from; the runs agents start spend it (ADR-0128). | `pinetrie.budget`, `BudgetRecord`, `createBudgets` | |
| **root** | A code word, not the interface's: the first message a thread's path leads back to, and the document of every thread that branched from it (`root:<RootId>`), which is also one pi session. Nothing a person reads says "root" (or "tree"): ＋ starts a thread (ADR-0116). | `RootId`, `rootSeed`, `RootRecord` | the root as the board's item, and "root" on screen |

## The past

What is in a thread (ADR-0126). Nothing a person reads calls a kind of
thing a "row" or a "record": those are how a column draws entries and how
a value is stored.

| word | what it is | in code | retired |
|---|---|---|---|
| **entry** | Anything in a thread's past: immutable, with an author and a time. A message or a fact. To change one, fork. | `EntryId`, `EntryLike` | row (as a kind of thing) |
| **block** | Part of a message: a paragraph, a table, code, an image, numbered once by its kind in document order (ADR-0126). | `BlockRef`, `textBlocks`, `markBlocks`, `data-block` | |
| **address** | What names a thread, an entry, a block, a range of text or a card; of the past, both a snapshot and a link (ADR-0126). | `Address`, `printAddress`, `parseAddress`, `/a/<address>` | |
| **message** | An entry a person or the agent wrote; a person's is stored as `pinetrie.message`, and sending one is a **send**. | `TranscriptMessage`, roles `person` and `assistant`, `MessageAt`, `MessageDetails`, the `send` command | a chat (as a person's message) |
| **fact** | An entry the host wrote: getting the latest, an acceptance, the base's news (ADR-0080), who stopped a run (ADR-0126). | roles `fact`, `update`, `land`, `behind`; `ProposedChangesFact`, `StopFact`, `QueuedFact`, `AskIndex.stoppedBy` | `pinetrie.stop` |
| **run** | The agent's work in answer to an ask: the entries it wrote, and any fact steered into it. A run has an ask (ADR-0106). | `AskIndex.work`, `entryAsk` | |
| **ask** | The message that started a run (ADR-0106). | `askOf`, `indexAsks` (by prompt) | |
| **fork** | The point, at an entry, where threads diverge; not an entry. Forking before an entry edits it (ADR-0043); after it, branches. | `ThreadOrigin.fork` | |
| **margin** | An entry's or an image's surface, for comments on it; shut, a count beside it; open, the comments under it (ADR-0126, ADR-0182). | place `margin`, `marginCards`, `marginCounts`, `Margin`, `MarginCount` | |
| **comment** | A note on an entry or an image, in its margin: people read it; the agent does once a reference to a comment on an entry is queued (ADR-0126, ADR-0182). | `comment`, `planComment`, `queueReference`, `commentMarkdown` | annotation |
| **derivation** | What the host computes from a thread's entries and replaces as they grow: a digest, a run-end report. Never an entry, never a card, never read by the agent; one a model made says so. | `DigestRecord`, `RunEndReportRecord` | host record (for these), annotation |

## The board

| word | what it is | in code | retired |
|---|---|---|---|
| **canvas** | The card the board, the sidebar and ＋ hold, and its surface: threads and note columns in an order everyone shares, each one or two columns wide, drawn as the strip when it opens (ADR-0116, ADR-0126, ADR-0158). On the board in a workflow state, at its rank there; who moved it there and when is its card's history. | `CanvasId`, `CanvasCard`, `KINDS.canvas`, `CanvasIndex`, `BoardCard`, `planBoardMove`, `boardCanvases`; `canvas` (a `CardPlace`), `CardOnCanvas`, `cardsOnCanvas`, `canvasColumns`, `Strip` (the view) | task (as the card), task card; the root as what the board holds; "the root you are on"; the board place, the task's record (`pinetrie.board`, `pinetrie.task`) |
| **topic** | A canvas in the board's first open state, there so teammates find it. A word for where a canvas is, never stored (ADR-0158). | `CanvasRole` `"topic"`, `canvasRole` | backlog item |
| **task** | A canvas in any open state after the first: work the board tracks. A word for where a canvas is, never stored (ADR-0158). | `CanvasRole` `"task"`, `canvasRole` | task (as the board's card) |
| **workflow state** | A column of the board: Topics, Active, or any a team makes. Every canvas on the board is in one. Topics is the first open state by convention, not a kind of state (ADR-0158). | `WorkflowState`, `Workflow`, `taskBoard`, `defaultWorkflow` | Backlog, Doing (as defaults) |
| **team** | The people who share a board, its canvases and, later, its sources and runners: today, everyone in the session (ADR-0126). | the session | the host's session, as the board's owner |
| **the archive** | The board's last workflow state, always there, named Archive in a new session and renamed as any state is (ADR-0158). | `Workflow.archive` | the closed state, the Archive tab; Done (as its default name) |
| **archived** | In the archive: read-only for everyone, unloaded by the host, its threads' proposed changes withdrawn, until moved out (**restore**). | `tasksInArchive`, `archivedIn`, `planArchive`, `readArchived` | closed |

## The canvas

| word | what it is | in code | retired |
|---|---|---|---|
| **column** | A view, not a card: a card on a canvas, drawn whole, such as a thread's path or a note column (ADR-0116, ADR-0126). | `CardColumn`, `Column`, `ColumnKey` | a column as only a thread's path |
| **canvas column** | The strip's first column, outside the canvas's order: the canvas's title, where it is on the board (a topic, a task, archived), readers, the cards pinned to the canvas and the canvas list. | `CanvasColumn`, `canvasColumnView`, `boardPlaceWords` | task column |
| **fold** (a column) | Hide a column for yourself; it keeps its place as a narrow strip with its title. Every column is folded until you open it. | `CardView.unfolded`, `FoldedColumn` | close (a column) |
| **pinned to the canvas** | A text card every thread's agent on the canvas reads on every run, in the canvas column. | `canvas-pinned`, `canvasPinnedCards` | pinned to the task |

## Accepted, not yet built: file cards, sources and runners

Words of ADR-0116 to ADR-0119 and ADR-0126, accepted and not yet built.
Nothing in the code uses them yet, beyond a reserved id (`FileCardId`);
each becomes current as its part is built. ADR-0168,
proposed, would shelve sources and runners, and have a file card name a
file of the project.

| word | what it is | ADR | replaces |
|---|---|---|---|
| **file card** | A card showing one file of a source: as it is on disk for a live or read-only source, as accepted work has it for a branched one. | ADR-0116 | |
| **source** | A folder the host's owner registers, which a thread's lane gets in one of three modes. | ADR-0118 | the host's one project |
| **branched**, **live**, **read-only** | A source's modes: its own copy in the lane, whose work comes back as proposed changes; a read-write mount, never branched; a read-only mount. | ADR-0118 | |
| **runner** | Where a lane runs: the host that holds it, that host's machine, and the model of each run. | ADR-0119 | |
| **party** | A person or a team: what owns a surface that no content does (an inventory, a trash, a board). | ADR-0126 | |
| **stack** | A card holding two or more threads of one root, one on top, drawn as one column: only the top runs, and which is on top is shared. Not built with the rest. | ADR-0126 | |

(**thread card**, **copy**, **root**, **note**, **note column**,
**consume**, **compact**, **normal**, **full** and **bench** are built, and
listed above: threads are cards, notes are in note columns, and "root" is a
code word alone.)

## Words that look alike and are not these

- **line**: a line of text (`firstLine`, a column's one-line fact), the
  cards' line in a column (above it queued, below it your message,
  ADR-0048, ADR-0113),
  and Kyneta's command **Line** (`host/control.ts`), one per seat. None of
  them is accepted work, and none is a shared file's **lineage**.
- **put away**: put a card away into your inventory (ADR-0083, ADR-0172);
  a thread's run stops as it is put away (ADR-0124). Nothing is done to
  proposed changes by putting it away. A card that leaves a canvas any
  other way is still "taken from the canvas" in the agent's canvas facts.
- **source**: a path `.gitignore` does not ignore (ADR-0135), which is
  built; and a folder the host's owner registers for lanes (ADR-0118),
  which is not. Plain English uses it too: a commit's `Pinetrie-Source`,
  an icon's `icons.source`.
- **close**: what × does in the sidebar, for you alone, writing nothing
  shared, and on a card opened from your inventory, folding it back into
  its slot. Nothing archives by closing.
- **done**: a run's end report, a ✓ that fades when it ends with nothing to
  do (ADR-0077). A thread can be done while its canvas is a task in
  Active.
- **task**, **topic** and **ask**: a task and a topic are a canvas, by its
  state on the board (ADR-0158); an ask is the message that started a run
  (ADR-0106, ADR-0126). A Markdown task list is neither.
- **chat**: a thread with no lane (ADR-0158), and a canvas of chats only,
  labelled "Chat" (`CHAT_LABEL`). A person's message is a message, and its
  sending a send.
- **workspace**: jj's (a lane's own, ADR-0032) and pnpm's (this repo's
  packages). Nothing of pine·trie's is called one: the page's main area is
  the stage, and a board is a team's (ADR-0126).
- **record**: a stored value (`CardRecord`, a host record in `records`),
  never the past. What is in a thread is entries (ADR-0126).
- **row**: how a column draws entries (a tool row, a fork row), a places
  row, an SQL row. Never a kind of thing a person reads about.
- **mark**: a canvas's title (ADR-0045). The pips that show your unsent
  text are a signal (ADR-0126).
- **copy**: a thread's copy, a new thread at its end (ADR-0117); a copy to
  the clipboard, Cmd+C, which moves and makes nothing (ADR-0132); and a
  card a paste makes from what was copied. Every card made from a copy
  keeps its origin.
- **fact**: an entry the host wrote, and a fact card, the same fact before
  its thread's end consumes it.
- **column**: a card drawn whole on a canvas, and each workflow state's
  column on the board. The board's are **states**.
- **fold**: hiding something on screen (a column, an ask's work, the
  sidebar to icons), and the context merge of `docs/00-vision.md`, a
  branch folded back into its parent (ADR-0010).
- **session**: the folder a host serves, as the startup lines and the
  setup page name it: found by its folder's real path, named for people
  (`website`, `website-quiet-fox`), with its own local config and data
  directory (ADR-0149; `SessionName`, `openSession`). In code it is also
  the host's session document (`SessionDocHandle`, its records) and pi's
  session, one per root; neither is what a person reads as a session.
- **accept** in plain English: the host accepts a command or a write
  (`acceptsWrite`, a move `accepted`). Only proposed changes are *accepted* into
  accepted work.

## Phrases nothing says

What people and the agent read never says these, in any case
(`scripts/words.test.ts`). A word in a row's **retired** cell is retired as
that concept's name; a phrase here is retired as English too.

- "your folder": accepted work, for every kind of project, since pine·trie
  may run hosted, where the folder is no one's own.

## Where these are configured

`pinetrie.json` in the project, or `$XDG_CONFIG_HOME/pinetrie/pinetrie.json`;
the project's value wins (`docs/the-jujutsu-repo.md`):

```json
{ "accepted": { "bookmark": "pinetrie-accepted" },
  "wip": { "prefix": "wip/" },
  "publish": { "bookmark": "main", "catchUp": false } }
```
