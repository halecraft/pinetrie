# S218 — One press can open, or open and start, a branch for each item of an agent's proposal; the presser's page writes Open's drafts

- **Status:** Answered
- **Led to:** ADR-0157

**Question.** ADR-0157 has the agent propose branches with a tool and a
person start them with one press: **Start N** opens N branches at one fork
and sends each one's `@agent <brief>` as the presser's first message.
**Open N** opens them unsent, with each brief as the presser's message in
its composer. **Send K** later sends the drafts still unsent. Is each of
these something the host can do as one command, using primitives it
already has? Where it is not, what is missing? Seven items:

1. **The fork.** The proposal's branches fork at the end of the run that
   called the tool, so they read that run's last word. Can the host find
   that entry from the tool call's entry once the run has ended, even if
   the thread has moved on since? Is a run's end a stored value or
   derived (`packages/rules`, asks; ADR-0106)?
2. **N opens in one command.** `planOpenThread` (`packages/rules/open.ts`)
   opens one branch, its card placed after its parent (`branchAfter`,
   `packages/rules/task.ts`). Do N branches opened in one step land
   after the parent in the proposal's order, and is the step one undo
   step of the presser's history (ADR-0126, "One gesture is one undo
   step")?
3. **Start: a first message by the presser that asks the agent.** A
   spin-off already writes a thread's first message for its sender
   (`packages/rules/spin-off.ts`), but drops agent mentions, so it never
   starts a run. A send from a page goes through the chat path, which
   creates the lane. Can the host write `@agent <brief>` as the presser's
   first entry in a thread not yet started and start its run, without any
   page sending it? Or should Start queue an ask card by the presser in
   each thread (ADR-0128), for the thread's end to consume? Can a thread
   with no entry and no lane consume a queued card at all?
4. **N lanes from one turn at once.** Start creates N lanes forked from the
   same turn of the parent's lane. Do concurrent lane creations from one
   bookmark succeed, under the lane queue, for a folder project and a jj
   one? Measure correctness only, not cost: a limit on concurrent runs is
   out of scope (ADR-0157).
5. **Open: a draft that belongs to the presser.** Your message is a text
   card at a `composing` place, with an owner (`packages/core/places.ts`).
   Can the host make one owned by the presser, holding the brief, in each
   opened thread? Does the presser's page then draw it in that column's
   composer as their own message? Can the press also unfold the N columns
   for the presser, when unfolding is the presser's own view
   (`CardView`, `packages/interface/canvas-columns.ts`)?
6. **What others see of a thread opened and not sent.** A thread not yet
   started is a card on its task's canvas (`packages/core/places.ts`,
   ADR-0126), and every page computes `unstartedThreads` from all thread
   records (`packages/web/app.tsx`). But `docs/06-interface.md` says an
   opened branch is "yours alone until its first send". Which is true?
   After Open 10 by Ada, does Bea see ten empty columns, folded, with no
   message?
7. **A tool row with controls.** Is any tool's row drawn with buttons
   today (`packages/interface/tool-row.ts`)? Can the proposal's card read
   its own state from the tree: spent once a Start or Open fact follows
   it, and the count of the presser's drafts still unsent across the
   opened threads?

**Kill criterion.** ADR-0157's "one press" is revised if the host cannot
open a branch and write the presser's first message that starts its run
in one command (item 3), or if N lanes forked from one turn at once can
fail or corrupt one another (item 4). Then Start becomes N sends that the
presser's page makes in turn: still one press, but no longer one command.

**Throw away.** Probe scripts and any scenario written to measure items 3,
4 and 6. Keep only what a plan builds on, in this spike's folder of sources.

**Answers.** Measured on 2026-10-16 in a pine·trie lane, against its
rootless Docker, with the suites' scripted model. The probe was one lanes
scenario (`probe.scenario.ts` in this spike's folder, run with
`PINETRIE_SCENARIO`, then removed from the suite). It ran for a jj project
and for a folder with no repo, with N = 3, 5 and 10 branches; every run
passed every check. The runs' output is in the folder: `run-jj-10.log` and
`run-folder-10.log` (items 1 to 4 and 6), and `run-jj-3-drafts.log` (all
seven, item 5 added).

1. **The fork can be found, and holds still.** From the entry holding the
   tool call, the core's ask index gives the run's prompt (`runOf`) and
   that run's newest entry (`AskIndex.last`, `packages/core/asks.ts`).
   After a person replied below, the run's last entry was unchanged while
   the thread's end had moved on. A run's end is derived from the tree,
   not stored; whether the run still runs is its ask's outcome.
2. **N opens land after the parent in reverse.** Three branches opened
   one after another at one entry were ranked 3, 2, 1 after the parent on
   the canvas: each lands just after its parent thread (`branchAfter`,
   `packages/rules/rank.ts`). Ten branches sent at once landed in reverse
   of their send order for the same reason. So the planner for a
   proposal places branch i after branch i−1, not after the parent, and
   ranks all N in one plan. Opening a thread is no step of anyone's undo
   history (`openThread`, `apps/pinetrie/host/commands/cards.ts`):
   closing a column discards it.
3. **The host can write the presser's first message and start its run.**
   A send is a host command: the host writes the entry as the sender
   (`sendChat`, `apps/pinetrie/host/commands/index.ts`), and a spin-off
   already builds a send of its own for its sender, inside one command.
   The probe sent ten `@agent brief i` messages at once, each as a branch
   at the run's last entry under a new thread id. All ten were
   `started`, each got its own lane, and each run answered. Start can
   therefore be one host command that opens N threads and sends N
   messages through the path a page's send takes. No ask card is needed.
4. **N lanes from one turn at once are correct.** For both project kinds,
   every branch's lane held the parent's file as written in the proposing
   run, and the parent's lane was untouched. The ten sends, their lanes
   and their runs on the scripted model took the whole scenario about
   12 s: a cost, not a check.
5. **The host cannot write a draft; the presser's page can.** The host
   makes cards for anyone (`planMake` with `"host"` refuses only a full
   inventory), but no host port writes a text card's text
   (`CardPort`, `apps/pinetrie/host/cards.ts`): a text is a document its
   clients write, and its writers are read from their clients' ids
   through the seat records. A client's own `createCard` at
   `composing`, with the brief as its text (the path a composer takes),
   was each opened thread's message for its presser (`yourCard`,
   `packages/rules/card.ts`) on the host. Two of the three were then sent
   with their cards: both started, both cards were spent, and the third
   draft stayed. So Open is one host command that opens the N threads,
   whose ids the page mints, then the page writes N drafts; and Send K can
   be the host's, as a queued card's pop reads a text and sends it as its
   writer. Unfolding is the page's own view (`CardView`,
   `packages/interface/canvas-columns.ts`), so the pressing page unfolds
   them; the presser's other devices see them folded.
6. **Others see an opened branch.** A second person's copy held all three
   unsent branches on the task's canvas, with their opener's name on each
   thread record. No page filters a thread not yet started by its opener
   (`unstartedThreads`, `packages/rules/task.ts`; `packages/web/app.tsx`),
   so their page draws a column for each, folded until they unfold it.
   `docs/06-interface.md`'s "yours alone until its first send" was stale
   since ADR-0126; only the opener's message in it is theirs alone.
7. **No tool row has controls today** (`packages/interface/tool-row.ts`),
   and in story density an ask's tool rows fold under its digest line,
   where a proposal would be hidden. So the proposal is drawn outside the
   fold, below the ask's last word, as its own card. Its state can be read
   from the tree: the facts its presses leave follow it in the thread,
   and they can name the threads they opened; the presser's drafts still
   unsent are their `composing` cards in those threads, which the page
   holds.

**Kill criterion: not met.** One host command can open a branch and
start its run as the presser, and many at once fork from one turn without
harm. Open's drafts take the presser's page, as above.
