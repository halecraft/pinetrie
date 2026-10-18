# S252 — Most record types in core are named only by rules and the packages above it

- **Status:** Answered
- **Led to:** ADR-0180

**Question.** `@pinetrie/core` says it holds "every record's type", and
`@pinetrie/rules` says it types each stored shape and is its single
authority. Core's own reason for holding a type is that `lanes` or `jj`
must read, write or name it, since neither can declare `@pinetrie/rules`.
Which of core's exports does any package that cannot declare rules use,
directly or through another of core's declarations, and which record types
fail that test?

**Kill criterion.** If most record types are named by a package below rules,
or by core's own code, the rule stands as written and nothing moves.

**Throw away.** Nothing: ADR-0180 keeps the census as a review aid, to run
again when a type's place is in question.

## Answers

1. **Of 663 exports, 77 types fail the test**: no package that cannot
   declare rules names them, and no core declaration that stays does.
   Twenty-two of them are record types, each with its `RecordSpec` in
   rules: `AcceptedRecord` (`accepted.ts`), `AccessRecord` (`access.ts`),
   `BannerRecord` and `IconsRecord` (`banner.ts`), `BaseRecord`
   (`base.ts`), `CardHistoryRecord` and `TraceRecord` (`card-history.ts`),
   `CommandsRecord` (`commands.ts`), `DigestRecord` (`digest.ts`),
   `MarkRecord` (`mark.ts`), `NameRecord` (`names.ts`), `NoteColumnRecord`
   (`note-column.ts`), `ParticipantRecord` and `PictureRecord`
   (`participant.ts`), `ProjectRecord` (`work.ts`), `QueueHold`
   (`queue-hold.ts`), `RootRecord` (`roots.ts`), `RunEndReportRecord`
   (`run-end-report.ts`), `SeatRecord` (`seat.ts`), `SetupRecord`
   (`setup.ts`), `SharedLineage` (`shared.ts`), `Workflow` (`board.ts`).
   The folder halves of two unions fail it too: `FolderAcceptedRecord` and
   `FolderBaseRecord`.
2. **Twenty-one more types are only parts of those records**, or, for
   `CommandRef`, of a person's message as rules stores it (`message.ts`):
   `OutsideHost`, `PersonalAccess`, `IconSource`, `CardEvent`,
   `TracedPlace`, `TracedKind`, `CommandSummary`, `CommandKind`,
   `CommandRef`, `DigestBody`, `RunEndReport`, `ReaderUrgency`,
   `SetupModel`, `SetupSession`, `SetupSetting`, `SetupCredential`,
   `ModelLine`, `NoModel`, `SharedVersion`, `SharedWriter`,
   `WorkflowState`; and two constants that type them, `ICON_SOURCES` and
   `NO_MODEL_REASONS`, which only rules and the app use.
3. **Record types that pass, and stay in core:** `ThreadRecord`
   (`branchesByProposal`), `LaneRecord` (jj; `ownLane`), `RevisionRecord`
   (core's tree reads), `ProposedChangesRecord`, `JjProposedChangesRecord`
   and `JjAcceptedRecord` (jj, through `AcceptedFacts` and
   `AcceptanceDecision`), `JjBaseRecord` (jj), `FolderProposedChangesRecord`,
   `StateRecord`, `ConflictRecord` and `WriteJournal` (folder), `CardRecord`
   (core's card reads), `StreamRecord` (schema). Of the brief's candidates,
   only `JjBaseRecord` passes: jj names it.
4. **The rule is already broken the other way:** `BudgetRecord`
   (`packages/rules/budget.ts`, ADR-0128) and `LaneForkRecord`
   (`packages/rules/work.ts`, ADR-0167) are typed beside their specs in
   rules, not in core.
5. **More packages than `lanes` and `jj` need core's types:** `folder`,
   `schema`, `protocol`, `config`, `docker` and `lanehost` declare core
   and not rules too, and `folder` names three record types
   (`StateRecord`, `ConflictRecord`, `FolderProposedChangesRecord`).
6. **No ADR states the rule.** It came with a refactor
   (`f2d2b15c`, "the host decides nothing and runs no jj on an offer"),
   and ADR-0093 restated only its last sentence (what the page draws).
7. **The other 32 types that fail the test are not records**: the image
   store's port (`BlobStore`, `StoredImage`), places' resolved moves,
   proposed changes' decisions, run reports (`LaneRuns`, `RunRecord`),
   `Send` and `Gated`, `StreamEvent`. Several are used by pi or the app,
   not rules. They are left where they are here.

## How it was measured

`census.ts` (in `docs/findings/S252-record-types-census/`) builds the
root `tsconfig.json`'s program with TypeScript 5.9's compiler API (the
repo's TypeScript 7 has none, so 5.9 was installed outside the repo). For
each export of `packages/core/index.ts` it follows every identifier in the
workspace to its symbol, aliases resolved, and records the package that
names it, test or not, and the core declaration it is named in. A type
stays if a package that cannot declare rules names it (in a test as well),
or if a core declaration that stays names it, iterated to a fixed point.
Every value in core stays, so the census moves types only. `census.tsv`
is its output at `2be3c5f52982`, after core's `index.ts` was split
into modules it only re-exports (the census at `22c5babb489f`, before
the split, found the same types): one row per export, `stay` or `MOVE`,
with its users. A grep cross-check found the same names in `jj`, `lanes`
and `protocol` only in comments, and in protocol's own `CommandKind` (a
different type: the wire's command kinds). No core test or fixture names
a type that moves.
