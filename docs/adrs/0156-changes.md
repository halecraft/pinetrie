# ADR-0156 — A thread's work waiting to be accepted is its *changes* to people, and *proposed changes* in code, docs and the agent's words; the offer is retired

- **Status:** Accepted (Duane, 2026-10-16)
- **Area:** `docs/glossary.md`, `docs/the-jujutsu-repo.md`,
  `docs/06-interface.md`, `packages/jj/TECHNICAL.md`
- **Evidence:** S121, S217
- **Amends:**
  - ADR-0100: *offer* is retired; the word is **changes**, and **proposed
    changes** in code.
  - ADR-0105: a thread's proposed changes sit under
    `pinetrie-proposed/<name>`; a starting host renames each
    `pinetrie-offer/<name>`, once.
- **Revised:**
  - 2026-10-16 (S217): the rename is one `jj bookmark rename` per offer, then
    ADR-0154's mark under the new names and a forget of the old; a single
    import of every moved ref was measured and loses a conflicted bookmark's
    sides.

**Context.** *Offer* (ADR-0038, ADR-0100) names a thread's work waiting
for you to accept it. It is a trade's word: an offer is made, weighed,
taken or declined, and it reads oddly beside what a person does with the
work, which is look at what changed and accept it. People who meet it in
the column ask what it is. The word most tools use for this is
*changes*: Track Changes, accept changes, files changed.

*Changes* alone is too vague for code. It already means jj's change id
(ADR-0153 makes that `changeId`), what a catch-up brings in, and whether
a lane's work touches files (`FilesTouched`, ADR-0153). It has to say
which changes.

ADR-0153 renames what borrowed *offer* (the work strip, the review,
ready, the accepted thread commit). What is left is the concept: the
revision or stack in your repo, or a folder project's files (A); the
span it is built from (B); the host's record of it (C); and the commands
on it (E).

**Decision.**

- **People read *changes*.** The column, the inbox and the menus say
  "changes" where the thread around them says whose: "3 files changed",
  "Accept changes", "you edited these changes", "this thread has no
  changes to accept". A fact's line says "↻ the changes were rebuilt from
  this thread's work", "⇣ the changes were squashed into one revision",
  "✎ a new description of the changes was asked for".

- **Code, docs and the agent read *proposed changes*.** A thread proposes
  them and you accept them, so the pair reads *propose* and *accept*.
  *Changes* is never bare in code: it is proposed changes, incoming work
  (what a catch-up brings, already `behind` and `update`), a change id, or
  files touched.

  | | now | becomes |
  |---|---|---|
  | A, both kinds | `OfferInRepo`, `OfferNow` | `ProposedChanges` (`kind: "jj" \| "folder"`) |
  | A, jj | `OfferRevision`, `readOffer`, `buildOffer`, `repairOffer`, `offerBookmark` | `ProposedRevision`, `readProposedChanges`, `buildProposedChanges`, `repairProposedChanges`, `proposedBookmark` |
  | A, folder | `FolderOfferRecord` | `FolderProposedChangesRecord`, its files `ProposedFiles` |
  | B | `OfferLedger`, `startOfOffer`, `offerStart` | `ProposedSpan`, `proposedStart` |
  | C | `OfferRecord`, `JjOfferRecord`, `OfferStatus`, `offerStatus`, record `pinetrie.offer` | `ProposedChangesRecord`, `JjProposedChangesRecord`, `ProposedChangesStatus`, `proposedChangesStatus`, record `pinetrie.proposed` |
  | E | protocol kind `offer`, outcome `offered`, `OfferAction`, `actOnOffer`, `OfferFact`, `split_offer`, skill `offer-stack` | kind `proposed`, outcome `proposed`, `ProposedChangesAction`, `actOnProposedChanges`, `ProposedChangesFact`, `split_proposed_changes`, skill `proposed-changes-stack` |

  Every other `Offer…` name follows the same rule. The status keeps its
  kinds (`none`, `open`, `held`, `accepted`): the status of a thread's
  proposed changes may be that they were accepted.

- **The bookmark is `pinetrie-proposed/<name>`,** and the glob setup adds
  to your `immutable_heads()` and `revsets.log` is
  `bookmarks(glob:"pinetrie-proposed/*")`. The host's nonce bookmark is
  `pinetrie-proposed-<uuid>`.

- **A starting host renames what is in your repo, once,** as ADR-0100
  renamed `pinetrie-onto` (S217):
  - each `pinetrie-offer/<name>` whose new name is absent, by `jj bookmark
    rename`: one operation each, which keeps a conflicted bookmark's sides
    and adds no version to its evolog, so the offer still reads as the
    host's;
  - then the host's versions (ADR-0154): the mark under each new name,
    one import for all, and one `jj bookmark forget --include-remotes` of
    the old names, after which each new name's version is tracked at its
    bookmark's commit. No remote ref is deleted in git, which would
    abandon what only it held;
  - then the old glob replaced by the new in the two config values setup
    wrote (`immutable_heads()`, `revsets.log`), which records no
    operation.

  A remote bookmark on any other remote is the person's push: it is left,
  and the startup line names it. It is the first command on the repo
  owner, before lane work, a refresh or the owner's first observation
  reads your repo, so one writer still writes your repo (ADR-0065) and
  the renames mark no refresh. Each step is gathered from what the repo
  holds, planned as values and executed, so a start that stopped part way
  finishes on the next; between the steps the offers are briefly mutable,
  and nothing fails. A repo with no old bookmark, ref or glob is left
  alone. Its code is tagged `pre-proposed:` and is deleted once Duane's
  repo has passed it.

- **The agent's words.** `packages/pi/lane.md`, `lane-folder.md`, the
  `commit-message` skill and the stack skill say "proposed changes", in
  full: the agent gains from the precise term and loses nothing by it.
  "You offer it, they accept it" becomes "you propose changes, they accept
  them".

- **Stored and sent names change with the words, with no overlap.**
  `pinetrie.offer` records are the host's cache of the repo, which is the
  ledger (ADR-0104): a starting host deletes the undeclared namespace, and
  the next refresh writes `pinetrie.proposed` from the repo. A fact stores
  its kind, never *offer*, and the column words it from its kind when
  drawn, so an old fact reads in the new words. A fact's content, which
  the model read when it was written, stays as written. An old tool call
  stored as `split_offer` stops matching the tool's words and shows its
  raw name, as any unknown tool's does.

**Consequences.**

- The first start after this renames bookmarks in your repo, one jj
  operation each (`jj op log` shows them, `jj op revert` undoes each), and
  rewrites two values in your repo's config, which is a file: undoing that
  is `jj config set --repo` by hand. jjui with a revset of its own naming
  `pinetrie-offer/*` needs the same edit by hand, and the startup line
  says so, as the publish notes do.
- The rename costs one operation per offer, one import and one forget:
  seven offers are nine operations in `jj op log`, once.
- A pushed `pinetrie-offer/<name>@origin` stays an immutable remote
  bookmark until the person deletes it.
- A mechanical rename across most packages, done after ADR-0153's so
  each name it touches means one thing. It lands as a stack (the words
  people read; the code's names; the wire and records; the bookmark and
  its rename; the agent's words; the docs), each step passing the gates
  alone.
- Old ADRs and findings keep their words.

**Alternatives rejected.**

- **Keep *offer*.** People asked what it means; the word needs explaining
  where *changes* does not.
- **Bare *changes* in code.** It already names jj's change id, a
  catch-up's work and files touched; a reader could not tell which.
- **pending changes.** *Pending* already names a verdict waiting to be
  written (`writePendingVerdict`), and says nothing of who acts.
- **unaccepted changes, thread changes.** The first names the thing by
  what it is not; the second does not say that it waits for you.
- **merge** as the act. Catching up already merges, the other way: the
  word would not say which way work goes, and a "merge conflict" would
  mean two things. *Accept* stays.
- **pull request, patch, draft, proposal.** A pull request suggests a
  remote and a branch, and is opened by hand; a patch is one diff, and a
  folder project's states are not one; *draft* suggests unfinished work
  and already names your message and notes; *proposal* says nothing of
  files.
- **Different words in code and on the page, translated between.**
  ADR-0100 ended that. *Changes* and *proposed changes* are one word with
  a qualifier where the reader cannot see whose.
