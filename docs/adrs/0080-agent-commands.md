# ADR-0080 — Commands are host-only or agent-callable, and every command on a thread leaves a fact in it

- **Status:** Accepted (Duane, 2026-10-05)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/pi/TECHNICAL.md`
- **Evidence:** S21, S85, S92, S99, S103, S104, S347
- **Amends:**
  - ADR-0033: a resolution ends like any run. `ask_for_guidance` is renamed
    `ask_about_conflict`, and is accepted while jj finds conflicts in the
    lane's copy; the strip's "needs you" is read from the thread's newest ask,
    conflicts left are the offer's, and `pinetrie.landing` goes (S104).
  - ADR-0038: the agent can catch up when its base has new work, and ask for a
    split, as tools; "split into a stack" queues a card, taken when the thread
    is free; a lane whose work changes no file is caught up before its run; a
    take, a description, a squash and a refresh each leave a fact in the
    thread.
  - ADR-0055: the rejected "tool the agent calls to pull" is taken up beside
    the card command, as `catch_up`, acting only when there is new work; and
    splitting an offer becomes a card command, `split`, which its button
    queues, as the catch-up button does.
  - ADR-0060: a take leaves a fact in its thread, queued as a card while the
    thread runs; the agent catches up with its base through a tool;
    `continue-on-line` stays a person's.
  - ADR-0072: the agent catches up with its parent through `catch_up`, refused
    as the button's command is.
- **Revised:**
  - 2026-10-25 (S347): a card's catch-up with nothing new resolves the
    conflicted merge the lane still holds, named by where that merge came
    from; the agent's `catch_up` still answers nothing new. "Needs you" offers
    "answer the agent", and no bare merge.
- **Amended by:**
  - ADR-0085: the `archive` command is gone; `move-root` and `workflow` change
    the workspace people share in its place.
  - ADR-0126: a fact is a card of its own kind, only ever queued, not a text
    card with no text.
  - ADR-0157: an agent-callable tool may propose what only a person may do:
    `propose_branches` writes only its own call, and the threads it proposes
    start at a person's press.

Also changes `packages/pi/TECHNICAL.md`'s "A running lane is never written": a
tool's own result carries a merge, and a steer carries a host's fact; see
Decision.

**Context.** pine·trie has grown commands the host carries out, each started
by a button and nothing else (`packages/core/intents.ts`):

| command | what it changes |
|---|---|
| `bring-up-to-date`, `continue-on-line`, `catch-up-with-parent` (card commands, ADR-0055) | the thread's own copy |
| `describe`, `split`, `squash`, `refresh` (offer actions, ADR-0038) | the thread's offer in your repo |
| `take` (offer action, ADR-0060) | the project: the line or a WIP |
| `setup`, `land`, `follow`, `publish` (line actions, ADR-0060, ADR-0076) | the project, your files, `main` |
| `stop`, `archive`, `mark`, `retitle`, `move`, `set-command` | the workspace people share |

Two gaps showed (Duane, 2026-10-05):

- **A take leaves nothing in the thread.** It moves a bookmark in your
  repo and marks the lane's one `pinetrie.offer` record taken. The strip says
  "added as …" until the next offer is built over that record, or a
  refresh forgets it (ADR-0061). The thread's timeline never shows it, and
  the agent never learns its work was added. A catch-up, by contrast,
  writes a `pinetrie.update` entry (ADR-0038).
- **The agent cannot see or do what the buttons do.** Whether the thread's
  base has new work is a value the page has (`catchUpOf`,
  `packages/rules/line.ts`): ↓ on the column's header, "the project has
  new work" on the strip (ADR-0061). The model is never told. Catching up
  and splitting the offer into a stack change only the thread's own work,
  yet only a person can start them.

**Decision.**

- **A command is agent-callable when its effect stays inside the thread:
  its own copy, or its own offer. Anything that writes where other threads
  or people read is host-only,** a person's gesture.
  - **Agent-callable:** catching up with the base or the parent, and
    splitting the offer into a stack.
  - **Host-only:** `take` (irreversible once published, and what the
    project holds is a person's call), `continue-on-line` (it changes where
    the thread's work goes), `describe`, `squash` and `refresh` (refresh
    throws away your edits), every line action, and every workspace
    command.
  - The agent asks for a take by making an offer, as it does now: the offer
    and its "work ready to add to the project" attention (ADR-0077) are the
    request.
- **Two tools:** `catch_up` (`from`: `base` or `parent`) and `split_offer`.
  Every lane is given them, whatever its kind, since a run's tool list never
  changes (S85). A call that does not apply is refused with why, as
  `ask_about_conflict` with no conflict is. A button and a tool reach the
  same plan (`planUpdateFrom`, `planParentUpdate`, `planSettle`,
  `planStack`); only the shell that calls it differs.
- **A tool checks the state of what it acts on, never how the run
  began.** A run a person's message started, a resolution and a split
  are all runs; what differs is the lane's copy and its offer, which the
  host reads when the tool is called. Each refusal then names something
  true that can change.
- **Whoever a tool acts for is the person behind the run** (`promptAuthor`):
  a chat's writer, a resolution's or a split's `by`. Every prompt names one.
- **`catch_up` acts during the run, and only when there is new work.**
  - **Only on a copy that is on its own line,** read in the lane, in the
    step that merges: `@`'s one parent is the lane's bookmark or descends
    from it (`planTurnCommit`'s rule for the agent's own commit). So it is
    refused while a split's stack is the working copy. Every catch-up
    checks this, a card's too: a split that failed to move the lane back
    to its tip is the same hazard.
  - **Conflicts do not refuse it.** A copy with conflicts is what
    ADR-0072's catch-up with the parent exists to settle, and jj merges
    onto a conflicted commit as a card's catch-up already does (S99).
  - From the base: when `catchUpOf` is `brings`, or `unknown` and the
    host's read then finds files to change; `current` and `nothing-new`
    are refused as nothing new. From the parent: when `planParentUpdate`
    has a merge (`parentAhead`, and the parent's agent not running).
  - **Refused unless it is the only call in its batch** (S103 item 2): a
    sibling's edit not yet committed would leave the working copy when jj
    checks out the merge, and a sibling still running would write while it
    does. pi stores the batch's assistant message before its calls run, so
    the host reads the calls there.
  - The merge runs on the lane's queue (`updateOnQueue`), after the
    previous turn's snapshot, without `withLaneStarted`, whose end stops the
    container (S103 item 1). Its result is the tool's result, in place of
    the `pinetrie.update` entry, with the merged commits in its `details`,
    which `parentNow` reads as it reads an update's `merged`.
  - **The turn records the merge** (S103 item 3): a turn whose `catch_up`
    result says it merged records the lane's bookmark, so a branch from it
    starts with the merged files. The fact is read from the tree when the
    turn is recorded, so it survives a restart.
  - A conflicted merge gives the agent the conflicts and the
    `resolve-conflicts` skill in the result, and it resolves them in the
    same run: no resolution run of its own (ADR-0033).
- **A split is a card command, `split`** (ADR-0055), for the button and
  the tool alike, as catching up is: the button queues a card with it, as
  the catch-up button does (ADR-0061), and so does `split_offer`. Taking
  the card starts the split's own run under the `offer-stack` skill
  (ADR-0038), with the card's text, if any, as the person's intent. A
  thread that runs takes it when the run ends, so the button is no longer
  refused while the thread works, and `split` leaves the offer actions.
  `split_offer` acts when the thread has an open offer and no split
  running or queued, from any run: the card waits for the run's end, so
  nothing in the run is touched. A split is not done in the run itself
  because the skill moves the lane's
  working copy off its tip (`jj new <start>`) to build the stack: in the
  middle of a run, the agent's later edits would land in the stack, and
  the lane's bookmark could follow them there.
- **Every command on a thread leaves a fact in it**, whoever ran it, worded
  for people and read by the model. One function words each fact
  (`packages/client/TECHNICAL.md`, "Words come from values").
  - A take: "added to the project as `<change>`", with the bookmark it
    moved. A describe, squash or refresh likewise; a catch-up and a split
    already have theirs (`pinetrie.update` or the tool's result, the stack's
    prompt).
  - **A fact is always a queued card** with no text, which starts no run,
    taken in order with the other cards (ADR-0048, ADR-0055). An idle
    thread's drain takes it at once, as it takes a catch-up card; a running
    thread's, when the run ends. One path, whatever the lane is doing.
    Nobody moves it: it is the host's.
  - A line action belongs to no thread: the threads it moves the base of
    are told by the next fact, below.
- **A thread whose base has new work is told so**, for a lane of its own
  whose work changes files, when `catchUpOf` is `brings` and differs from
  what the thread was last told. The fact names the base (`catchUpName`),
  the files catching up would change, those among them the thread's work
  changed too, and whether the offer conflicts with the base now.
  - **When its next run starts**: a message before the prompt, written in
    the commit that admits the run, as the pinned cards are
    (`ThreadLaneHandle.run`, S92).
  - **While it runs**: a steer (pi's `Lane.steer`), which pi places after
    the batch's tool results at the next boundary (S103 item 4). It is
    appended, so it keeps the cache. `turnEntry` climbs past it, to the
    assistant message whose turn it follows.
- **A lane whose work changes no file is caught up before its next run**,
  without asking: it has nothing to lose, and nothing to conflict. When
  its base `brings` and its offer's `WorkChanges` is `none` (never
  `unknown`, ADR-0067), the host runs `bring-up-to-date` first; its
  `pinetrie.update` entry is the fact, and it costs no model run.
- **A resolution ends like any run** (S104). ADR-0033's rule stands: the
  agent can always stop by asking, and can never claim a success the
  repository contradicts. Only where the facts are read changes:
  - **`ask_for_guidance` becomes `ask_about_conflict`.** It is the one
    question the host must know of as a fact: a conflict left on purpose,
    which the offer alone would read as unresolved. Any other question the
    agent ends its turn with, and the run's verdict says it needs you
    (ADR-0077). "Guidance" invited calls for any doubt, which the conflict
    check would then refuse; the name says what it is for.
  - **`ask_about_conflict` is accepted while jj finds conflicts in the
    lane's copy**, read on the lane's queue when it is called, in any run:
    a resolution's, or one whose `catch_up` conflicted. The skill leaves
    what it asks about unresolved, so an ask always has a conflict under
    it. Its result's `details` say it asked.
  - **The strip's "needs you" is read from the tree**: the thread's newest
    ask about a conflict, when it is newer than the offer's record.
    (Revised 2026-10-25: from the host's record of the ask, standing until
    the lane's next run ends, ADR-0198. Its strip offers "answer the
    agent", which takes you to the thread's end and your box, and "accept
    anyway"; nothing there merges without your words.)
  - **A catch-up with nothing new resolves what the copy still holds**
    (revised 2026-10-25). A conflicted merge left unresolved in the lane
    (an ask, a run ended mid-resolution) is never fetched into your repo,
    so a later card's catch-up finds nothing new. It then plans that
    merge's resolution again from the merge commit, with nothing merged:
    the files still conflicted, both sides' reasons and the card's text.
    The prompt names where the merge came from, read from its trailers,
    not the command that asked. A merge's parents are read in the order
    they were given, which only jj's template keeps (S347). The agent's
    `catch_up` still answers nothing new: its question is about new work.
  - **Conflicts left are the offer's**, built from the lane's tip when the
    run ends (ADR-0072's `conflictCause` reads them there).
  - `landingEnded`, the host's `asked` set, the `pinetrie.landing` record and
    `planRunEnd`'s step for a land message go. A land message stays the
    prompt of a catch-up a card started.

**Consequences.**

- The timeline records what was done to a thread's work, and by whom: a
  take stays readable after the strip has moved on.
- The model knows when its work was taken, and when the project has moved
  under it, without asking. Neither fact moves text already sent, so
  neither costs the cache (S92).
- A steer that arrives after the agent's last tool call costs one more
  request: pi makes the queued message the trigger of another assistant
  turn (S103 item 4). The base moving at that moment is rare.
- A catch-up the agent starts has no entry of its own: the merge belongs to
  the turn that called the tool. The timeline shows it as that tool's row.
- The tool list changes once, for every lane: each lane is given the new
  list when it is first held (`threadLanes`), and loses its earlier
  thinking once (S85).
- A lane caught up before its run starts from newer files than the person
  last saw it on. Its `pinetrie.update` entry, before their message, says so.
- An agent that asks for a split waits for its run to end before the stack
  is built, and the split costs a run of its own, as the button's does.
- A person can ask for a split while the thread works; it waits in the
  queue, and can be unqueued like any card.
- A conflict is a conflict however it came: a card's catch-up and the
  agent's own end the same way, and both the tools and `ask_about_conflict`
  work in a resolution run once its state allows.
- A host that closes during a resolution leaves it to the next host's
  resume, as any run (S104 item 1); `landingEnded` lost it then too.

**As built.** Where the build departs from the text above, or names what
it left open:

- **The host's module is `base-news.ts`**, beside `pinned.ts`: `behind.ts`
  already named the host's wait for a card whose text is behind.
- **A split is refused while one runs** by the lane's latest prompt: a
  running lane whose prompt is a stack message.
- **A card's catch-up refused off its line** goes back below the line with
  the same words the tool answers.
- **The person behind a run** is its prompt's author (`promptAuthor`), else
  whoever started the lane (`readRunAuthor`): a run of pi's own names no one.
- **Words after ADR-0083.** In code a take is an offer integration: the
  fact's kind is `integrated` (`integratedFact`), and the host pops a
  queued card (`queued-card-pop.ts`). This text keeps the old word.
- **The two suite checks** (a `catch_up` mid-run, a take's fact) are an
  `e2e:lanes` scenario of their own, `catch-up`. They need `container`,
  and have not run yet; their mutations are listed, to run on the Mac.

**Alternatives rejected.**

- **Every command agent-callable, a take behind a confirmation.** The
  confirmation would be a person's gesture anyway, and the offer already is
  the agent's request. An agent that can move the project's bookmarks needs
  a guard better than its prompt.
- **Telling the agent "only when the person asks"**, as `set_banner` is.
  An instruction is not a boundary; host-only is enforced by there being
  no tool.
- **A `describe_offer` tool** taking the agent's message (Duane,
  2026-10-05). The `commit-message` skill is pine·trie's, not the agent's to
  choose (`disable-model-invocation`), and is given what a lane's agent
  cannot see: your repo's recent descriptions, to follow its conventions.
  During a run the offer is still the last run's, so the message would
  have to wait for the run's end, and describe work the agent may yet
  change. The one-shot request already reads the thread's messages since
  the last take, so what the agent says about its work reaches it.
- **Splitting during the run**, the stack checked at its end. The skill
  takes the lane's working copy off its tip (above).
- **Refusing the tools unless a person's message started the run.** It
  stands in for the state that matters (a stack as the working copy,
  conflicts left), refuses a resolution that has finished resolving, and
  says nothing the agent can act on.
- **Keeping the name `ask_for_guidance`.** It reads as a tool for any
  question, while the host accepts it only over a conflict.
- **Keeping `pinetrie.landing`, written at any run's end.** Its two facts
  are already in the offer and the tree; a record would be a third copy
  to keep in step.
- **Gating `ask_about_conflict` on the newest revision record's
  conflicts.** A turn's record is written after its snapshot, unawaited,
  so a call soon after a merge can find the turn before it (S104 item 2).
  jj in the lane is never late.
- **Tools offered only when they apply.** A tool list that changes between
  runs costs the lane's earlier thinking on Anthropic (S85).
- **Each tool's `executionMode: "sequential"`** to keep `catch_up` out of
  parallel batches. pi's harness reads only the run's setting, never a
  tool's (S103 item 1); making every batch sequential slows every lane.
- **The base's state in the system prompt.** It changes the prefix, and
  loses the whole conversation's cache (S92).
- **The base's state in a tool's result** (pi's `after_tool` hook). It
  mixes the host's fact into the output of an unrelated call, and says
  nothing to a run that ends without one (S103 item 4).
- **A take's fact written into a running thread.** It lands by timing,
  inside the agent's turn or after it (S21).
- **A fact appended at once to an idle thread, and queued only for a
  running one.** Two paths for one fact, where the queue's drain already
  takes a card at once on an idle lane.
- **Recording the catch-up's merge by a hand-off in memory** from the tool
  to the turn's record. The tool's result already says it merged, in the
  tree; a hand-off is lost on a restart.
- **Refusing `catch_up` on a copy with conflicts.** It would refuse the
  catch-up with the parent that settles a conflict the copy came with
  (ADR-0072).
- **Waiting for the run to end, then writing a take's fact.** It is what a
  queued card does, without a place in the order of the cards around it.
- **Catching up every lane before its run.** A lane with work of its own
  can conflict, and the person may want it on the base it has (ADR-0038).
