# S294 — which of pine·trie's requests must not be carried out late, and what each needs to be judged when it arrives

- **Status:** Answered

For ADR-0202, under which a request made offline is an intent in a log,
taken when its authority next sees it: minutes or days after it was made.
The host judges each request against what holds when it arrives, and some
already carry what they assumed (a move's `from`).

**Question.**

1. For every kind of `Intent` (`packages/interface/intent.ts`) and every
   host command (`apps/pinetrie/host/commands/`): what does it assume
   about the state it was made in, and does the host check that
   assumption now (the gate, `packages/rules/gate.ts`, and each command's
   plan)?
2. Which become wrong, harmful or surprising when carried out late, and
   why: a send whose thread has moved on, a stop after the run ended, an
   accept of proposed changes that changed since, a publish, a move of a
   card someone moved since, a restore?
3. For each of those: is it refused, carried out with words saying it
   was late, or carried out as is? What would the intent need to carry
   (the version it saw, the tip, a time) for the authority to decide?
4. Is there a kind no intent should be for, because it only makes sense
   while connected?

**Kill criterion.** None: the answer is a table, read from the source.
If a kind cannot be judged late from anything an intent could carry, it
stays a request that needs the authority connected, and the ADR says so.

**Throw away.** Nothing is built. The table goes in this file.

**Answers.**

The host's commands are `Intent` in `packages/core/intents.ts`, which the
codec decodes and `apps/pinetrie/host/commands/index.ts` carries out. Every
command passes the gate first (`planGate`, `packages/rules/gate.ts`): it is
refused in an archived canvas, in a thread someone holds or trashed, and
where a run would start on a lane of another kind. That holds late as it
does now, so the table leaves it out.

Verdicts: **refuse** when what it assumed has changed, with words naming
who changed it; **with words** when it is carried out and says it was
late; **as is** when lateness changes nothing it means, or a check it has
already refuses it.

1. **Every host command.**

| command | assumes | checked now | late | verdict | must carry |
|---|---|---|---|---|---|
| `send`, at a thread's end | the end it saw (`seen`); nobody else asked the agent since; its card's and pinned cards' text versions | yes: another person's compelled message since `seen` is a `conflict` (`raceAlong`, `packages/core/tree.ts`); a busy lane queues the card; a run waits for the texts (S96) | an agent reply after `seen` is no race, so a message written before it is appended after it, unframed | with words: ADR-0202's four cases | `seen`, as now |
| `send`, a branch | its fork exists; its thread, root and canvas ids are new; its base exists | yes: `unknown-target`, `thread-taken`, `root-id-in-use`, `canvas-id-in-use`, `bad-base` | a run starts later than asked, as the sender asked | as is | as now |
| `reserve` | the thread is unstarted | yes: `thread-taken` | nothing | as is | as now |
| `name` | nothing | no | an older name taken after a newer one from another device | as is, in each author's order | its author's sequence number |
| `picture` | its blob is stored | yes: `image-missing` | the blob not yet uploaded is refused | as is, once its blob is stored | as now; it waits for the blob |
| `stop` | the run it saw is running | no: it aborts whatever runs on the lane now (`planStop`) and is idle-safe only | it stops a run its sender never saw | refuse, as nothing, when that run has ended | the run's prompt |
| `carry-on` | the ask it saw stopped is the tip's | partly: the tip's ask must have ended stopped (`carryOnState`) | it resumes another ask that someone stopped since | refuse | the prompt it saw stopped |
| `ssh-access` | the lane's access as its owner saw it | partly: the answer must fit the state now (`planAccessAnswer`), the host is kept | an allow made before the owner denied or took back from another device grants again | refuse | the state answered: its kind, host and time |
| `queue-hold`, hold | no hold | yes: idempotent | a hold on a queue that has emptied | as is | as now |
| `queue-hold`, release | the hold it saw | no: it deletes any hold (`planQueueHold`) | it releases a newer hold of someone else's, and the next card is sent | refuse | the hold: who, and when |
| `queue-card` | the card is where it saw it | yes: `moved`, `gone` (`planQueueCard`); hold-if-idle reads running when taken | nothing the refusal does not say | as is | as now |
| `unqueue-all` | the cards queued as it saw them | no: it takes back every message card queued now (`planUnqueueAll`) | it takes back cards others queued since | carry out for the cards it saw only | their ids |
| `set-command` | the command it replaces | no: `gone` and `no-place` only (`planSetCommand`) | it overwrites a command someone set since, and a queued card pops with it | refuse | the command it replaced |
| `spin-off` | the card is where it saw it; new ids | yes: `moved`, taken | nothing | as is | as now |
| `move` | each card is where it saw it (`from`) | yes: `moved`, `gone`, `full`, `someone-elses`, `left-taken`, with the card as it is now | nothing the refusal does not say | as is | as now |
| `reorder` | the card and its neighbours as it saw them | yes: `moved`, `order-changed` (`planReorder`) | nothing | as is | as now |
| `card-width` | the card on the canvas it saw | the place only, not the width (`seenOnCanvas`) | it undoes a later width | refuse | the width it replaced |
| `card-tick` | the card on the canvas it saw | the place only, not the box | a late tick undoes a later clearing, or the reverse: a box means done | refuse | the box it replaced |
| `undo-move` | the sender's newest move | yes: whole or refused | none while the sender's own intents are taken in order | as is | its author's sequence number |
| `paste` | the card it replaces where it saw it (`Replacing.from`); a cut card in its cutter's trash | yes | nothing | as is | as now |
| `copy-thread` | the end it saw (`end`) | it forks at `end`, not at the end now | the copy ends where its sender saw it, as meant | as is | as now |
| `open-thread` | new ids; the fork and canvas exist | yes: `taken`, `unknown` (`planOpenThread`) | nothing | as is | as now |
| `branch-out` | the proposal is ready, its rows unpressed | yes: `no-proposal`, its state (`planBranchOut`) | nothing | as is | as now |
| `put-images` | the blobs are stored; the column exists | yes: `image-missing`, `no-place` | a blob not yet uploaded is refused | as is, once its blobs are stored | as now; it waits for its blobs |
| `version` | the image exists | yes: `gone` | the host stamps a version when it takes it (`planVersion`), so a late one becomes the newest over versions made after it | with words, ordered by when it was made | the time it was made, and the version it followed |
| `traces-seen` | nothing | idempotent | nothing | as is | as now |
| `move-canvas` | the canvas's state as it saw it (`from`) | yes: `moved`, `canvas-busy` (`planBoardMove`) | nothing | as is | as now |
| `workflow`, add | nothing | yes: a name | taken twice, it makes two states | as is, once | its intent's id |
| `workflow`, rename | the name it replaces | no | it overwrites a later rename | refuse | the name it replaced |
| `workflow`, move | the state exists | yes: `unknown-state`, the archive's | nothing | as is | as now |
| `workflow`, remove | the state is empty, not the last | yes: `state-not-empty`, `last-state` | nothing | as is | as now |
| `mark` | the title it replaces | only whether it is already so (`planMark`) | it overwrites a title someone set since | refuse | the title it replaced |
| `retitle` | no title since; a model call is wanted | no: an asked title replaces even a person's (`planTitling`) | it pays for a call and overwrites a title someone set since | refuse | the title it saw, or none |
| `proposed`, accept | the changes as shown (`seen`) | yes: `not-as-shown`, `bad-destination` | nothing | as is | as now |
| `proposed`, squash, describe, refresh | the changes as its sender saw them | no: `seen` is null for these | a refresh discards edits made since; a squash folds revisions added since | refuse | `seen`, as an accept carries it |
| `setup` | your `@-` as its sender saw it | no (`actOnAccepted`) | it sets accepted work up at a commit its sender never saw | refuse | the commit seen |
| `publish` | accepted work as its sender saw it | partly: `not-fast-forward`, `working-copy-conflict`, `no-publish` | it publishes accepts made since, outside, for good | refuse | accepted work's tip seen |
| `restore` | accepted work's newest as the preview showed it | yes: `not-as-shown` (`planRestore`) | nothing | as is | as now |
| `resolve` | the conflict it saw at that path | partly: `no-conflict`, `thread-running` (`planResolveCommand`) | after another catch-up, it closes a newer conflict at the same path | refuse | the conflict's state |

2. **Every intent of the page's** (`packages/interface/intent.ts`) is one
   of three. Most are the page's own and reach no host: `density`,
   `details`, `focus-card`, `column`, `move-column`, `fold`,
   `fold-canvas`, `show`, `close`, `move-in-list`, `board`, `fold-list`,
   `page`, `search`, `open-at`, `open-link`, `sign-out`, `copied`,
   `save`, `edit-as-text`, `inventory`, `undo-answered`, `open-trace`,
   `not-needed`, `sent-first`, `new-card`, `branch-instead`. Under
   ADR-0202 they are writes to your own documents and need no one. The
   rest become the host commands above, and are judged as those are:
   `trash`, `restore`, `put-away`, `put`, `paste`, `to-note`,
   `to-message`, `pin`, `unpin`, and `pin-to-canvas` are `move`s; `add-column` is a
   `move` that creates its column, or an `open-thread` for a thread's; `queue`, `queue-new` and `queue-reference` are `queue-card`;
   `unqueue` a `move`; `reorder` a `reorder`; `hold-queue` a
   `queue-hold`; `unqueue-all`, `set-command`, `spin-off`, `copy-thread`,
   `card-width`, `card-tick`, `undo-move`, `put-images`, `retitle`,
   `resolve` and `proposed` their namesakes; `add-version` a `version`;
   `rename` a `mark`; `new-canvas` an `open-thread`; `move-canvas` and
   `edit-workflow` a `move-canvas` and a `workflow`; `proposal` a
   `branch-out`.

3. **The ones that need more than they carry**, fifteen in all, share one
   cause: each names its target but not the state of it that its sender
   acted on. `stop`, `carry-on`, `ssh-access`, the release of a queue's
   hold, `unqueue-all`, `set-command`, `card-width`, `card-tick`,
   `workflow` rename, `mark`, `retitle`, the three `proposed` actions but
   accept, `setup`, `publish` and `resolve`. The rest already carry what
   they saw (a move's `from`, a send's `seen`, an accept's `seen`, a
   restore's `seen`) and refuse with words when it changed.

4. **No kind needs its authority connected**, once each carries what it
   saw: a late one is then either refused or does what its sender meant.
   `stop` comes closest: its worth decays, and a late one is mostly moot,
   which its refusal says. `ssh-access` is the one where carrying it out
   late is a security matter, not a surprise.

**Consequences.**

- **One rule covers every kind: an intent names what it saw of its
  target**, a version, a value or an id, and its authority refuses it
  when that changed, naming who changed it. pine·trie's moves, reorders,
  accepts and restores already follow it. ADR-0202 can state it once
  rather than give each kind a time.
- **A time made is needed only to order**, not to judge: a version
  among versions, and a late message's framing, which ADR-0202 already
  takes from its parent.
- **A late send is the only one carried out with words**: ADR-0202's
  framing cases are its words. Today the host appends it after an agent
  reply it was written before, with nothing said.
- **Intents that share a blob wait for it**, as a send waits for its
  card's text version (S96): `picture`, `put-images`, `version`, and a
  send sharing images. Offline, the intent can arrive before its upload.
- **A command the host mints an id for is taken exactly once by its
  intent's id**: `workflow` add, and `put-images` with no `made`.
- **Under ADR-0202 several stop being requests**: moves, reorders, a
  card's width and box, and probably titles and the workflow's names are
  members' writes to a canvas or the board, and a late one is a merge.
  For those, a write made after seeing another wins everywhere, and only
  writes made while neither saw the other fall to the arbitrary winner
  (S289). Their rows above hold while they are host requests.
- **What stays a request, and needs this rule**, is what an authority
  does: the agent's runs (`send`, `stop`, `carry-on`, `queue-card`,
  `queue-hold`, `unqueue-all`, `set-command`), the lane's access
  (`ssh-access`), and your repo (`proposed`, `setup`, `publish`,
  `restore`, `resolve`).

**Method.** Read from the source at accepted work as of 2026-10-20: the
host's `Intent` in `packages/core/intents.ts`, its places' types in
`packages/core/places.ts`, the dispatch in
`apps/pinetrie/host/commands/index.ts`, the gate in
`packages/rules/gate.ts`, and each command's plan in `packages/rules`
(`message.ts`, `stop.ts`, `queue-hold.ts`, `in-place.ts`, `access.ts`,
`mark.ts`, `title.ts`, `board.ts`, `open.ts`, `proposal.ts`,
`put-images.ts`, `resolve.ts`, `proposed-act.ts`), `packages/core/tree.ts`
for a send's race, and `packages/folder/accept.ts` for a restore. Nothing
was run.
