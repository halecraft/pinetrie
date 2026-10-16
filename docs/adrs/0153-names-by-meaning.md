# ADR-0153 — What borrowed the word *offer* is named for what it is: the work strip, the review, ready, the accepted thread commit; jj's change id is a change id

- **Status:** Accepted (Duane, 2026-10-16)
- **Area:** `docs/glossary.md`, `packages/interface/TECHNICAL.md`,
  `packages/rules/TECHNICAL.md`, `packages/jj/TECHNICAL.md`
- **Amends:**
  - ADR-0100: the accepted-offer commit is the accepted thread commit.
  - ADR-0104: the ledger's commits are accepted thread commits.
  - ADR-0047: the review's routes and asks are the review's, not the offer's.
  - ADR-0091: an inbox item ready to accept is `ready` in code too.

**Context.** *Offer* appears about 3,500 times in the code, the docs and
the agent's orientation, and it means eight things:

| | meaning | e.g. |
|---|---|---|
| A | the revision or stack in your repo, or a folder project's files | `OfferInRepo`, `offerBookmark`, `buildOffer` |
| B | the thread's work not yet accepted: the span from its start to its tip | `OfferLedger`, `startOfOffer`, "what you do next is offered on top of it" |
| C | the host's record of A, and its status, which outlives an acceptance | `OfferRecord`, `offerStatus` |
| D | the work strip: the column header's row with its state, buttons and menu, which also catches up, continues and shows a run | `OfferView`, `OfferButton`, `OfferWords`, `OfferActivity` |
| E | the commands on A, and their facts | protocol kind `offer`, `OfferAction`, `OfferFact`, `split_offer` |
| F | the review of A's revisions | `/offer/…`, `OfferAsk`, `OfferAnswer`, `parseOfferPath` |
| G | an inbox item: work ready to accept | attention kind `offer`, `dismissOffer`, `offeredByTask` |
| H | the commit an accepted offer leaves in accepted work | `AcceptedOfferCommit`, `acceptedOfferCommits` |

and, in about 55 comments and test titles, plain English ("a conflict
offers queue or branch").

A to C are the concept. D, F, G and H are other things that borrowed its
name: a reader of `OfferView` expects an offer, and finds a strip that
says "catching up with accepted work…" with no offer at all. G's level is
already `ready` on the page (`inbox-view`), and the docs already call D
the work strip.

Two other words are ambiguous in the same code. jj's change id is
`change` (`OfferRevision.change`, `changesOf`, `offerChange`), and a fact
says "accepted … as the change rmlukxms", beside a strip that will say
*changes* for a thread's work (ADR-0156). And `WorkChanges`
(`none`/`some`/`unknown`) says whether a lane's work touches any file,
not what changed.

**Decision.**

- **Each borrower is named for what it is,** in code, docs, the wire and
  the store. None of these names needs a word for the concept, so this
  lands whatever ADR-0156 decides.

  | | now | becomes |
  |---|---|---|
  | D | `OfferView`, `OfferButton`, `OfferWords`, `offerWords`, `OfferActivity`, the strip's kind `offer`, `.work.offer` | `WorkStripView`, `WorkStripButton`, `WorkStripWords`, `workStripWords`, `WorkStripActivity`, kind `work`, `.work-strip` |
  | F | `/offer/…`, `OFFER_WIRE`, `OfferAsk`, `OfferAnswer`, `parseOfferPath`, the pane subject `offer` | `/review/…`, `REVIEW_WIRE`, `ReviewAsk`, `ReviewAnswer`, `parseReviewPath`, pane subject `review` |
  | G | attention kind `offer`, `dismissOffer`, `dismissedOffers`, `offeredByTask` | kind `ready`, `dismissReady`, `dismissedReady`, `readyByTask` |
  | H | **accepted-offer commit**, `AcceptedOfferCommit`, `acceptedOfferCommits`, `ACCEPTED_OFFER_COMMIT_ROW` | **accepted thread commit**, `AcceptedThreadCommit`, `acceptedThreadCommits`, `ACCEPTED_THREAD_COMMIT_ROW` |

  An accepted thread commit is a commit in accepted work that a thread's
  work became, and carries `Pinetrie-Source`. "Accepted commit" alone was
  rejected: every commit in accepted work is accepted, your own included.

- **jj's change id is a change id**: `changeId`, `changeIds`,
  `changeIdsOf`, never `change`. A person reads it as its short form with
  no noun: "✓ accepted as rmlukxms". *Change* alone names nothing in code.

- **Whether lane work touches files is `FilesTouched`** (`none`, `some`,
  `unknown`), not `WorkChanges`.

- **Plain English stays.** "offers queue or branch" is the verb, and once
  ADR-0156 retires the noun it is no longer ambiguous.

- **What is stored and sent changes with the names, with no overlap.**
  The page and the host ship together, so the routes and protocol kinds
  need none. `dismissedOffers` in the attention document becomes
  `dismissedReady`, which moves the document's schema hash, so a migration
  from the old hash (`apps/pinetrie/host/migrations/`) copies each entry
  across, the same value under the same lane: no dismissal comes back. No
  thread history stores any of these names: facts store their kinds
  (`accepted`, `squashed`, …), never `offer`.

**Consequences.**

- Most of the code's uses of *offer* that are not the concept go, so the
  rename ADR-0156 decides is smaller, and each name it touches means one
  thing.
- One schema migration, for the attention document, deleted once Duane's
  store has passed it.
- A mechanical rename across `rules`, `interface`, `web`, `session`,
  `schema`, `protocol`, `jj` and the host. It lands as a stack by
  borrower (D, F, G, H, change id, `FilesTouched`), each whole across its
  layers, so each passes the gates alone. Mutations' anchors and `expect`
  titles move with the code they name.
- Old ADRs keep their words.

**Alternatives rejected.**

- **Rename everything to the new word at once.** The new word would land
  on D, F, G and H too, and the code would conflate five things under
  *changes* instead of under *offer*.
- **Name D the offer strip.** The strip shows a catch-up, a run and a
  thread's untraced past, and has no offer in most of them.
- **Keep `change` for jj's id, as jj does.** jj's CLI can, since it has
  no other change. Here a thread's work is about to be *changes* to
  people, and two meanings one letter apart is what this ADR removes.
