# S279 — One plan per card command takes 20 package names out of its shell and 15 out of rules' index, and turns three suite checks into unit checks

- **Status:** Answered
- **Led to:** ADR-0193

**Question.** The coupling survey found the host importing about 400
distinct names from `@pinetrie/rules` and 241 from `@pinetrie/core`, most
of them used by one host file. Is that the shell stringing helpers
together around its plans? If each operation instead reads its facts once,
calls one plan and carries out the result, how many names leave the shell
and the packages' indexes, what does it cost, and where in the host does
decision logic sit today?

**Kill criterion.** Fewer than a third of the pilot shell's helper imports
go; or a plan needs the shell to read between decisions for anything but
what the decision names to load; or the pilot's checks get slower, or a
check is lost.

**Throw away.** Nothing of the pilot: its code is the plan's first phase.
The two probes stay beside this file, since the plan runs them again
after each phase:

- `S279-one-plan-per-card-command/operations.mjs`: every host operation
  (the named function or method a package value is used in), the package
  values it uses, sorted by name into gathers (`read…`, `@pinetrie/reads`),
  plans (`plan…`) and helpers (anything else not a constant, a class or an
  id maker); it lists the operations that call two plans, or a plan and
  two helpers, or four helpers.
- `S279-one-plan-per-card-command/index-unused.mjs`: the names core's
  and rules' indexes export that no other package imports, sources and
  tests.

## Answers

1. **Where the host decides today.** Before the pilot, 475 host
   operations use package values; 68 combine in the shell by the probe's
   threshold. Read one by one, they fall into five kinds:
   - **Decisions glued between plans**: `commands/send.ts`'s
     `sendMessage` (5 plans, 11 helpers), `relays.ts`' `deliverRelay` (3
     and 8), `digests.ts`' `ended`, `work/turns.ts`' `turnDone`, and the
     pilot's `move` (a closed new canvas's card trashed with it) and
     `paste` (its target resolved, then the paste, then the drains).
   - **Writes the shell builds**: `setRecord` is called in 21 host files.
     Where the shell builds a record it decides what is written: a put's
     titles (pilot), `commands/board.ts`, `commands/lane.ts`' stop,
     `seats.ts`.
   - **Facts the shell derives from what it read**: `indexAsks`,
     `threadEnd`, `runPrompt` and `entryThread` before `planBranchOut`
     (pilot), in `digests.ts`, `answers.ts`, `commands/lane.ts` and
     `allowances.ts`; and one derivation written out four times in the
     folder adapter (`stateGraph`, then `folderNewest`, `laneNewest` and
     `folderStateHeld`: `folder/keep.ts`, `folder/proposed.ts` twice,
     `folder/file-at.ts`).
   - **A read that depends on a decision**: the history of moves whose
     stack a card command loads. The plan names it and the shell loads it
     after (pilot). An undo (the stack's top, then the plan, the revert,
     then the answer) and a publish (four plans across jj's steps) are
     phases: I/O the first decision asks for comes before the next one.
   - **Words at the edge**: `encode…`, `…Words`, `…Line`. They word a
     decided value, and are not a combination.

   `settings.ts`' 21 helpers are declarations (`defineTable`, `choice`…),
   not decisions, and are left out.

2. **The pilot**, `apps/pinetrie/host/commands/cards.ts`: `move`,
   `paste`, `putImages`, `version`, `reorder` and `cardWidth` read their
   facts once (`cardFacts`), call one plan each from the new
   `packages/rules/card-commands.ts` (`planCardMove`, `planCardPaste`,
   `planImagesPut`, `planImageVersion`, `planCardReorder`,
   `planCardWidth`), and are carried out by one function (`carryPlan`).
   `planBranchOut` takes which lanes run and reads the asks and the
   proposing run itself.
   - **The shell's imports**: core values 17 → 7, rules values 31 → 21
     (16 out, the 6 plans in); types 40 → 42. The file is 1181 → 1048
     lines; the plans are 346, their tests 298. Of the shell's 48 package
     values at the base, 24 were helpers by the probe's sorting: 15 of
     them are gone, with 3 constants and the 8 planners the new plans
     call, and 6 plans came in, 20 names fewer.
   - **Rules' index**: 15 names are imported by no other package once the
     shell stops importing them (`afterSteps`, `canvasOfTarget`,
     `emptiedCanvases`, `lanesToDrain`, `mintWith`, `NewImage`,
     `planCanvasesTrashed`, `planMoveRequest`, `planMoveTargets`,
     `planPaste`, `planPutImages`, `planVersion`, `planWidth`,
     `VersionBlobs`, and the new `CardRefusal`), and leave it; 9 come in
     (the 6 plans, `CardFacts`, `CardPlan`, `StoredBlob`): 647 → 642.
   - **Core's index loses nothing.** The core helpers the shell no longer
     imports (`indexAsks`, `threadEnd`, `runPrompt`, `entryThread`,
     `TRASH_PLACE`, `parseTitle`, `MAX_TITLE`, `historyScope`, `refused`,
     `branchesByProposal`) are imported by interface, web, protocol or
     reads too. Deeper plans shrink rules' surface and the host's imports,
     not core's.
   - **Checks.** Six host unit mutations whose bug is now in a plan move to
     `scripts/mutations/rules.ts`, against the plans' own tests, and six
     more are added there; all twelve are killed by `packages/rules` alone.
     Of the four suite mutations on the pilot's lines (three in the host
     suite, one in the browser's), each re-anchored and still killed,
     three are now caught by unit tests too (`pnpm mutate … --against`):
     a paste recorded as a move, a paste in no history, a closed new
     canvas left on the board. The fourth, a move written as two changes,
     is the shell's own wiring and stays a suite check. The host suite's
     `board` and `cards` scenarios pass.
   - **Cost.** A command reads the places once; before, `queueCard`,
     `paste` and `move` read them two or three times. The reads that need
     an await stay where they were: entries' threads before the plan, the
     history's stack after it. `cardWidth` now takes the canvas index, as
     every other card command did.

3. **Rules' index already drifts.** At the pilot's base, 130 names in
   rules' index are imported by no other package, and core's `export *`
   gives 61 such names (S271 and S270 count them at their own commit).
   The index rule is not checked, so freed names stay unless someone
   removes them; the pilot removed its own by hand.

4. **The `plan…` functions inside the host.** 37 are declared in
   `apps/pinetrie/host`; 36 are pure. Most decide what only the host knows
   of: routes and admission, the invocation, the store's migrations, the
   start and its checklist, shutdown's order, the upkeep of roots, a
   change's close. Moved to a package, each would add an export and take
   none away. Five decide about a package's shape, and moving them would
   take helpers out of that package's index: the folder adapter's
   `planKeep`, `planFolderRecords` and `planLineRead` (`@pinetrie/folder`,
   with the derivation in 1), `work/update.ts`' `planGetLatest` and
   `planSettle` (`@pinetrie/rules`' `update.ts`), and `jj/proposed/marks.ts`'
   `planMarks`.

**Read from source rather than run:** that nothing writes the places
while a keeper step awaits a history's stack (`commands/cards.ts`' header,
`move-history.ts`' `gestureOf`, which loads a stack and writes no
places), so planning before the load, as `move` already did, is planning
over the same places.

**Decision.** The kill criterion is not met: 15 of 24 helper imports went,
no plan needed a read between decisions beyond the history it names, and
every check held, three of them now provable in seconds. The rollout goes
operation by operation, under ADR-0193.
