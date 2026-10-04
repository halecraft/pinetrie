# Interface: a tab per root, columns for reading, a rail for shape

The backend can now hold a conversation as a tree, with people and an agent in
it (ADR-0018). The first interface drew that tree as a chat list: one path, with
every other branch reduced to a "⑂ 1 branch" marker. That was honest about
context (T) but hid everything else (E), which is the product. Play-testing it
also showed two controls that confuse people:

- **"Follow the newest"** appeared after your first message, though you had not
  gone anywhere. It showed internal state (the client remembering which thread
  you read), not a choice you made.
- **"Make this a conversation"** changed a rule without showing where the rule
  starts, or saying what it does.

This document fixes the design before any code. It draws E and T directly.

## Principles

1. **Draw the tree.** Every branch that exists is visible somewhere, in the
   shape it has. Hiding branches behind a counter is what a transcript does.
2. **A branch sits beside its parent.** Slack's thread panel gets this right for
   one level. Pineta needs it at any depth.
3. **No thread is special.** The data has no "main thread"; the interface should
   not invent one. Whatever you put first is what reads as the trunk. Roots
   are peers too: you open the ones you work in, as tabs (ADR-0030).
4. **Show context, don't describe it.** What the agent will read is a path: the
   column shows it, and marks where the agent joined.
5. **Say the effect, not a mode name.** "send to agent" says what
   happens. "Working session" is a name someone has to learn. So there is no
   mode to set: the send button says what each message will do (ADR-0021).
6. **Every control is a choice the user made.** Nothing appears because of
   internal state.

## Layout

```
 Archive ┌ Fix the sync bug ◉ ⋯ × ┐ Release notes ·Bea  Q3 planning  ＋ agent ▾  (B)(C) (✦ 2) (A)
━━━━━━━━━┛                        ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┌ rail ┐┌ column 1 ──────────────┐┌ column 2 ─────────────┐┌ column 3 ──────────┐
│ ●    ││ Ada                    ││▌from Ada: "Say…" (blue)││▌from agent (green)  │
│ │    ││ Say exactly: OK  ●blue ││ Bea                   ││ Ada                │
│ ├──● ││ agent: OK              ││ an aside              ││ aside of aside     │
│ │  │ ││ Ada                    ││ agent: …      ●green  ││ agent: …           │
│ │  ● ││ just a note            ││ Bea                   ││                    │
│ ●    ││ Ada: @Bea have a look →││   what about X?       ││   agent: …         │
│ ◉    ││ Ada: @agent … ◉replying││                       ││                    │
│      ││ ┌──────────────────────┐││ ┌───────────────────┐││ ┌────────────────┐ │
│      ││ │ send to agent…  send │││ │ reply in thread…  │││ │ …              │ │
│      ││ └──────────────────────┘││ └───────────────────┘││ └────────────────┘ │
└──────┘└────────────────────────┘└───────────────────────┘└────────────────────┘
```

### The header: your tabs, who is here, and what needs you (ADR-0030, ADR-0069, ADR-0077, ADR-0081)

The header is one row: your tabs on the left (below), and at its right end
what is happening in the rest of the session, from live data only, as a
document editor shows the people in it. Too narrow for both, the right end
goes on a row above the tabs. It is darker than the page, and the tab you
are on is the page's colour and opens into it, so the columns below read as
that tab's. While the page syncs, "syncing…" leads the right end.

- **People here:** an avatar per person with a live presence entry, in their
  colour. Hovering names them and the thread they are in; a click opens that
  thread as your tab, with a column on their path. You are never shown among
  them.
- **Activity** (ADR-0069, ADR-0077): one menu of what needs you, its
  trigger a ✦. Its amber badge counts what the threads you follow need from
  you (a run that ended asking something, failing, or that no one could
  tell; work ready to add) plus the mentions you have not seen; the page's
  title carries the same count, before the tab you are on: "(2) Fix the
  sync bug · Pineta". While the agent works, a
  steady count of its threads stands beside the ✦, never in the badge. Its
  sections, each shown only with rows: **Needs you** (each thread's reason,
  in amber), **Ready to add** (every thread with an open offer, those you
  follow marked and counted), **Worth a read** (listed, not counted),
  **Mentions of you** (the inbox, below; shown once anyone has mentioned
  you) and **The agent is working in** (its threads in every root). Each
  row opens its thread; under each of yours, **not needed** clears it on
  every device of yours, until the next run's end or new work. You follow
  a thread once you have written on it; threads you do not follow raise
  nothing for you. With nothing in it, the menu is not shown. Nothing in
  the header animates: the tab, the column and the rail show where the
  agent works.
- **The project** (ADR-0060, ADR-0061, ADR-0076): a menu for the
  integration line, "◆ project", where finished work is added; its
  bookmark is in its title. While the project has commits not yet on `main`
  (`offers.publish`), it reads "◆ project · 2 unpublished". Before the line
  exists, the host's own machine offers **set up the project**, showing the
  bookmark it makes at your `@-` and the exact `immutable_heads()` and
  `revsets.log` text it writes to your repo's config (the log, so jj and
  jjui show the offers), and what to add to a jjui revset of its own
  (`docs/the-jujutsu-repo.md`), done only when you choose it; a host that
  admits others says the project is not set up yet, with the jj
  instructions in its title. After, the menu has two sections:
  - **The project**, on every host: "2 commits not yet on main", or
    "everything in the project is on main", and **publish to main (N
    commits)**, which moves `main` forward to the line, as the host, for
    anyone admitted. It does not push. With no `main`, or `main` holding
    commits the project lacks, it is not offered, and the menu says why.
  - **Your files**, only on the host's own machine: where they stand ("3 new
    commits in the project since you last updated", or "your files have
    everything in the project"), conflicts in them, and what updating would
    conflict, at most three files named; then **update my files**, which
    rebases your work onto the project, as you (its title says how many
    files it changes, that your work stays on top, and the jj command that
    shows the diff); **add my work to the project (N commits)**, which moves
    the line forward to your `@-`; and, when your files have conflicts,
    **resolve with the agent**, which opens a new agent tab working in your
    files, its box holding the `resolve-conflicts` skill and the files, for
    you to send. With no commit in common with the project, it says to
    rebase in jj.

  While a command is out the menu says what it is doing ("setting up the
  project…", "adding your work to the project…", "updating your files…",
  "publishing the project…") and offers nothing else; refused, it says "not
  done:" and why; failed, "it failed, and may be part done:" and why. That
  stays, menu closed or open, until your next command there.
- **A menu you opened stays open until you close it.** The header's avatars
  and counts come from live data, but when what one stands for goes while
  its menu is open (a person leaves, the agent finishes, the last offer is
  taken), the menu says so ("The agent has finished") and its trigger stays
  until you close it (principle 6).
- **The inbox**, activity's mentions: the messages that mention you, newest first, each
  with who, the thread, and the start of the message. A row opens that thread
  as your tab, with a column on the message; a message in an archived root
  opens that root's preview in the Archive tab. The badge counts the mentions you
  have not seen. One is seen when you open it from the inbox, when it is drawn
  in a column of the tab you are on, or when you **mark all seen**. A seen
  mention stays in the inbox; a filter shows only the unseen.
- **The inbox is yours**, the same on every device of yours (ADR-0077). You
  start from your first load, with no backlog.
- **Your inventory** (below) and **you**, at the far right, apart from the
  rest.
- **You:** your avatar, last, opens your profile (ADR-0037): your
  name, and the handle it gives you as you type it; your email; and **Not
  you? Sign in as someone else**, which forgets who this device says you are
  and asks again. A rename is sent on Enter or **save**, and Escape or a click
  elsewhere discards it. A name no mention could reach is refused before it
  is sent.
- **Nothing opens a tab by itself.** A mention is a notification: you choose to
  open it.

### Root tabs: the roots you have open (ADR-0029, ADR-0030, ADR-0045, ADR-0077)

A conversation's context is its path to its root, so nothing in one root is
ever in the context of another. That is where the screen splits.

- **A root tab shows one root's tree**: its rail, and its columns. Every column
  in a tab shares the root.
- **Your tabs are yours:** the roots you have open, in the order you opened
  them. **×** closes one for you and writes nothing; opening it again brings
  its columns back. A root you start opens as your tab; a root someone else
  starts does not, and reaches you through the header, a mention, or the
  Archive tab.
- **A tab's label** is its title, else its first message's first line, cut
  short; a root only people have written in, untitled, is **Chat**. When the
  agent is first asked in a root with no title, a model titles it in one to
  three words (ADR-0074). **Rename** in the tab's `⋯` turns the label into a
  field: Enter or leaving it saves the title for everyone, Escape cancels,
  and an empty title brings back the first line. **Auto-update title**, beside
  it, asks the model again from what was said in the thread, and replaces the
  title for everyone. A title is a mark on the root (ADR-0045), and names the
  root wherever it is shown: the header, the inbox, the Archive tab.
- **A tab shows what happens in it while you are elsewhere** (ADR-0077),
  before its label: a still blue ring while the agent works there or is
  finishing its summary, which needs nothing from you; a filled amber dot
  when something there needs you, which pulses three times as it arrives
  and then stays still; a dim amber dot when something is worth a read; and,
  when a run you follow ends with nothing to do, a ✓ that fades. Its title
  says why ("needs you: asks whether to drop the v1 table"). Reading the
  thread to its end, on any device of yours, clears it; work ready to add
  clears when it is added, or with **Not needed** in the tab's `⋯`. A page
  that loads draws every mark still: only a change you see moves. The
  Archive tab carries the highest mark of the roots with no tab of yours.
  After the label, small avatars of the others reading there, and a small
  dot in your colour when the tab holds something you typed and have not
  sent. For the roots you have not opened, the header shows the same.
- **Archive is in a tab's `⋯` menu**, saying what it does: "hide for
  everyone; restore from Archive". The `⋯` shows on the tab you are on, and on
  any other root tab while it is hovered or focused. Archive is for work that
  is done; **×** is for putting a tab away yourself. The Archive item is
  disabled while the agent works in that root or cards are queued there, with
  the reason. Archiving
  writes a record, and takes the root out of every tab bar; no message
  changes. It withdraws the root's threads' offers from your repo, and the
  item names them first ("work not added to the project goes: amber-fox");
  restoring builds them again (ADR-0061).
- **Archiving closes the tab for you** once the host accepts it, as **×**
  does, showing its right neighbour, else its left; a refusal leaves it open.
- **If someone else archives the tab you are on**, it stays while you are there,
  read-only, saying who archived it, with **Restore**. It leaves the bar when
  you switch away.
- **The tab you are on** has no edge below it and a light one above, and its
  label is bright and bold, shown up to 32rem. The other tabs have no box
  until hovered, and their labels keep their colour; their ⋯ and × show over
  the label's end on hover.
- **With many tabs**, the other tabs shrink to a floor, then the bar
  scrolls; Archive and ＋ stay put, and the tab you choose scrolls into view.

### The Archive tab

The leftmost tab. It finds roots, so it is a list, not a rail with columns.

- **A row per root, open or archived:** its label, last activity, who wrote in
  it, its messages, and its state. Filters: archived, open, mine.
  Search over each root's label, so its title, and its message text.
- **Selecting a row previews it:** that root's rail, and one read-only column
  that a pick on the rail moves. Its composer is disabled, and none of the tools that
  write are there: edit, branch, mark. Copy stays, since it writes nothing. In place of sending it offers
  **Restore** for an archived root, and **Open** for an open one. Taking a
  copy of a message into your inventory is not offered here yet, though it
  writes nothing in the root; it is offered wherever you can write.
- **Messages, M of N** heads the list, and is the Archive tab's tooltip on
  every tab: M is the messages in the threads this browser tab has loaded
  (your open tabs, and the Archive tab's preview), N every thread's,
  archived or not. Opening or closing a tab moves M; archiving a thread
  moves neither, unless its tab was open.
- **Restore** opens the root as your tab and switches to it; for everyone
  else it is simply no longer archived. **Open** opens an open root as your
  tab. Restoring is the only way to write in an archived root; the host
  refuses anything else there.

### The add tab

The rightmost tab, drawn as an empty tab: a split button, **＋ agent**, with
**conversation** in its menu. A conversation at the root is the rarer start,
so it is the one behind the menu. What each does is under "Starting" below.

### Columns: a path each

- **A column is one path through its tab's tree**, from the root to a leaf,
  read top to bottom. Its composer sends at its last message.
- **Opening a branch adds a column to the right**, starting after the fork. An
  aside of an aside opens a third column.
- **A column's header says who works in it and where it came from**
  (ADR-0040). Its first row names the agent working there, `✦ amber-fox` in
  the column's colour. While the composer's next send would start one, the
  agent to come is named already (ADR-0057), with `✦ new agent` only until its name arrives. A conversation
  shows nothing there, since a message goes to people. Its second row, for a column
  that forks, names the fork, `↰ Ada: “Say exactly…”`, and clicking it brings
  the fork point into view. A thread that started from a WIP says so, "on
  wip/search", or "wip/search is gone" once it is (ADR-0060); one on the
  line says nothing.
- **A thread's name opens its details** (ADR-0073), under the header, and a
  second click on it closes them; a chevron after the name turns as they
  open. They show the thread's icon magnified, which spins in as they open
  and again at a click, its name, "started by Ada · 3 h ago", where it
  works, what it is working on, and what its base has new, in full. Where
  the agent joined below the path's first message, **where it started**
  brings that message into view. Open details stay open, through a reload
  too, as a column's density does.
- **Colour, not lines, links a branch to its parent.** Each open branch takes
  its rail track's colour: its column's header carries a stripe of it and a dot
  beside its fork, and the fork point in the parent column shows a dot of it.
  Hovering either end outlines the other in that colour; clicking the dot
  scrolls to the branch's column. Sibling branches off one column never cross,
  as drawn lines would.
- **Each column scrolls on its own.** A new column opens scrolled so its first
  message is level with its fork point when the fork point is on screen, and
  at its end otherwise; after that it scrolls freely. Forks far apart (message
  2 and message 95 of a long trunk) are both readable at once.
- **A column at its end follows what is written there**, the agent's reply as
  it streams included. A scroll up holds it still; **↓ new below**, a scroll
  back to the end, or your own send brings it back.
- **The shared part of paths is shown once.** A column shows only what follows
  the deepest entry it shares with any column to its left; its header says where
  it came from.
- **A column grows as replies arrive.** It follows its own tip to the newest
  message below it, including the agent's reply, which may have been written on
  another lane (`followTip`). A branch off an earlier message, however new,
  never pulls it away. This replaces "follow the newest".
- **Columns are reordered by dragging their headers.** Whichever column is
  first shows its whole path, so moving a branch to the far left makes it read
  as the trunk. Nothing in the document changes: which path reads as the trunk
  is a view choice, kept client-side, like selection today. A grip (⠿) leads
  each header, and is the keyboard's way to do the same: ←/→ move a column one
  place, and Home/End move it to either end.
- **Closing a column** removes it from the view, never from the document. Its
  branch is still in the rail. A root tab's only column has no close, since
  the tab would show that path again; a new tab's closes the new tab. The
  cards at a thread's end stay with the thread.
- Each column's composer sits at its foot. The rail scrolls on its own, and
  follows the column you move (below).
- **A column shown again is where you left it** (ADR-0058): the same message
  at the same height, or its end if you were following it. If its thread
  grew meanwhile, it comes back at its old end, with ↓ new below.
- **Above the composer, a work strip says what became of the agent's files**
  (ADR-0040): an agent on its own copy shows its offer in plain words ("2
  files ready"), with **add** and its bookmark, which a press copies. The
  button names where the work goes (ADR-0060, ADR-0061): "add to the
  project", or "add to wip/search" for a thread on a WIP, whose menu also
  offers "add to the project, with your 2 commits beneath it"; its title
  names the bookmark it moves. A take moves that bookmark forward to the
  offer and never touches your working copy. From the click to the host's
  answer the strip says what your command is doing ("adding to the
  project…", "adding to wip/search…", "squashing to one…", "splitting into
  a stack…", "rewriting the description…", "refreshing…"), and its buttons
  wait. A command refused or failed says so there, as the project menu does
  ("not done: …", "it failed, and may be part done: …"), until your next
  one on that thread; one carried out says nothing, as the offer then shows
  it. A take adds the offer the strip showed: if it now brings other work
  (the lane moved on), or conflicts where it did not, it is not done ("not
  done: the offer changed since you looked at it: review it again"), and
  the strip shows the new offer. A rebase onto a moved project, or your own
  edit of the offer, is still the offer you saw, and is added. An offer that conflicts is
  never added to the project; its button is **catch up with the project
  and resolve**: the agent resolves what the merge leaves. An offer whose
  every conflicted file was already conflicted where its thread's copy
  started says so instead: "began from a copy with an unresolved conflict
  in 1 file", and, when the thread it branched from has since resolved
  those files, "· amber-fox has resolved it", with **catch up with
  amber-fox** as its button (ADR-0072). One
  working directly says "edits your files directly", and warns while
  another agent works in the same directory. Its **⋯** menu holds **catch
  up with** the thread's base (the project, or its WIP), or, once its WIP is
  gone, **continue from the project**; and, while the thread it branched
  from has new commits, **catch up with** that thread by its name, greyed
  out while that thread's agent works. When catching up would change files
  in the thread, the strip says so ("2 files ready · the project has new
  work"), catching up stands beside the offer, titled with how many files it
  changes, and the column's header shows ↓, titled with the count, the
  bookmark and both commits. When it would change nothing, it stays in the
  menu, greyed out, and says why: "already caught up with the project", or,
  when the project moved only by this thread's own work you added, "the
  project's new work is this thread's own: catching up changes no file"
  (ADR-0067). An offer whose work the project already has says "nothing to
  add: the project already has this thread's work": the header does not
  count it, and archiving its thread warns of nothing. A thread whose
  earlier add was made before Pineta recorded what an add took says "an
  earlier add of this thread can't be traced: catch up with the project to
  offer what's new", with catching up beside it. Every catch-up button does
  it at once
  (ADR-0061): each queues a new card holding the command and no text, which
  the host takes when the lane is free, and your composer is left as it
  was. The queued card says "↓ catches up with the project first", and the
  strip "catching up with the project…". A card that already carries a
  command (one unqueued, say) says so above its box, with a × that sends it
  as a plain message instead, and its button reads "catch up", or "catch up
  and send"; what you write is what the agent should do with the new work
  (ADR-0055).
- **A branch from a conflicted copy is warned** (ADR-0072): when the next
  send would start a thread on its own copy cloned from a commit with
  conflicts, the line under the box says "starts from a copy with an
  unresolved conflict in 1 file".
- **A column's pane opens what you read beside the thread** (ADR-0078):
  the offer's review, an ask's review, a table, or an image, one at a time.
  The thread keeps its place and width, and the column widens to hold the
  pane. Opening something else replaces it; opening it again, the pane's
  ×, or Escape inside it closes it, and its source in the thread is
  outlined in the column's colour while it shows. A window too narrow for
  both (under 76rem) shows the pane over the page instead, with ← to go
  back to the thread. Nothing in it is kept: a reload closes it.
- **The offer's line opens its review in the pane** (ADR-0047): a file
  list when there is more than one file, and one scroll of every file's
  diff, each file's head pinned while its diff is in view, with the files
  that conflict and those you are editing flagged.
- On a narrow screen, columns stack as a back-navigable sequence (the macOS
  Finder column view on a phone), with a breadcrumb of fork points.

### Asks: a message to the agent, and what was done for it (ADR-0056)

An **ask** is a message that started a run, together with that run: a
person's message to the agent, a land message or a stack message. A message
for people only is not one. Nothing about an ask is stored; it is read from
the tree.

- **A column is read at one of three densities**, chosen in its header, kept
  with the column and never written. A new column opens in story.

  | density | an ask shows |
  |---|---|
  | **outline** | its message, and one line: how it ended, or what it is doing, and its digest; the column's last ended ask also its last word (ADR-0070) |
  | **story** | its message, a digest line folding its work, and its last word |
  | **raw** | every message and tool row, under its digest line |

  People's messages show at every density. Outline lists everyone's asks.
- **An ask's digest line** counts its work: steps, tool calls, files its
  turns changed, how long it took, and failures. A press opens or closes the
  work under it. Its files open a review of what the ask alone changed, beside
  the column, as an offer's review does.
- **What the rail draws apart, no fold hides**: a fork, a branch's first
  message, a running tip, an open column's end. Each splits the fold around it.
- **The running ask is open** in story and raw: until its run ends, which
  message is its last word is not known. It folds once its run has ended and
  the column is at its end, so what folds is above the view. Scrolled up into
  its work, it stays open under you until you come back down. Your choice,
  open or closed, wins, and is kept while the page lives.
- **An ask's last word** is its run's last message with text or a tool call:
  its answer, or what it was doing when it stopped. A stopped ask says who
  stopped it, "stopped by Bea" (a stop made before stops were recorded says
  "stopped"); a failed one shows the error. A restart does not end a run:
  the host resumes it.
- **The ask stays in sight.** While the work at the top of the column belongs
  to an ask whose message has scrolled away, a bar over the column's top
  names it, `Ada: "Fix the rail…"`; a press scrolls to it. A column that
  starts inside a run names the ask in a column to its left,
  `↰ answering Ada: "…"`, and a press shows it there.
- **A pick on the rail into an ask's work opens its fold**, then brings the
  message into view.
- **Since you were here.** Your attention document remembers, per thread,
  how far you have read it, on any device of yours (ADR-0077): a column at
  its end in a page you can see marks it, and so does leaving it there.
  Coming back, a dashed line, "since you were here", marks the first
  message after it. It takes no room.
- **A summary, unless digests are off** (`{ "digests": { "enabled": false } }` in
  `~/.config/pineta/config.json`, ADR-0071): a model's two or three sentences on an
  ask's work, under its digest line, set apart from the agent's words. It is
  refreshed at most once a minute while someone reads the running thread,
  written once more when its run ends, and read by no agent.

### The rail: a root's tree, compactly

- A strip at the left edge draws every branch in the tab's root as a line,
  and every message as a dot, except for uneventful stretches (below). A row
  is a depth, not a turn in one order: a branch starts on the row under its
  fork, beside the messages it diverged from, in the leftmost place free for
  its whole height (ADR-0068). Each branch has its own colour, by when it
  was made. The tree is centred in the rail.
- **A new tab has a rail too**: a hollow dot where its first message will be.
  It is as wide as the rail it becomes, so the columns do not move when the
  first message lands.
- **A column wears its rail track's colour**, so you can see which branches are
  on screen and where they sit in the whole.
- **Clicking a message in the rail brings it into view**: in the column that
  shows it, or in a new column opened beside it.
- **Uneventful stretches are capsules** (ADR-0031, ADR-0056). A message is
  always its own dot if it is the root's first message, a branch's first
  message, a fork, a thread end, a thread end someone else is reading, where
  the agent is replying, the end of a column you have open, or the message
  of an ask whose work is three agent messages or more. Three or more other
  messages in a row are one capsule on their track, and a capsule never
  crosses such an ask's edge: a long ask is a dot and a capsule of its own,
  and short exchanges merge. A capsule is 2 rows long for 3–9 messages, 3
  for 10–99, 4 for 100–999. It is hollow when only the agent wrote in it,
  solid when only people did, and filled at half strength for both. Its
  tooltip leads with its ask, then the counts, failed tool calls included,
  then the ask's summary when there is one. Clicking it opens the message at
  that point of the stretch, its ask's fold included: near its top, the
  first; three quarters down, the message three quarters through. The column
  is where it is read.
- **Activity shows in the rail**: a pulsing dot where the agent is replying, a
  mark where a branch has messages you have not read.
- **The rail outlines what each column shows** (ADR-0058): a rounded outline
  in the column's colour around the whole dots and capsules in its view, and
  a thin line across a capsule where the view's top or bottom falls inside
  it: at most two, never a fill. Both move as
  the column scrolls, and the rail scrolls to keep the view of the column you
  move in view, except while your pointer is over the rail.

The rail is E; the column is T. Seeing both at once is the product.

### Context, drawn

- A message the agent was asked shows as asked (a margin bar), and a divider
  marks **where each agent joined**, by name: `✦ amber-fox joined`, or
  `✦ copper-owl, from amber-fox` in a branch of agent work. Everything above
  it is now that agent's context.

### Who a message is for (ADR-0021)

- **A thread's mode is whether the agent works in it**, which is whether it has
  a lane. In agent work, a message that names no one asks the agent; in a
  conversation, only `@agent` does. Nothing is set or stored, so there is no
  rule to mark and no mode to toggle.
- **Mentions pick who a message is for.** `@agent` asks the agent. A message
  naming only people goes to them, in agent work too. A handle that names no
  participant (`@types/node`) is ignored. A person's handle is their name as
  shown, in lower case, keeping only letters and digits (in any script), `_`
  and `-`: `@adalovelace`, `@josé`, `@日本`. Someone who set no name is shown,
  and mentioned, by their email's part before the `@` (`@ada` for
  `ada@example.com`, ADR-0037). A name with no such character, or spelled
  `agent`, is refused: no mention could reach it.
- **The send button says what the message will do**: "send", "send to Ada"
  ("send to Ada +2" for three), "send to agent", or, while the agent is busy,
  "queue up next", "queue after Bea" or "queue after yours", naming who
  queued the last card already waiting. It uses the host's own decision (`addressChat`,
  over `threadOf`), so it cannot promise a reply that will not come. When the
  send starts an agent, a line left of the button says where it will work, by
  what that does to your files ("works on its own copy · your files stay as
  they are ▾", or "edits your files directly"), and opens the choices, the
  current one checked (ADR-0061). When you have WIP bookmarks, a second
  section says where its copy **starts from**: the project, or a WIP, with
  how far that is behind the project (ADR-0060).
- **Who else is here** (ADR-0024) shows where there is room for it:
  - the **rail** rings the dot at the end of each thread someone else is reading,
    in their colour, with a count when several do; hovering names them. The
    dots are 8 px, so the rail marks and the header names;
  - a **column's header** shows small avatars of the others reading its
    thread: this is "seen by", naming only others, and nothing when you are
    alone;
  - the **composer** says "Bea is typing…".

  Presence is thread-level: every column in the tab you are on reports the
  thread it shows. Columns in other tabs report nothing, so a tab's avatars
  are the people looking at it now.
  Which message someone has on screen waits until thread-level proves too
  coarse.

### Starting, branching, and stepping down

- **At the root, two ways to start**, because there is no context yet: a person
  declares a purpose. Both are on the add tab. **＋ agent** opens a new tab
  whose column asks the agent unless a message names someone, so its first
  message creates the lane. **Conversation**, in its menu, opens a new tab
  whose column is a conversation.
- **A new tab is yours until its first send**, as any fresh column is. It sits
  beside ＋, labelled "new agent" or "new conversation", and closing it leaves
  no trace. Its first send makes the root, and the tab becomes that root's
  tab. Others find the root in the Archive tab, and see you in it from the
  header.
- **An empty session** shows only the Archive tab and ＋, and points at ＋.
- **A page with nothing stored** (a new browser, or a first visit) opens on
  the Archive tab, which lists every root to open: nothing opens a tab by
  itself (ADR-0030).
- **`→` in a message's right margin opens a branch** as a column to its right,
  empty until something is sent there. What it opens appears to the right, so
  the button sits on that side. A branch starts as a conversation; `@agent`
  there makes it agent work. **A branch from agent work starts with `@agent `
  typed**, so going on with the agent is one Enter away; alone it sends
  nothing, and deleting it makes the branch a conversation.
- **At an agent thread's end, `→` opens a branch too**, the same as on any
  other message: with `@agent ` kept, the agent's work forks there; with it
  deleted, a conversation steps back down from the end, reading everything
  above. The agent thread's column keeps following its lane. At a
  conversation's end `→` is hidden, since it would be the same as replying.
- Every one of these only opens a column. Nothing is written until the first
  send, and closing the column first leaves no trace.

### Messages

- The speaker's name heads each human message; the agent's messages are marked
  as the agent's.
- **Tool calls are rows under the agent's message** (ADR-0022): what the call
  touched (`read packages/core/tree.ts`, `bash pnpm test`), then ✓, ✗, or …
  while it has no result, with the result folded away. A long or multi-line
  command is cut in the label, and the opened row shows it whole in its
  place. A result is its own
  entry in the tree, but it belongs to its call, so it adds no message and no
  row on the rail.
- **An image a tool read is drawn in its row** (ADR-0051), which opens on
  its own, capped at 10rem tall. The image takes the place of the caption
  ("Read image file [image/png]"), which is its tooltip; a click on the
  summary shows it whole, and a click on the image opens it in the pane
  (ADR-0078), Cmd- or Ctrl-click in a new tab.
- **While the agent works, its column shows it live**: the reply as it is
  written, and each running command's output in its own row, open, following
  its end as a column does. Each becomes the committed message or result in
  place, and a column at its end does not get shorter while the agent works
  (ADR-0044).
  **Stop** ends the turn, and records who pressed it under the ask
  (ADR-0056); cards queued are then taken.
- **A column says what its agent is doing** (ADR-0054), and none of it moves
  the column. While the agent works, the mark before the thread's name in the
  header (its `✦`, or its banner, ADR-0053) pulses, titled with the ask it
  works on, "the agent is working on Ada: "Fix the rail…"" (ADR-0056). In
  outline, the running ask's own line pulses instead of the line below. A
  short line pulses at the
  end of the column, centred, where its next text will appear. While a
  command that has run for half a second is still running, its row is
  outlined instead, and the line hides: the wait is the machine's, not the
  model's. A quicker command changes neither.
- **A tab shown again draws its tool rows as they were left** (ADR-0049):
  a running command's row open, a row you opened or closed the same way.
- **Pasting an image into a composer puts it in the message** (ADR-0042).
  It is uploaded as it is pasted, and its markdown, `![name](/blob/…)`, goes
  in where the cursor was; the send button reads "uploading image…" until
  it is done. Sent, the message draws the image at its stored size, capped
  at the column's width. A click opens it in the pane, fitted to its width,
  where a click on it shows its own size and **open in a new tab** shows it
  alone; Cmd- or Ctrl-click opens a new tab at once. The agent is
  given the image itself, after the text. An image no longer stored refuses
  the send, and the text comes back to the box.
- **A table in a message has a bar above its right edge, always shown**
  (ADR-0078). Its ⤢ ("open the table beside the thread") opens the table in
  the pane, where it scrolls both ways under its pinned header row, titled
  by its header cells; pressed again ("close the table"), it closes it. In
  a reply still being written it waits ("the reply is still being
  written"). A table keeps its words whole, and one wider than the column
  scrolls sideways in it.
- **A message's tools are one row** over its top right, shown on hover or
  focus (ADR-0043): *copy* first, then *edit*, and `→` last, in the
  right margin, since what it opens appears to the right. Copy puts the
  message on the clipboard as markdown: its text as it was written, then
  each tool call it made, the command or path and its whole output. It
  shows a check for two seconds; over plain http, which has no clipboard,
  it selects the message's text and tool rows for you to copy. Beneath a message stay only the
  buttons of branches no column shows.
- **Edit sends a person's message again, changed or not**, as a sibling: a
  branch at its parent whose composer holds its text as sent. The original
  stays. It asks the agent exactly when the original did, so a message its
  thread's default sent to the agent starts with `@agent`. Anyone's message
  can be edited, and the edit is the editor's. On a root's first message,
  which has no parent, the tool is *new tab*: a new tab holding its text, an
  agent's when the message asked the agent. An agent's reply offers no edit:
  that would be a reply the agent never gave.

### Drafting cards (ADR-0048)

- **What you type in a composer is a card on its thread.** The first
  keystroke worth keeping (anything but a branch's `@agent `) makes it. It
  belongs to the thread, not the column: switching tabs, reloading, closing
  and reopening the column, or the host restarting, you find it where you
  left it, and it follows the thread as the thread grows. A new tab's or a
  new branch's card belongs to its column until its first message is sent.
- **Everyone at a thread's end sees everyone's cards there**, above their own
  composer, headed "Ada's draft · with Bea", and can type in any of them and
  send it. A card sent by someone other than its owner is the sender's
  message, "with" the others who wrote in it.
- **Marks say where you left something unsent** (ADR-0048): a small dot in
  your colour on its tab, and on the rail at its thread's end, whether or not
  that thread's column is open. A root whose tab you closed is marked on the
  Archive tab and its row; an archived root only on its row, since its work
  is done. Only your own cards count, and only while they
  hold text: emptied, sent or discarded, the dot goes. A bare `@agent ` is
  nothing typed.
- **Sending spends the card.** The box stays as it was until the host
  answers: written or running, the card is gone and the box empty; a
  conflict or a refusal leaves the card, so nothing is lost or put back.
- **A send to a busy thread queues your card above the line** (ADR-0048), as
  does a card with a command, even on an idle thread. Every move shows at
  once and is the host's to make (ADR-0059). A queued card is drawn
  after the thread's last message, headed "queued by Bea · 1st in line", with
  what its command does first when it has one, and **unqueue**. Anyone here
  can edit it until the host takes it, when the lane is free, in order. An
  unqueued card goes back below the line. Unqueue a card the host had already
  taken and your column says "already sent as Bea's message: it was taken
  before you unqueued it". A move someone else made first is undone on your
  screen, saying "not moved: Bea moved it first". A card the host could not
  send is back below the line saying "not sent: …" until it is queued again.
- **Cmd+Z in a box undoes only that box's card**, never anything in another
  column or tab (ADR-0052). After you undo past a card's first keystroke,
  the box is empty but keeps its card, and Cmd+Shift+Z there brings the text
  back.
- **Cmd+Z and Cmd+Shift+Z** undo and redo your own typing in a card, never
  someone else's. Each tab has its own history, which a reload forgets.
- **Closing a new branch that holds text asks** "keep what you typed in your
  inventory?": **keep in inventory** (focused, the default), **discard**,
  which is final, or **cancel**. Keep moves every card in the branch with
  text into your inventory, and closes the branch once each is there; with
  too few empty slots it says so ("not kept: needs 2 slots, 1 free") and the
  branch stays open.
- **A new branch shows every card in it**, a card put there among them, and
  its first message leaves the others drafting below it.
- **"+ card" starts another card in the same place.** The composer empties
  and stays focused; the card you were writing is drawn above it, still
  yours to edit or send. Nothing is made until you type something worth
  keeping, and after a send the box takes your other card back.

### Pinned cards (ADR-0048 step 5)

- **A pinned card says what a thread is for**, and the agent reads it on
  every run. It sits in a strip at the top of the thread's column, under the
  header, and stays there as the messages scroll. A new tab or a new branch
  has none until its first message is sent.
- **Pin** a card below the line with its **pin** button, or drop a card on
  the strip: while you drag a card, a thread with no pinned card shows "drop
  a card here to pin it for the agent" there. **Unpin** puts it back below
  the line; **take** moves it into your inventory. Both pin and unpin are
  moves the undo key outside a box undoes.
- **"+ pin" writes a new pinned card**: in the column's header while the
  thread has none, at the end of the strip once it has one. The box it
  opens pins what you type from the first keystroke; Enter is a new line,
  and Escape or clicking away closes it.
- **Anyone here can edit a pinned card**, as a queued one. Each is headed
  "pinned by Bea", and shows its size, "~120 tokens", since a long one costs
  that on every run, and how it stands: "read by the agent", "changed since
  the agent last read it", or "not read by the agent yet".
- **Where a run read them**, a small "the agent read 2 pinned cards" sits
  above its prompt; it opens to the text the agent read, and to "no longer
  applies: “…”" for a card unpinned since. A card edited just before you
  send reaches that run.
- **A branch starts with no pinned cards.** Its agent is told its parent's
  no longer apply, quietly: the branch's column shows nothing for that. To
  keep a direction, take a copy of the card and pin it in the branch.
- **Pinned cards are not unsent work:** they mark no tab and no rail dot.

### History and traces (ADR-0048 step 6)

- **Every card has a history button.** It lists where the card has been and
  who moved it, oldest first: "created by you", "queued by Bea", "unpinned
  by Carl (an undo)", then "written by you, Bea".
- **A card someone else moved back below the line says so** beside its
  heading: "unqueued by Bea", "unpinned by Bea", until it moves again.
- **A trace stays where your card was** when someone else moved it while you
  had no column open on that thread: "Bea queued this", "Bea sent this →",
  "Carl took this", or "3 cards moved by Bea". Only you see your traces.
  Click one to go to the card where it is now, or to the message it became.
  A trace is gone once you have seen it, on every device; the column keeps
  showing it until you leave. An unqueue or an unpin leaves no trace: the
  card is still in your column, saying who moved it.

### Your inventory (ADR-0048 step 4)

- **A panel of your own, floating over the columns**, opened and closed by
  **inventory** in the header (which counts your cards). It sits in the
  middle of the screen by default; drag its top bar and it settles left,
  centre or right, and this device remembers where. Only you see it, on
  every tab and device; nobody else can move a card into or out of it.
- **A fixed 3 × 6 grid.** Each slot shows its card's first line in its
  author's colour; the first nine are numbered 1–9. Click a slot, or move
  with the arrow keys or `hjkl` while the panel has focus, to select it; the
  selected card is shown whole beside the grid, and editable. Cards keep
  their slots, gaps included, on every device. Dropping a card on a slot
  that holds one swaps the two.
- **Take** moves a card into your inventory: Ctrl+Shift+I in its box, its
  **take** button, or a drag onto the panel. It lands in the selected slot
  if that is empty, else the first empty one, and flies there; a take while
  the panel is closed shows it briefly. A message's **take** copies its
  text, or your selection in it, as a new card: the message keeps it. Full
  means full: the nineteenth card is refused with "inventory full".
- **Put** moves the selected card below the line at the end of the column
  you were last in: Ctrl+Shift+O, the panel's **put** button, or a drag out
  of the panel onto a column's composer or the cards above it. Held over a
  root's tab, a drag opens it. Put where you have no card, it becomes your
  composer; where you have one, it is shown above it. **Remove** deletes the
  selected card for good.
- **Undo a move** with Cmd+Z (Ctrl+Z elsewhere) while no box has focus;
  Cmd+Shift+Z, Ctrl+Shift+Z or Ctrl+Y redo it (ADR-0066). It undoes your
  newest move in the root you are on, from any of your tabs, after a reload
  or a restart too. As it acts it shows where the card went back: the
  panel, the thread's column, or a branch you closed since, opened again at
  the end of its tab. If anyone moved the card since, it is refused, saying
  who, and nothing moves. A keep of a branch's cards is undone whole. Sends,
  discards and copies are final; so is a keep that closed a new tab, whose
  cards you take back from the panel. An archived root's moves cannot be
  undone, and are forgotten 7 days after it was archived.
- **Undo a swap** with the same keys while the panel has focus: this tab's
  newest swap goes back, unless those slots have changed since.
- **A refusal is said where you acted**: in the panel for a take, in the
  column you aimed at for a put, and where an undo showed.

## What goes away

| today | replaced by |
|---|---|
| "follow the newest" | columns grow on their own; there is no hidden anchor |
| "reading a thread · sending replies here" | every column's composer sends at its own path |
| "make this a conversation" in a bar | nothing: a thread's mode is whether the agent works in it (ADR-0021) |
| "⑂ 1 branch · 2 messages" with a hidden list | the rail, and a coloured fork dot in the column |
| "switch to this path" (`navigate`) | nothing: sending attaches where you are reading |
| every tree in one rail, one after another | a tab per root, each with its own rail (ADR-0029) |
| a column on another root, with no stripe and no fork dot | nothing: a tab's columns share its root |
| the rail's `+`, and Start Chat and Start Agent in place of a composer | the add tab: ＋ agent, or conversation |
| a tab bar shared by everyone, with no close for yourself | your tabs, with **×** (ADR-0030) |
| a new root by anyone appearing as a tab | the header's avatars and activity; you open it |

The last row mattered for `PLAN-2026-09-26-thread-lanes`: with no control moving
a lane, the `navigate` command had no caller and was deleted with `prompt` and
`branch`. Lanes now never move at all (ADR-0020).

## Data

Every part of this is a read of what the document already holds, except the
archive record (ADR-0029); a card's text is its own document (ADR-0048).

- **A column** is a client-local anchor entry. Its path is `projectTranscript`
  of `followTip(anchor)`, or, once it is bound to a lane, of the lane's tip;
  the part after its fork point is the suffix below the column to its left.
- **The rail** is the tree itself, from `parentId`, drawn in id order, which is
  creation order (uuidv7).
- **A thread's mode** is its lane; **names** are `pineta.participant` values.
- **A root** is a root of the tree index (an orphan counts as one). **Your
  tabs** are the roots in your layout's open list that have no `archived`
  record, plus the root you are on.
- **The header** reads presence (people, and the thread each is in) and the
  lanes (the agent's running threads). **Mentions of you** are the chats whose
  mentions `address` resolves to you. **What you have seen** is kept in your
  attention document (`attention:<you>`, ADR-0077), on every device of
  yours: an entry id (`mentionsSince`), at or before which every mention is
  seen, and the ids of later ones you have seen.
- **The archive** is a host-written `pineta.archive` value per root: its state
  (`archived` or `restored`), who changed it and when (ADR-0029). The host
  refuses commands that would write in an archived root.
- **Which tab you are on, your open roots and each root's columns** are view
  state, kept in the browser per browser tab, with the device's latest for a
  new one, and never in the document (ADR-0027, amended by ADR-0029 and
  ADR-0030).

## Deferred, but designed for

- **Narrow screens**: the stacked sequence described above, with the tab bar as
  a switcher above it; built after the wide layout works. The column's pane
  is its first step (ADR-0078): over a narrow window it covers the page,
  and ← goes back to the thread. The header's indicators going on a row
  above the tabs, below 56rem, is another (ADR-0081).
- **What's new since you looked** (ADR-0030 defers it): a last-read position
  per root gives unread marks on tabs, a "3 new" count in the header, and a
  "what's happening" panel listing roots by activity. It can reuse the
  inbox's storage and its rule for "seen".
- **The inbox, grown:** **done** to take a handled mention off it; other kinds
  of item, such as the agent finishing what you asked; one inbox per person
  across devices, once a person has an identity; browser or system
  notifications, which need permission.
- **The review, grown** (ADR-0047): side-by-side diffs; a review of one turn,
  its revision record's commit, through the same URLs; "ask about this" on a
  hunk, which puts its path, line and quoted lines into the column's
  composer; the agent's edit tool rows drawn as diffs, if pi's results carry
  them. (On narrow screens, the review is one more step already: the pane
  covers the page, ADR-0078.)

## Settled while planning

1. **Columns keep a readable width** (28rem); when they overflow, the strip
   scrolls horizontally.
2. **A branch opens next to the column it forks from**, so its colour link is
   short to follow.
3. **Unread tracking** needs a per-person "last read" position. That is presence
   state, so it arrives with presence; until then the rail shows activity only.
4. **Columns scroll independently.** A shared vertical scroll kept every branch
   level with its fork point, but could not show forks far apart together, and
   its connector lines crossed sibling columns.
