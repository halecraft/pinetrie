# pine·trie — project handoff

**Read this first.** It is the orientation document for anyone (human or agent)
picking the project up cold. The detailed record lives in `docs/`; this
file exists to tell you what matters, what is decided, and what to do next.

> The architectural record lives alongside this file in `docs/` and is
> **tracked**. `00`–`05` are the standing documents; `findings/` holds the 21
> spike reports that are the evidence behind them. This file is the orientation
> layer over the top.
>
> **Implementation plans are not here.** They live in `.plans/`, one per
> change, and are untracked — see `docs/README.md` § Where documents live.
> `docs/` explains why the system is shaped as it is; a plan describes one
> piece of work and is spent once done.

---

## 1. What we are building

A **collaborative agentic harness**: pi's agent core on Kyneta's CRDT substrate,
with the conversation **tree** as the primary object rather than a transcript.

Every mainstream coding agent models a conversation as an append-only linear
transcript. That one choice creates the friction we set out to remove:

- you cannot ask a clarifying question without polluting the main context
- you cannot explore a tangent without derailing the trunk
- you cannot edit an earlier message without destroying what came after
- two people cannot work in the same conversation at all

The underlying interaction is *already* tree-shaped. The interface refuses to
admit it.

**Three capabilities, in order of ambition:** local bifurcation (branch from any
point, run several branches at once) → multiplayer (same tree, live, across
devices) → **merge** (fold a valuable exploration back into the trunk, mediated
by an LLM that sees both divergent branches).

Full statement: `docs/00-vision.md`.

### Branch kinds — the scope lever

| kind | context | tools | workspace | merge |
|---|---|---|---|---|
| **Aside** | full prefix | none | none | fold-in (optional) |
| **Scout** | full prefix | read-only | shared, read-only | fold-in |
| **Worktree** | full prefix | full | isolated (jj) | fold-in **+** file merge |

Aside and Scout are pure conversation-tree operations and cover most daily use.
**Worktree is out of v1** — it needs effect-merge, which is genuinely hard.
*Since ADR-0032 and ADR-0034, every agent lane is a Worktree: a Linux
container on its own disk, with its own jj repo, and a branch clones its
parent's disk. An Aside is a conversation thread. ADR-0033 resolves the
effect merge.*

### Merge is three problems

Conflating these wasted time early, so keep them separate:

1. **Structural** — two peers append under different parents; the tree
   converges. *Free from CRDTs. Not where the work is.*
2. **Context** — what text enters the model's window when a branch lands.
   *The actual product problem.* Solved by a destination-aware three-way fold.
3. **Effect** — filesystem side effects of a branch that ran tools. *Unsolved,
   out of v1,* needs isolated workspaces + a real jj merge, committed atomically
   with the conversation merge. *Decided in ADR-0032 (a revision per turn,
   landing as a jj merge), ADR-0033 (the agent resolves conflicts, and the
   repository decides the outcome) and ADR-0034 (a container and disk per
   lane). Landing is built; folds' file merges are not.*

---

## 2. Where we are

**The walking skeleton walks all five layers**, with automated coverage at each:

```
browser page ─┐
              ├─ Kyneta Line (websocket) ─ Node host ─ pi-agent-core AgentHarness
Node client ──┘                                              │
                                                     KynetaStorage (ADR-0013)
                                                             │
                    json.bind doc ── replicated back ── ┘
```

Twelve spikes resolved, fourteen ADRs, **no open blockers**. The gate was fully
discharged before any non-disposable code was written.

### Current state

| gate | command | status |
|---|---|---|
| lint + format | `pnpm run lint` | clean (Biome, Kyneta's settings) |
| module boundaries | `workspace.test.ts` (in `pnpm test`) | ok |
| unit (pure core) | `pnpm test` | 1875/1875 (Vitest) |
| mutations | `pnpm mutate scripts/mutations/<list>.ts` | 1172 listed; anchors checked in `pnpm test` |
| pi's own Storage suite | `pnpm run conformance` | 21/21 + 21/21 control |
| end-to-end | `pnpm run e2e` | 13 scenarios, 46 checks, on the scripted model (S94) |
| with a real model | `pnpm run e2e:live` | the `live` scenario: 3 checks |
| **real browser** | `pnpm run e2e:browser` | 4 scenarios, 167 checks; in a lane with no containers, the 6 that need one report SKIP |
| test budget | `scripts/budget.test.ts` (in `pnpm test`) | 18 host and lanes scenarios ≤ ⌊√1875⌋; 4 browser ≤ ⌊√18⌋ |
| types | `pnpm run typecheck` | clean (strict) |
| all-but-browser cascade | `pnpm run verify` | green |

41 TypeScript files, ~8 500 lines. Stack: pnpm workspace · TypeScript (strict,
**no build step** — Node 24 strips types natively) · Vite · Vitest · Biome ·
Playwright.

### Layout

```
apps/pinetrie/           @pinetrie/app          host and e2e suites (run, never imported)
apps/conformance/      @pinetrie/conformance  pi's Storage suite vs our adapter
packages/core/         @pinetrie/core         declares NOTHING
packages/schema/       @pinetrie/schema       Kyneta only; the document shape
packages/pi/           @pinetrie/pi           THE pi boundary
packages/protocol/     @pinetrie/protocol     the wire contract and its codec
packages/rules/        @pinetrie/rules        each stored shape and the pure rules about it
packages/reads/        @pinetrie/reads        document reads shared by host and client
packages/lanes/        @pinetrie/lanes        a lane's container and disk, and jj and git in it (ADR-0032–0034)
packages/keeper/       @pinetrie/keeper       declares NOTHING; one step at a time on a resource
packages/repo/         @pinetrie/repo         your repo: reads, steps, the owner (ADR-0038, 0060, 0065)
packages/session/      @pinetrie/session      one client's connection to a host; no React
packages/interface/    @pinetrie/interface    what a person sees and does, for any client; no React, no DOM (ADR-0093)
packages/web/          @pinetrie/web          the browser page: React and the DOM; owns its Vite build
(root)                                      development tooling only
```

Dependency direction is physical: **core → schema, protocol → pi, session → interface → web → app**.
The root declares only tooling, so a package can import only what it declares.

---

## 3. Decisions that constrain everything

Full text with rationale and rejected alternatives: `docs/adrs/`, one file
each.
The ones you must not violate by accident:

**ADR-0009 — entry ids must be unique and coordination-free.** Entries live in a
keyed record, a per-key register (a Loro map when this was decided; `json.bind`
with one writer since ADR-0023, where the hazard cannot arise but the rule
stays). Grow-only-set semantics hold *only*
because each key is written exactly once. A same-key concurrent write **silently
discards one entry — no error, no conflict**. Never derive an id from content,
index, or position. Use pi's default `IdGenerator` (verified safe in S9: a
41-bit monotonic counter, intra-process collision probability exactly 0).

**ADR-0011 — never share a lane (superseded by ADR-0020).** pi keys three
registers by lane name (`pi.branch.tip`, `pi.lane.state`, `pi.lane.config`).
Two writers on one lane silently orphan a whole turn, drop queued steering
messages, and lose an in-flight operation record. That danger still holds; the
answer changed: lanes now belong to threads, the host is their only writer, and
a `LaneName` is always a thread's (`t-`): `laneNameForThread()` and
`parseNewLane()` mint one, and every reader of a stored lane name checks it
with `isLaneName()`, dropping one that fails.

**ADR-0020 — lanes belong to threads and never move; people own none.** A lane
is created where agent work is first wanted in a thread, and its tip is always
the thread's end. Conversation threads have no lane. A running lane is never
written: a message for it is a queued card (ADR-0048), and the host pops
queued cards in order when the lane is idle. A compelled reply another writer
raced is a `conflict`; the sender chooses to queue or branch. Supersedes
ADR-0011.

**ADR-0024 — presence is ephemeral, per open column, written by each client.**
Who is here decays rather than leaving; every column of the tab you are on
reports its thread (ADR-0029).
Rings on the rail, avatars in column headers, typing in the composer; never
yourself. The host refuses client writes to the session.

**ADR-0025 — notes on messages, superseded by ADR-0048.** A note was a
shared text below a message, with done and reopen and an index. Step 3 of
ADR-0048 removed them. A branch from `→` carries a conversation about a
message.

**ADR-0048 — everything unsent is a card.** What you type is a card on its
thread: its text in a Yjs document, which clients write, and its record in
the places document, which only the host writes (ADR-0059); the host places
and moves cards on request, spends one when it is sent, pops queued ones to
send them, and sweeps empty ones. Everyone at a thread's end sees and can edit its
cards. Who wrote in one comes from its `clientID`s, through the host's
`pinetrie.seat` records. Text undo is Kyneta's stack, one per tab; moves are undone
by the host's stacks (ADR-0066). Built
so far: the drafting card (step 1), marks for your unsent cards (step 2),
step 3: notes removed, and queued cards, step 4: your inventory, a
floating 3 × 6 grid you take cards into and put them out of, by key, button
or drag, with moves you can undo (ADR-0066), and step 5: several cards
per place ("+ card", "+ pin"), and pinned cards, a
strip at the top of a thread's column the agent reads on every run, in a
cards entry pi writes with the run's prompt when they changed, carried
across pi's compaction (S92); and step 6's card history and traces: every
card's moves in a session record the host writes in the step that moved
it, and a trace where your card was when someone else moved it while you
were away, deleted once seen (who contributed waits for Kyneta); and step
7's queue control: a thread's queue held until someone releases it, which
Stop does when a message card waits, unqueue all, queued and pinned cards
reordered with Alt+↑/↓ or their ↑ and ↓, and the next card held while
someone types in it (presence `typingIn`). A send
to a busy thread queues your
card above the line, in the host's step that found the lane busy, where
anyone can edit it or unqueue it until the host pops it; the pop and an
unqueue are steps on the host's one serial executor, so an unqueue after
the pop is refused and its client says "already sent" (S69).
`pinetrie.outbox` is gone.

**ADR-0059 — a card's place has one owner at a time.** Built for every
place there is now (drafting, queued, fresh, and your inventory). A place
does not merge (S75), so the host writes every
place in its session (`places`, Yjs since ADR-0066) and settles moves as handoffs, in
arrival order, telling the loser where the card went. A tab draws its move
at once, until its copy of `places` reaches the `rev` the host's reply
carries (a revision watermark), whichever arrives first. Your inventory is a
Yjs document of slots that only your tabs hold and write; the host records
only that a card is in it, and each tab repairs its slots from that, once
a card has been held, or not, for 2 s (S76, S79).
Texts stay CRDTs. Queue and unqueue are handoffs too, a card's command is in
its place record, and the cards document is gone.

**ADR-0055 — a command acts on a card, and is named last.** A card's
`command` is how it is sent; the host carries it out when it pops the card.
The first is "bring up to date": the project's work comes into the thread's
own copy (ADR-0038's update), then the card's text is sent, or carries into
the resolution run when it conflicts. Its button sets the command on your
card at the thread's end. Typed `/` commands stay as ADR-0036 has them.

**ADR-0026 — everything queued is a note, superseded by ADR-0048 and
ADR-0055.** Queued notes were never built; a queued message is a queued card.
The hold while someone types in a queued card is ADR-0048's step 7: presence
`typingIn`, lapsing 3 s after the last keystroke, with no release.

**ADR-0029 — a tab per root, an archive shared by everyone.** A column's
context is its path to its root, so the screen splits there: a root tab has
its own rail and columns (the tab bar, at first everyone's, is now each
person's, ADR-0030). Archiving is a host-written `pinetrie.archive` record; it hides a root
and makes it read-only for everyone, deletes nothing, and is refused while the
agent works there. The Archive tab finds and restores any root; the add tab
starts one. Which tab you are on, and each root's columns, are kept per
browser tab (amends ADR-0027).

**ADR-0030 — your tabs are yours; the header shows who is here, and your
inbox of mentions.** Your tabs are the roots you opened; × closes one for you
and writes nothing, and a root someone else starts opens none. The header
shows, from live data, an avatar per person here and the agent while it works,
each with a menu of their threads. `@` lists the messages that mention you;
which you have seen is kept per device (`localStorage`), never in the
document. Nothing opens a tab by itself.

**ADR-0021 — a thread's mode is its lane; a mention picks the addressee.** A
thread with a lane is agent work, one without is a conversation; nothing is
stored. Mentions pick who a message is for (naming only people leaves the
agent out); with none, the mode fills in. Branches start as conversations; one
from agent work starts with `@agent ` typed, and deleting it at an agent
thread's end steps back down to a conversation; the add tab offers
agent work, or a conversation (ADR-0029). A session is its participants; threads
are topics inside it. Amends ADR-0018 and ADR-0020.

**ADR-0022 — the agent works in its own repo, visibly, with the person's
models.** The development host's agent reads, writes, edits and runs commands
in the repo, with hot reload off (`PINETRIE_TOOLS=0` turns tools off). The host binds to loopback; anywhere else it
admits only the invite key. Models come from the person's pi setup (only the
extensions' providers are applied). Replies and tool output are one kind of
stream, written as text edits; pi's checkpoints are stored the same way. Stop
ends a thread's turn. The session persists in the project's `.pinetrie/pinetrie.db`.

**ADR-0060 — integrated offers stack on an integration line; the repo is the
ledger** (built). Integrating an offer moves one bookmark forward to it,
never your `@`: the line (`pinetrie-onto`, immutable) or a `wip/` bookmark a
thread forked from, each named on the add button; only a clean offer
lands on the line. A thread's base is the line, or a WIP chosen at its
first message (a copy of it, so the WIP stays mutable); "bring up to date"
is always with that base. pine·trie keeps what it needs as trailers on the
commits it makes, and finds yours by ancestry and change id; the session
document becomes a cache. It answers S73 and S74, and replaces
ADR-0038's take (now an integration, ADR-0083), offer start and
`pinetrie.have`.

**ADR-0061 — the integration line is "the project"** (built). The page names places by what they are for:
the project, your files, a thread's own copy, your unfinished work; jj names
go in titles. An offer integration is "add to the project", bringing up to date is
"catch up", and a thread whose base moved on says so, with catching up
beside its offer. The composer says what a send does to your files.
Archiving a root withdraws its threads' offers. "Update my files" rebases
your work onto the line, as you, after a preview from `git merge-tree`
(S80); what conflicts, "resolve with the agent" hands to a thread in your
files.

**ADR-0062 — each host record is one spec** (built). A `RecordSpec` in
`@pinetrie/rules` names a record's namespace, key, encoding and decoding; the host
builds `ValueWrite`s with `setRecord` and `deleteRecord`, and the host
writes them itself into each document's `records` (`Records.writeValues`,
ADR-0095), one batch per document. The address holds a record's key and the
contents never repeat it; old values with a copy still decode. A seat is
keyed by its peer.

**ADR-0063 — a root is a document; what is streaming is another** (built).
The one session document had grown to 124 M characters, and each run's end
rewrote all of it (S84). Now each root is its own document, `root:<RootId>`,
holding its pi storage and the records keyed by its entries;
`pinetrie:session` holds the session-wide records, among them the directory of
roots (`pinetrie.root`), which is the one cross-root read; and `pinetrie:live`
holds streams and active runs. A record's spec names its home, and a command
or a place that points at an entry carries its root (`Spot`). A tab holds
only the roots it shows, and declines the rest; the host holds every root
not archived. A run's end compacts only what it touched. The Archive tab
searches labels. Duane's store was carried over by a one-off script,
since deleted (ADR-0063). With it, a lane's tools and prompt stay put
across runs, so a landing no longer drops the model's thinking (S85).

**ADR-0064 — the search tools run programs pine·trie carries** (built). The lane
runtime carries static rg, fd and sd beside jj, into every lane whatever its
image (S88). The agent's `grep` and `find` are pine·trie's own, run through the
lane's `env`, so pi's "use bash … rg" rule is gone; a direct lane uses pi's
`ensureTool`. The default image also has python3.

**ADR-0065 — one owner for your repo** (built). Offer integrations waited 13–18 s behind
a queue of duplicate refreshes fed by a self-overlapping poll, and held
everyone's chats (S89). Now `@pinetrie/repo`'s owner is the one writer of your
repo: commands before keyed upkeep (`@pinetrie/keeper`), reads pinned to the
head it last observed (S87), its heads watched instead of polled, shared
facts read once per operation and one `jj log` per lane. An integration names the
offer it was shown (`offer_changed`), one person's commands keep their order
by a chain, offer commands and an archive's teardown hold no other command,
and the strip shows a command in flight and why it was refused. An integration now
answers in under half a second, a chat beside it at once.

**ADR-0066 — the host undoes moves, one Kyneta stack per person and root**
(built). Each person has one history of moves per root, a Kyneta undo stack
on the host (`moves:<writer>:<RootId>`), kept in its store and shared by
their tabs. The host decides which root a move enters (`historyOf`): the
root the card goes to, else the one it leaves; creations and removals enter
none. Cmd+Z outside a box undoes your newest move in the root you are on,
whole or refused, naming who moved the card (S82, S91); the page shows each
place as the undo acts. `places` is on Yjs, and `rev` is raised apart from
each move. A keep is one move. A new tab mints its `RootId` as it opens. A
swap in your inventory is undone by the tab's own stack (S90). Histories are
retired 7 days after their root is archived.

**ADR-0067 — what the host cannot tell, it does not act on** (built). The
page counted empty offers, and the host built them, or replayed work you
integrated before offers carried `Pinetrie-Source` (S97). Now whether a lane's work
changes a file is `none`, `some` or `unknown`, from the diff a build
restores, and only a known change from a known start builds an offer. An
integrated-offer commit that names no source makes the lane's start untraced until it catches up.
The page reads one `offerStatus` per offer, so one the line already holds
(`held`) is never counted or warned about. `pinetrie.base` records what
catching up would change, at the tip and base commit it was read at: catch
up is disabled, with its reason, when it would change nothing.

**ADR-0068 — the rail draws branches beside their fork** (built). Rows go
by depth, not depth-first order: a branch starts on the row under its fork,
and takes the leftmost place free for its whole height (`placeRail`). A
track is a branch's colour, by creation order, apart from its place, since
places follow capsule sizes and so presence, which `App` does not read.

**ADR-0069 — the header counts only what needs you, in one activity menu**
(built). The header's ✦ pulsed whenever the agent worked, which was almost
always, and seven triggers looked alike. Now one activity menu holds the
threads ready to add to the project, mentions of you (only once someone has
mentioned you) and where the agent works. Its badge counts open offers and
unseen mentions; running work is a steady count beside it, and nothing in
the header animates. The project stays apart, marked with what is not yet
on main (ADR-0076); your inventory and you sit at the far right. ADR-0091
replaced the menu with your inbox, by your avatar, and counts on the board.

**ADR-0072 — a thread catches up with the thread it branched from** (built).
A branch cloned from a conflicted copy kept that conflict in its offer, even
after it and its parent resolved it alike (S99). Now a thread can catch up
with the thread its copy was cloned from, offered while that one is ahead,
which the document says (`parentNow`); a merge takes a file both sides hold
alike whatever its base; an offer says when its conflict came with its copy;
a branch from a conflicted copy is warned; and a turn's paths are read with
jj, not git, which listed a conflicted commit's every side as files.

**ADR-0073 — a thread's name opens its details** (built). The name and
icon toggle a panel under the header: the icon magnified, spinning in as it
opens, who started the thread and when, where it works, and the `↓` in
full. The reveal of the lane's start moves there, offered only below the
path's first message. Open or closed is the column's, stored like its
density; both are addressed by key, so they work in new tabs and the
Archive preview too.

**ADR-0074 — a model titles a root** (built). When a root's first lane
starts, the host asks a model (`PiSetup.complete`, the run's model unless
`titles.model` names another) for one to three words, written as the root's
mark by the agent; a mark written meanwhile wins. **Auto-update title** in
the tab's `⋯` asks again from the root's messages, and replaces any title.
An untitled root no lane works in is labelled `Chat`. On by default;
`titles.enabled: false` in the user config stops the automatic one.

**ADR-0076 — the project is published to main** (built). The project menu
mixed the line with one working copy, listed paths it could not fit, and
said nothing useful on a host a team shares. Now its first section is the
project's own: how many commits are not yet on `main` (`offers.publish`),
and **publish to main**, which moves that bookmark forward to the line as
the host, on anyone's command, and only as a fast-forward; it does not
push. *Your files* is a second section, only on the host's own machine,
with counts in place of file lists. One rule (`lineActionState`) decides
what may run for the host and the page; the trigger counts unpublished
commits, and a move of `main` outside pine·trie refreshes the line's record
alone.

**ADR-0078 — a column's pane: one place to open what you read** (built).
Beside the thread a column has one pane, holding one thing at a time: the
offer's review, an ask's, a table or a stored image. Every table in a
message has a bar whose ⤢ opens it there, scrolling both ways under its
pinned header row; a click on an image opens it there instead of over the
page. A subject is a name, never data (`paneView` decides what it draws and
when it is gone), and nothing about it is stored. Where the strip can't hold the thread
beside the pane at 40rem (ADR-0087), the pane is a modal dialog over the
page, the first piece of the narrow layout.

**ADR-0079 — a catch-up joins each integrated-offer commit the lane holds to
its source** (built). A thread whose work you integrated conflicted when it
caught up, on any edit you made to that work on the line, its own work
merged twice: an integrated-offer commit is a copy, and the merge's base was
from before it (S102). A branch holding its parent's integrated work did the
same. Now each integrated-offer commit the lane holds a source of is first
joined to it, and the catch-up is clean; a conflict both sides
made still conflicts, on that hunk alone.

**ADR-0080 — commands are host-only or agent-callable, and every command on
a thread leaves a fact in it** (built; its two `e2e:lanes` checks wait for
a Mac). What changes only the
thread's own copy or offer is a tool too: `catch_up`, only when the base or
parent has new work, merging during the run when it is the batch's only call
(S103), and `split_offer`, which queues a split card for the run's end, as
the split button now does. An integration and the line's actions write where others
read, and stay a person's; so does a description, whose skill needs your
repo's history. An integration, a describe, a squash and a refresh write a fact into
the thread through a queued card, popped at once when the thread is idle. A
lane whose work changes files is told its base has new work, at its next
run's start or by a steer while it runs; one whose work changes none is
caught up before its run. A resolution ends like any run (S104):
`ask_for_guidance`, renamed `ask_about_conflict`, works while the copy has
conflicts, and `pinetrie.landing` goes.

**ADR-0082 — after a Stop, Resume carries on with a new turn** (built).
pi cannot continue a run that Stop ended, and parking it instead costs a
wrapping provider and a parked state through the host (S105). So Resume,
in Stop's place while the thread ends with a stopped ask, starts a new run
with a host-written carry-on message, an ask of its own. Anything written
at the thread's end hides it. One rule (`carryOnState`) decides it for the
host and the page.

**ADR-0083 — every domain term names what it acts on and where that goes**
(built). "Take" had meant five things, three of them acts: a card into your
inventory, an offer onto the line or a WIP, and the host's removal of a
lane's next queued card to send it; `planTake` and `Taken` were each
defined twice. Now a person **takes a card into the inventory**, an offer is
**integrated** into the line or a WIP and leaves an **integrated-offer
commit**, and the host **pops the next queued card**. A lane **catches up
with** its base, and an id already used is **in use**. The page keeps its
short labels ("take", "add to the project"). An offer record written
before reads its old `taken` as `integratedAs`.

**ADR-0084 — a resolution's prompt always fits what pi keeps when it
compacts** (built). A 37-file conflict made a 1 MB land message, every file
whole; pi never compacts the newest message, so the run could not start,
and the thread was stuck behind it (S106). Now the budget is pi's
`keepRecentTokens`, measured with pi's own estimate on the whole message.
The files show whole, by their conflict sections, by name or as a count,
whichever fits with each side's newest reason, and `jj resolve --list` is
the list of what is left. A catch-up whose smallest prompt cannot fit is
refused before it merges.
**ADR-0085 — your open roots run down the left; a board in the footer
shows where everyone's work stands** (built). The tab bar did two jobs: your
view, and a sign of shared work. Your list is now yours, down the left edge,
in your order, kept in your own document (`open:`) on every device. The
board is everyone's: every root in a workflow state (Backlog, Doing, Done
in a new session; anyone edits them), its strip in the footer, opened over
the columns. Done is the archive: a root's board place (`pinetrie.board`)
replaces the archive record, and a move into Done is refused while the
agent works there. There is no header; the footer splits where your list's
edge does, you and your inventory under it, the board and what needs you
beside. A backlog item is a conversation root.

**ADR-0086 — the host serves the project its command line names** (built).
`pnpm host [folder]` serves that folder's root, pine·trie's own repo without
one; a relative folder is read from pine·trie's root, since pnpm does not pass
on the shell's directory (S108). Each project keeps its session in its own
`.pinetrie/pinetrie.db`, and the host adds `/.pinetrie/` to the repo's exclude
file first, or refuses to start. The project is a host option apart from
tools, so pi loads the project's settings with tools off too. As it starts,
the host prints the store it opened, the user config it read (or why it could
not), and where its model came from.

**ADR-0087 — a column's pane fills the strip's free width** (built). The pane
was sized against the window, so once your list took the left edge it ran
about 15rem past the strip. `#strip` is now a size container and the pane
`clamp(40rem, 100cqw - 28rem - 1px, 64rem)` (S109); whether it covers the
page is measured on the strip (`narrowStrip`), so folding your list can
bring it back beside the thread. A review wraps long lines and folds its
file list on request, both kept per device.

**ADR-0088 — your list folds to icons** (built). About 3rem wide, from «
at its foot or Ctrl+Shift+L, kept per browser tab, and icons by default
under 56rem. An item is its root's earliest sprite, else two initials on
the root's colour; its signals stay on the icon, and its menu opens on a
right-click. Folded, the footer's corner is your avatar alone, with the
inventory and the inbox in the menu it opens (ADR-0098).

**ADR-0089 — each root seeds its colours** (built). Twelve track colours
(S110) at one lightness and chroma, kept off the attention amber, people's
colours and the review's lines. A root's id picks its trunk's slot and each
later branch steps on by 7, so roots don't all start blue, and a root's
colour (its trunk's) links its tile in your list to its rail and columns.

**ADR-0090 — one publish button** (built). The project menu showed three
refs and offered one action per move between them; "1 new commit in the
project since you last updated" read as something to add. Now the footer
has one **publish** button, shown only with something to publish. On the
host's own machine it catches your files up with the line, accepts your
commits below `@`, and moves `main`, in one act that is refused before its
first step or undone after a failure (`jj op revert`, S111); elsewhere it
moves `main` alone. A refusal is a toast. The line is "accepted work" on the
page, an offer's button is **accept**, and threads and your files both
**catch up**; `land` and `follow` are gone from the code.

**ADR-0091 — your inbox sits by your avatar** (built). The activity menu
sat on everyone's side of the footer while its badge counted only what is
yours. Now your inbox, under your list between your avatar and your
inventory, holds how the threads you follow ended, their work ready to
accept, what is worth a read and your mentions, and carries the page's only
badge, always drawn. Everyone's facts went to the board: each state on the
strip counts its roots the agent works in (◌) and with work ready (⇡), an
item with an open offer carries ⇡, and a root's ring reads lanes running
in any root, not only those this tab holds.

**ADR-0092 — pi is three things to the host** (built). `Agent` carried the
host's writes, the person's pi setup and the agent's lanes at once, so the
host made half its modules first and had them read the agent lazily,
through a getter that threw until it existed. Now `@pinetrie/pi` gives the
scribe (the writes, one pi session per document), the setup (the model's
one-off requests, banners, commands and skills) and the agent (lanes, made
last, with lane work's hooks), and every host module is given values. The
agent's harness is built over the scribe's session for its root, never one
of its own: two over one document drift apart (S113). The scribe ends every
session, and shutdown closes it after the agent. Since ADR-0095 the scribe
carries a thread's appends only.

**ADR-0095 — the host's records live apart from pi's values** (built).
They had been pi values, wrapped and written through a pi session that
nothing read, found by scanning every value, and the session's document
wore pi's whole storage shape. Now each document has `records`, namespace
then key then contents, which the host writes itself (`Records.writeValues`,
`applyRecordWrites`); the session's document is `SessionDoc`, `records`
alone, and a root's is `RootDoc`, pi's storage plus `records`. A read is
one lookup, cached while its namespace is unchanged (S120).
`@pinetrie/schema` holds shapes and the storage edge, and plans nothing: a
stream event's and a run's changes are `@pinetrie/rules`' (`live.ts`).

**ADR-0096 — a starting host checks each stored schema first** (built). A
document opened under a changed schema loses a dropped field's data at the
next compaction (S120), and the host compacts at start. So `startHost`
reads every stored document's schema hash before it opens any, runs the
migrations registered from it (`apps/pinetrie/host/migrations/`), after a
backup and before any write if a record failed to load, or refuses to
start. A migration is deleted once Duane's store has passed it.

**ADR-0098 — your avatar opens a menu; your profile is a page** (built: the
corner, the menu and the page; people's pictures are
`PLAN-2026-10-07-person-pictures`). The corner drew three unrelated styles
side by side, and the avatar opened a form. Now it is your avatar and name,
then the inbox and the inventory as icons of one style; folded, your avatar
alone carries the inbox's badge and its menu holds both. The menu shows who
you are and offers your profile and signing out. The profile is the first
page: it covers the workspace, which stays mounted and inert beneath it, is
named in the URL's hash (`#profile`), and is left by its back button, the
browser's Back, or showing anything in the workspace.

**ADR-0019 — a lane is a line of work, not a unit of parallelism.** A person's
lane is a *conversation lane* and never touches disk. A *work lane* carries
agent work and will own a jj workspace, so creating one is deliberate, and fold
merges both the tree and the workspace. A busy agent queues; it never grows
more lanes. Moving the agent's lane across branches is valid only while its
runs do not touch disk.

**ADR-0013 — `seq` is a derived, replica-local ARRIVAL index.** Two different
mechanisms keep it off the wire, and they are not interchangeable: Line
messages are `Schema.struct`, so an undeclared `seq` is *dropped at the
boundary* (structural); stored entries are `Schema.record(Schema.any())`, where
nothing strips anything and the `findSeqKeys` scan is the only guard. Both
verified by injection. A `LocalSeq` brand was deleted — brands constrain
creation, and the risk here is serialization. The derivation
is `orderNewEntries()` in `packages/core` — pure, and property-tested for
permutation invariance (`test/ordering.test.ts`, 9 cases, ~2 ms, no substrate).
`KynetaStorage` only assigns the seqs it returns. Not convergent,
deliberately. A convergent order and stable integer cursors are **mutually
exclusive**: pi computes `fromSeq: cursor.seq + 1`, so any convergent key lets a
late arrival sort *below* a live cursor and vanish. `seq` must never cross the
wire as a durable identifier — entry `id` is durable. Nothing may render by seq
order; ordering comes from the `parentId` walk.

**ADR-0016 — never race a child container.** A child container created
lazily under a record key loses one writer's contents when two replicas create
it concurrently (S18: 0/40 trials). Lazily created containers must be keyed by
globally unique ids; where writers can share an address, store one leaf
register per address. That is why pi's `values` stay flat under an opaque
`physicalKey`.

**ADR-0015 — entries are a TYPED row**, not `Schema.any()`. Kyneta is
schema-first: with `any()` the catamorphism has nothing to walk, so validation,
typed reads, observation granularity and indexes are all forfeited for the
document's primary content. A flat `struct.json` with six columns — `id`,
`parentId`, `type`, `timestamp`, `fromId`, `payload` — and `Schema.any()` at
`payload` only, where the pi boundary forbids naming `AgentMessage` /
`JsonValue` / `Usage`. `type` is *unconstrained*, so a new pi `EntryType` needs
no schema change; a `discriminatedUnion` was rejected for demanding one every
time. `.json()` because entries are written once, making per-field CRDT merge
unused machinery. **S17/P1: Kyneta's migration walk cannot reach inside a
`Schema.record`, so no entry-shape change is migratable** — keep the typed
surface small, and treat changes as coordinated upgrades.

**ADR-0014 — token deltas stream into a durable `Schema.text()`** via
`insert(at, delta)`, cleared on commit. **Never `Schema.string()` for anything
that accumulates** — it is a whole-value LWW register, so appending is O(n²) on
*every* substrate (measured: 144 582 B vs 18 131 B for the same stream).

**ADR-0010 — a fold is destination-relative.** Summarize at *landing* time, not
at leave time, with a three-way structure: `base` = path to the LCA (sent once),
`theirs` = the folded leg, `ours` = the destination leg. The `ours` leg is
**mandatory** — dropping it is a correctness regression, not a quality one (S5's
ablation: without it the model confidently recommends a design the destination
already rejected).

**ADR-0012 — the trunk is a derived value over an append-only promotion DAG**,
not a mutable pointer. `prev` is a *list*, so a promotion resolving a fork
extends every leaf it supersedes. Two concurrent folds onto one trunk tip are a
semantic conflict in *any* representation; this makes it fail **loudly**
(`leaves.length > 1` is a queryable "unresolved trunk fork").

**ADR-0008 — the conversation tree is explicit (`parentId`); Loro's version
history is infrastructure.** A CRDT op-DAG is a *merge* DAG, not a *branch* DAG:
two branches in one `Schema.text()` converge into a single linear transcript.
jj makes the same split (operation log vs commit DAG).

---

## 4. Hard-won context you would otherwise rediscover

### The recurring failure mode

Four times, a **measurement apparatus drifted out of alignment with the thing it
measured**, and each time it produced a confident wrong answer:

- S11's control ran without a subscriber, so it measured a different code path
  and concluded the bug was in Kyneta's binding. It was upstream in loro-crdt.
- S4's observer was a 1 ms poller, read as substrate behaviour. The "connected
  client loses text" finding was an off-by-one in the *test*.
- `check-boundaries` walked only `.mjs`, so it silently stopped enforcing the
  architecture as each file converted to `.ts`.
- A probe "proved" pnpm strictness while its install had silently failed.

**The defence that works is a negative control: prove the check can still fail.**
There are permanent ones for convergence, seq, trunk semantics, and boundaries.
*A check without a proof that it can fail is not yet a check.*

### Sandbox (`~/.config/pi-jail/policy.json`)

`allowWrite` is a **whitelist** (`"."` = the session's cwd); `denyWrite` carves
exceptions *inside* it; reads are open with a `denyRead` blacklist.

- **pnpm 12 cannot reach the registry** — its Rust fetcher validates through the
  macOS keychain and cannot see the sandbox CA. `packageManager: "pnpm@10.18.0"`
  routes through corepack's Node fetcher. **Do not remove that pin.**

### Kyneta

Local workspace at `~/halecraft/kyneta`, wired by `link:` deps. **Published
`@kyneta/*` 3.0.0 is unusable** — it predates the O(δ) write fix and declares a
`loro-crdt` floor of `>=1.8.0` where the real floor is `>=1.13.4`. A stale
build is refused at load: Node refuses a module whose named import is missing
before any of it runs (S47), and the host imports what v4 added (`whenPeer`,
`yjsClientId`). pine·trie tracks the local checkout's `needed-by-pinetrie`
bookmark, Kyneta v4 as of `PLAN-2026-09-28-kyneta-v4`.

Three issues were filed to the Kyneta team (`docs/findings/kyneta-issues-verification.md`):
`compact()` throws on live Loro docs (**moot for pine·trie** since ADR-0023: the
session is `json.bind`, compacted live, and ADR-0014's ~5.6 KB residue per
message is gone); the `Line` schemaHash collision (**fixed**); and
the ephemeral wire cost (**withdrawn — our error**, we used `Schema.string()`
where `Schema.text()` was the right primitive).

### pi

Pinned exactly at **0.87.1** across three packages. pi is mid-rewrite into a
distributed architecture (coordinator → server → worker-per-session → N
clients) behind `PI_EXPERIMENTAL=1`; we deliberately embed `pi-agent-core`
directly and use none of it (ADR-0001). `Storage` is a real supported port with
a conformance suite — that is the single deep coupling, and it survived the
0.85 → 0.87.1 bump unchanged.

---

## 5. What makes this codebase unusual — respect these

**The pi boundary is correct-by-construction, not checked.** `@earendil-works/*`
is declared *only* by `packages/pi` and `apps/conformance`. pnpm's
`node_modules` is strict, so from the app every spelling fails at resolution —
`import()`, a template literal, `createRequire`. This replaced a syntax scan
that **all three evaded**. Every other package boundary now works the same way:
the root declares only tooling, so a package can import only what it declares.
`workspace.test.ts` checks the manifests. See `docs/01-architecture.md`.

**ADRs are encoded as types where possible.** Entry ids, run ids and lane
names are branded (`EntryId`, `RunId`, `LaneName`), so a swapped argument is
a compile error. They are minted where they enter: the protocol codec, the
reads (`renderableEntry`), the schema's readers, `@pinetrie/rules`' decoders, a
commit's trailer (`packages/lanes`), the pi adapter, the client's stored forms,
and the host's id generator. Biome's `noRestrictedImports` (`biome.json`)
refuses `entryId` in core, the client and the host, and `runId` in core and
the client (S95). A `LocalSeq` brand was deleted (ADR-0013
above); `projectTranscript(entries, tipId)` cannot even accept a seq.

**FC/IS — gather → plan → execute. Decisions are values.** `packages/core` is
pure and imports nothing; the shell in `host/` performs the decision. This
mirrors pi's own lane loop.

**No build step.** Node 24 strips types natively, so imports name the real file
(`./index.ts`). Native stripping does **not** support enums, namespaces,
parameter properties, or decorators.

---

## 6. What to do next

**The stack is complete.** `packages/web/app.tsx` is React, rendering from the same
Exchange `connectSession` (`@pinetrie/session`) already owns (handed to `ExchangeProvider`), so Node
and browser still share one connection story and `e2e` drives the real thing.
Hook names, verified against source: **`useTracked(thunk)`** for a derived
read — *not* `useValue`, which takes a `CallableRef`; `useDocStatus` returns the
string union `"pending" | "empty" | "populated"`, not an object.

**The interface is your list of roots down the left, and the root you are
on, a rail beside columns** (`docs/06-interface.md`,
`packages/interface/TECHNICAL.md`, ADR-0029, ADR-0085), over a footer showing
who is here, what needs you and the board, which slides up over the columns
with every root in its workflow state: each
column is one path on its own scroll, a branch opens beside its parent in its
rail track's colour, and the rail draws the root, with each uneventful
stretch drawn as one capsule (ADR-0031), a long ask's work a capsule of its
own (ADR-0056).
Views are pure functions over one `indexTree` (`packages/core/tree.ts`,
`roots.ts`); which root you are on and each root's columns are a reducer in
`packages/interface/layout.ts`, your list is your `open:` document
(`packages/session/open-list.ts`), and the inbox is
`packages/interface/inbox.ts`.

The composer is your drafting card (ADR-0048), the text people edit
together: one uncontrolled textarea, bound with Kyneta's `attach` to the
card's text from the keystroke that creates it (`packages/web/card-editor.tsx`).

**An image pasted into a composer reaches the agent** (ADR-0042): uploaded
to `POST /blob`, kept by SHA-256 in `pinetrie_blobs` beside the session in
the host's SQLite file, referred to by the message's markdown and its
`details.images`, and handed to the model as image parts by pi's
`toProviderMessages`. Admission now also refuses another origin, and on
loopback a rebound name. Images in tool results, workspace paths and remote
images are still to do.

**Live work hands over to its entry in one render** (ADR-0044). A reply is
its lane's current reply while the lane's tip is where it opened, and its
entry moves the tip. A tool's output streams in its own row. The layout is
drawn from the render's own facts. A column at its end does not get shorter
while the agent works: a floor takes up a shrink. The browser suite checks
this frame by frame at 20× CPU throttle.

**A root's tab can be renamed** (ADR-0045). A title is a mark on the root:
a host-written `pinetrie.mark` value keyed by the entry, set from the tab's
`⋯`, the last write winning, and deleted when cleared. It is the root's
label everywhere it is named, the Archive search included. ADR-0028's
descriptions, section headers and boundaries are still to do.

**A thread's column can have a banner** (ADR-0050, ADR-0053), when
`~/.config/pinetrie/config.json` has `{ "banner": { "enabled": true } }` and
pi has an OpenRouter key. A thread is named as its column first wants an
agent, before its first message (ADR-0057), and its name then fills the
`column-banner` skill, a prompt you can replace with your own, and Recraft
V4.1 Flash draws a square pixel-art sprite of it. Only the name is sent. It is
stored as a pasted image is, under a `pinetrie.banner` value keyed by the
lane, and drawn in place of the ✦ before the thread's name. A failed one is tried
again at the thread's next run's end. The agent's `set_banner` sets a
pasted image, or a new one from your words.

**A column folds each ask's work** (ADR-0056). An ask is a message that
started a run, with that run, read from the tree (`indexAsks`,
`packages/core/asks.ts`). A column is read in outline, story or raw: story
shows each ask's message, one digest line folding its work, and its last
word. The rail and the column compact the same stretches: one landmark rule
(`railLandmarks`) is drawn apart in both, and a long ask is a dot and a
capsule of its own. A bar names the ask whose work is at the column's top; a
"since you were here" line marks where you last left a thread, on any
device of yours; an
ask's files open a review of its range of revisions, from the paths each
turn's revision records. Stop records who pressed it (`pinetrie.stop`). Unless
`{ "digests": { "enabled": false } }` turns it off, a model writes each long
ask a digest (`pinetrie.digest`, the `ask-digest` skill, ADR-0075), which no
agent reads: a headline that leads the ask's fold line, and a few points
under it in story, or nothing when the agent's last message says it all.

**A thread's followers are told how its runs end** (ADR-0077). You follow a
thread once you have written on it (`RootRecord.threads`). At each run's end
the same request asks a model for a verdict, digests on or off: needs you,
worth a read, or done, with a one-line reason (`pinetrie.verdict`, one per
lane); a failed or stopped run's verdict is its facts. A tab's mark says
what its threads need of you: a still ring while the agent works, an amber
dot that pulses as it arrives when something needs you (a question, an
error, work ready to add), a dim one when something is worth a read, a ✓
that fades when a run ends with nothing to do. What you have dealt with is
yours on every device, in your attention document (`attention:<writer>`,
beside your inventory): how far you read each thread, what you marked "not
needed", and the mentions you have seen.

**The rail outlines what each column shows** (ADR-0058), in the column's
colour, and scrolls to keep the outline of the column you move in view. A
column of a tab shown again comes back where you left it, by message: the
same measurement (`packages/interface/viewport.ts`). Spots last the page's
life; keeping them for a person across devices is the next step.

**Steps 1–5 are done** (ADR-0018). Now continue thickening (`docs/04-roadmap.md`), each step
independently shippable:

1. ~~tree read~~ — done: `projectSpine`, spine + branch markers, navigation is client-local state
2. branch write — create a branch from any entry; Aside first
3. ~~concurrent lanes~~ — done; since ADR-0020, a lane per thread, not per writer
4. ~~references~~ — done, then withdrawn (ADR-0043): nothing read them
5. ~~humans in the tree~~ (ADR-0018) — done: chat and compelled responders, presence (ADR-0024), notes (ADR-0025, since removed), and cards (ADR-0048)
6. Scout — read-only tools
7. fold — three-way merge producing a `fromId` node

**v1 demo:** two browser windows, one host, one tree. A runs a long task on
trunk; B branches an Aside three turns back, asks, gets an answer, attaches a
reference — and it appears live in A's tree **with zero tokens entering A's
context.**

### Open, non-blocking

- **Kyneta ephemeral: a write and a deletion in the same millisecond diverge.**
  A peer that sets a key and deletes it within one millisecond applies both in
  order, so the key is gone there; on other peers the equal timestamps tie and
  the write wins, so the key stays. Measured through pine·trie's host: 14 of 20
  such deletions lost; 3 ms apart, 0 of 20. One peer's later operation should
  beat its own earlier one. In pine·trie it needs a column refreshed and closed in
  the same millisecond, and leaves only an empty key readers skip. To file
  upstream.

- ~~**Kyneta's store repeats bytes when commits overlap**~~ — fixed in Kyneta
  (locally, unreleased), verified from pine·trie: 0 overlapping records, where one
  tool run had 133 KB of 345 KB (S22 addendum). pine·trie needs the Kyneta release
  that carries it.
- ~~**`compact()` on a live Loro substrate throws**~~ — moot: the session is
  `json.bind`, which compacts live (S24, ADR-0023). It still throws on Loro and
  Yjs; **live Yjs compaction** is what collaborative documents wait for.
- **A client's command Line is stored and never compacted.** Each Line document
  grows about 1 KB per command, and the host cannot compact the half a client
  writes. Line's pruning should compact it: to file upstream.
- **While a tool runs, its output is stored twice:** the live stream in
  `pinetrie:live`, and pi's checkpoint (its crash recovery) in its root's
  document. So a client holding that root receives it twice.
  Compaction clears both when the run ends, so it costs bandwidth during a run,
  not storage. One text would do if pi's `tool_update` carried the checkpoint's
  key (`operationId`/`invocationId`): an upstream request to pi, low priority.
- **Identity is not authenticated.** The invite key decides who gets in; a
  person is the email their client names, unverified, so a collaborator can
  pose as another (ADR-0022, ADR-0037). Next: an email with a generated token.

- **S15** — the trunk winner rule uses wall-clock `ts`; clock skew is
  adversarial. Needs a Lamport clock (S1 deliberately built none).
- ~~**S16**~~ — moot: compaction removes ADR-0014's residue (ADR-0023).
- **S10 remainder** — snapshot/sync-payload size at scale.
- **S6** — file-range reference anchoring (only matters for Worktree branches).
- ~~`scripts/check-boundaries.ts` has no tests~~ — deleted. Boundaries are
  now enforced by resolution; see `docs/01-architecture.md`.
  It has now failed the same way twice (`.mjs`-blind, then `.tsx`-blind) while
  reporting "all boundary rules hold".
- ~~Multi-writer is proven only at the *storage* layer.~~ Since ADR-0020, two
  threads' lanes run at once, and one thread's writers queue.
- **The suites and their mutations spend most of their time waiting** (S65).
  What remains after the dead waits were removed, and the suites became
  scenarios (S94): the image clean-up delay and presence expiry as host
  options, short in the suites; mutants run in parallel, each in its own
  copy of the repository; and the suite checks listed in
  `scripts/unproven.ts` proved by a mutation, or deleted (the `lanes/*`
  ones on the Mac).
- **A run's refusal cannot reach its author.** The host replies `started`
  before pi admits the run, so a refusal is only logged; the message is kept
  in the tree (`settleRun`), with no reply. A second reply, sent once the run
  is admitted, would fix it; it changes the protocol.

### Standing chores

- Republish `@kyneta/*` **and raise the declared loro floor** — shipping the code
  fix with `>=1.8.0` lets consumers install a 17×-slow combination silently.
  (pine·trie no longer uses Loro, but other Kyneta users do.)
- Exercise `@kyneta/react` + `@kyneta/devtools` against Kyneta's in-place
  mutation change (they are the likeliest holders of an object-identity
  assumption).
- Periodically diff pi upstream; `pnpm run conformance` is the gate.

---

### Running pine·trie

- `pnpm run host` starts the development host on pine·trie's own repo:
  loopback, your pi settings' model, the session in `.pinetrie/pinetrie.db`.
  `pnpm run host <folder>` serves another project instead, at that folder's
  jj or git root (ADR-0086). A relative folder is read from pine·trie's root,
  not the shell's directory. Each project keeps its own session in its
  root's `.pinetrie/`, which the host adds to the repo's exclude file before
  writing there; a jj repo with no git directory beside it is refused. The
  agent has its tools, and each
  thread's agent works in its own Linux container (ADR-0034), on a disk
  cloned from the turn it branched at: a root thread's starts from your
  committed work (`@-`), with dependencies installed, so commit what it should
  see. It sees its own directory at `/workspace` and your working copy at
  `/mnt/host-working-copy`, read-only, and nothing else of your machine unless `pinetrie.json`
  grants it. Your working copy is yours, so hot reload stays on. It needs
  Apple's `container` running (`docs/05-stack.md` D10); without it, threads
  work directly. Restart the host to pick up changes to host code.
- **`pnpm run host` serves React's production build** through Vite's dev
  server (`NODE_ENV=production`): hot reload stays, as a full page reload,
  and a long thread stays quick to type in (S59).
  `pnpm run host:react-dev` serves React's development build: its warnings,
  its render timeline and Fast Refresh, for work on the client's renders. The
  suites start their own host with development React.
- **A thread's container stops when its run ends**, and starts again at the
  next message. A dev server or watcher the agent started ends with the run.
  The agent is told this, and what else holds in every lane, by a short block
  in its prompt and a note at `/pinetrie/packages/pi/lane.md` (ADR-0046).
- **Who you are** (ADR-0037): the page asks for your email and name once per
  browser. The email is who you are, in every tab and on every device; the
  name is how you are shown, renamed on your profile page, from the menu
  your avatar at the footer's left opens. **Sign in as someone else** there
  forgets the email on that browser.
- **Your pi skills and prompts are commands** (ADR-0036):
  `/<package>:skill:<name>` for a skill, `/<package>:<name>` for a prompt
  template. For example `/duane:skill:plan` or `/duane:comments`. Typing `/`
  and part of a name offers them. The package's name is its
  `.claude-plugin/plugin.json` name, else its package name without the
  scope. `commands.names` in `~/.config/pinetrie/config.json` renames one, keyed
  by the path or source in pi's `packages` setting. Their files are readable
  in every thread's lane, read-only.
- **Sharing a directory with every thread** (ADR-0035), e.g. your plans:
  list it in `~/.config/pinetrie/config.json` as
  `{ "lanes": { "shared": [".plans"] } }`, and ignore it in
  `~/.config/git/ignore`. Every thread's agent then reads and writes
  `/workspace/.plans`, which is your `.plans`, live, and never part of a
  branch. A project can share a directory for everyone in `pinetrie.json`'s
  `lanes.shared`. A changed config reaches existing threads at their next
  run, after a host restart.
- **Bringing a thread's work back** (ADR-0038 to ADR-0040, ADR-0047): each
  thread has a two-word name, shown in its column's header from before its
  first message (ADR-0057), and keeps an
  offer in your repo, one commit on your `@-` under the bookmark
  `pinetrie-offer/<name>`. While the thread works, the offer reads
  `WIP (<name>): <its first message>` and grows in place; when a run ends,
  an agent writes its commit message. Before you add it, press the offer's
  line in the work strip: the column's pane shows its message, its files
  (flagging those that conflict with your committed work, and those you are
  editing) and every file's diff. Or find its bookmark, which a press
  copies, in jj or jjui. **add to the project** (or **add to wip/…**), in
  the work strip at its column's foot, integrates it: that bookmark moves
  forward to it, and your `@` stays where it is (ADR-0060). Reword, squash
  or split the offer like any commit of yours before then; the host then
  leaves it alone. **split into a stack** has the agent rewrite it as reviewable
  revisions, in a run of its own: while the thread works it waits in the
  queue, and the agent can ask for one too (ADR-0080). The thread is told
  what you did to its offer, an integration included, and when the project
  has new work: the agent can catch up itself (`catch_up`). Set the bookmark
  `pinetrie-onto` to have offers land on another commit instead, such as a
  branch you are not on; each integration moves it up.
  `jj git push --all` would push it: push by name.
- **Sending your work to a thread:** the work strip's `⋯` offers **update
  from my work**: your `@`, uncommitted edits included, merged into the
  thread's own copy. The thread gets a note of what changed, and your
  composer a line you may send. When it conflicts, the agent resolves it, or
  asks you (ADR-0033). A new root thread starts from your `@` as it is,
  uncommitted edits included. A thread's own history is in your repo out of
  sight:
  `jj log -r '::remote_bookmarks(remote=glob:"pinetrie-*") ~ ::@'`.
- **Working directly:** the send button's `▾` sets a new thread to work in
  your working copy, or any directory, with no container, as you. A branch
  inherits its thread's setting. `PINETRIE_LANES=0` makes it the default. Such
  a thread shares its directory, and while one runs, hot reload holds an update
  to a file inside it.
- **Summaries of asks** (ADR-0056, on by default since ADR-0071, shaped by
  ADR-0075): a model, the one commit messages use, writes each long ask's
  work a headline and a few points while someone reads the running thread,
  at most once a minute, and once more when its run ends. An ask of one or
  two agent messages gets none. `{ "digests": { "enabled": false } }` in
  `~/.config/pinetrie/config.json` turns them off. Replace the `ask-digest`
  skill to change what it asks; yours must still ask for a headline line
  and `- ` points, or `nothing to add`, since a reply in another shape is
  logged and dropped. With digests on or off, each run's end also asks
  for its verdict (ADR-0077), a request of its own for a short ask; a
  replaced skill must answer `needs you: <reason>`, `worth a read:
  <reason>` or `done` first, or the run is unclassified.
- `PINETRIE_TOOLS=0` removes the tools. A thread's agent that starts the
  development host itself needs `PINETRIE_PORT=0`, or it collides on 7391.
- **Inviting a collaborator:** `PINETRIE_BIND=0.0.0.0` (or an address). The host
  prints an invite link per network address, with its key; `PINETRIE_KEY` fixes
  the key. Everyone with the link gets in, and with tools on, can run commands
  on this machine as you. Use a trusted network or a tunnel.
- `PINETRIE_PROVIDER` / `PINETRIE_MODEL` override the model. A root schema change
  cannot open an existing store: move the project's `.pinetrie/pinetrie.db` aside.

## 7. Working agreements

Adopted from Kyneta's `AGENTS.md` because they match how this project has run:

- **No backwards compatibility.** Delete old code. Take the elegant path even if
  it means a bigger refactor.
- **Fix pre-existing problems** you notice; code health is everyone's.
- **No non-null assertions (`!`)**, even in tests.
- **`pnpm run verify` must be green after every change.** Never leave it red and
  move on.
- **Boundary rules are not negotiable.** If a change seems to need a new
  cross-module import, a type is in the wrong module — move the type, not the
  boundary.
- **Report honestly.** A clean negative result is a success; a layer that does
  not work, stated plainly, beats one that appears to.
- **A check without a proof it can fail is not yet a check.** Prove it with a
  mutation, listed as data in `scripts/mutations/*.ts` and run by
  `pnpm mutate scripts/mutations/<list>.ts [name]`. The harness
  (`scripts/mutate.ts`) holds the rules: an anchor must occur exactly once, the
  file is always restored, a mutant that does not load is BROKEN, and with
  `expect` the intended check must be the one that fails (else ELSEWHERE). A
  mutant must be valid code, so it fails on behaviour, not on a typo. A fast
  test (`scripts/mutations.test.ts`) keeps every list's anchors from drifting.

### Map of the record

| file | what |
|---|---|
| `docs/00-vision.md` | product thesis, branch kinds, v1 scope |
| `docs/01-architecture.md` | evidence base, layer cake, data model, module layout |
| `docs/adrs/` | the ADRs, one file each, with rationale |
| `docs/04-roadmap.md` | sequencing, invariants, action items |
| `docs/05-stack.md` | stack decisions, sandbox constraints |
| `docs/findings/` | the spikes, one file each: briefs, answers, evidence |
| `sandbox/` | disposable spike code (gitignored), kept for reproduction |
