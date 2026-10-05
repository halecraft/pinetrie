# ADR-0083 — Every domain term names what it acts on and where that goes: take into the inventory, integrate an offer, pop the next queued card

**Status:** Accepted (Duane, 2026-10-04). Implemented by
`PLAN-2026-10-04-take-vocabulary`. Amends the words of ADR-0038 and
ADR-0060 (a take of an offer is an **integration**), ADR-0048 and ADR-0055
(the host **pops** a queued card; a person **takes** a card **into the
inventory**), ADR-0065 (what an integration was shown), ADR-0067 and
ADR-0079 (an **integrated-offer commit** on the line, which a catch-up
joins), and ADR-0072 (the parent commit a lane last **caught up with**).
None of their decisions change. Their texts stay as written, and keep the
old word.

**Context.** "Take" had come to mean five things in the code and docs,
three of them acts in the domain:

1. a person moving a card into their inventory, or a copy of a message into
   it (ADR-0048);
2. moving the line's or a WIP's bookmark forward to a lane's offer
   (ADR-0038, ADR-0060), and, as a noun, the commit that results ("takes
   stack on an integration line", ADR-0079's "catch up past a take");
3. the host removing a lane's top queued card to send it (ADR-0048,
   ADR-0055, S69's "take-stop race");
4. a lane catching up from its base ("what the lane last took from it"),
   the opposite direction from 2;
5. plain English: an id already in use (`lane_taken`), "takes focus".

`planTake` was defined twice: in `@pinetrie/rules` for 3, and in
`@pinetrie/client` for 1. `Taken` was two types, one for 3 and one for 2. Senses 1
and 3 act on the same card and race each other (S75 item 5, "the host's
take ∥ Ada's take of a queued card"). The page had already said "add" for 2
since ADR-0061, so code and page disagreed. A one-word replacement such as
"add" was tried and rejected as too generic.

**Decision.**

- **A domain term names its object, and where it goes.** No bare "take", "a
  take" or "taken" names an act in code or docs. A term that reads clearly
  out of context is worth more than a short one. The page's labels may stay
  short, since a button sits beside what it acts on: they are worded once
  each, from values (`packages/client/TECHNICAL.md`, "Words come from
  values").
- **Take a card into the inventory**; its reverse, **put a card from the
  inventory**. A message's copy is **taken into the inventory** too. The page
  keeps "take" on the card's button, its title saying where. In code:
  intent `takeIntoInventory`, `planTakeIntoInventory`,
  `planTakeCopyIntoInventory`, `TakeIntoInventoryButton`,
  `takeIntoInventoryWrites`, the card-history verb `took-into-inventory`.
- **Integrate an offer**, into the line or into a WIP. The commit it leaves
  is an **integrated-offer commit**. The page keeps "add to the project" and
  "add to wip/…" (ADR-0061). In code: `OfferAction` `integrate`, buttons
  `integrate` and `integrate-into-line`, state and outcome `integrated`, the
  record's `integratedAs`, `planOfferIntegration`,
  `planOfferIntegrationSteps`, `OfferIntegrationDecision`,
  `IntegratedOfferCommit`, `integratedOfferCommitsRevset`,
  `INTEGRATED_OFFER_COMMIT_ROW`, `IntegratedOfferCommitAbove`.
- **Pop the next queued card**, to send it. The page says "sent". In code:
  `apps/pinetrie/host/queued-card-pop.ts`, `popNextQueuedCard`,
  `PoppedQueuedCard`, `planNextQueuedCardPop`, `sendPoppedQueuedCard`.
- **Catch up with the base.** The parent commit a lane last caught up with
  is `caughtUpWith`.
- **An id in use**: `lane_id_in_use`, `root_id_in_use`.
- Plain English stays ("takes focus", "takes a `CallableRef`").
- **Offer records written before this keep reading.** `pinetrie.offer` stored
  the integration's change id as `taken`. The decoder reads it as
  `integratedAs` when a record has no `integratedAs` of its own, and the
  encoder writes only `integratedAs`. Once every host has rewritten its
  records, the old field goes.

**Consequences.**

- Identifiers are longer. `planOfferIntegration` and
  `parseIntegratedOfferCommits` cost characters that `planTake` and
  `parseTakes` did not, and in exchange no reader has to ask which take a
  name means.
- The wire changed: offer action `take` is `integrate`, outcome `taken` is
  `integrated`, and refusal codes `lane_taken` and `root_taken` are
  `lane_id_in_use` and `root_id_in_use`. Client and host ship together, so
  nothing old is kept for them.
- ADRs, findings and file names written before this keep their old word:
  ADR-0060's title, ADR-0079's slug, S69's and S102's names. Their
  amendment lines point here.
- The few page words that said "take" for an act other than a card's
  move into the inventory now say what happens. A queued card is "sent
  before you unqueued it". The stop button's cards "are then sent". The
  offer's review is "what adding it brings". An integration's refusal is
  "cannot be added there".

**Alternatives rejected.**

- **One short word for each sense** ("add" for 2, "pop" alone for 3). "Add"
  is everywhere in code (`Set.add`, "+ card"), so it would be just as
  overloaded.
- **Accept an offer.** It pairs with "offer", but the host already
  "accepts" moves and commands (`slotOnAccept`), and `accepted` is a move's
  answer.
- **Land an offer.** "Land my work" (your `@` onto the line) and the `land`
  resolution message already use it, and a WIP is not landed on.
- **Dequeue** for 3: too close to the person's **unqueue**, which it races
  (S69).
- **Dispatch** or **claim** for 3: the client's reducers already
  `dispatch`, and `claimFocus` already exists.
- **Rewriting the old ADRs and findings in place.** They are records of
  what was decided and measured, in the words of the time.
- **A unit check that rejects any `take` identifier** not naming the
  inventory or focus. Duane declined it.
