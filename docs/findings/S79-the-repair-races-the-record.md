# S79 — a second tab's repair cleared a slot just taken into

Found while building ADR-0048's step 4 (`PLAN-2026-10-03-inventory`), in
the `host/cards` scenario and a probe beside it: two sessions of Ada's and
one of Bea's, over a real host (Node 24, in a lane). S76's repair rule ran
as ADR-0059 states it: on every change to `places` or the inventory, a tab
places a card the host says is yours that no slot holds, clears a slot
naming a card that is not yours, and keeps the lower of two slots.

**Answers.**

1. **A second tab cleared the slot a take had just written.** Ada's first
   session took a card into slot 3 and wrote the slot once the host
   accepted. Her second session saw the slot before its copy of `places`
   held the card, read it as naming a card not hers, and cleared it, 5 s of
   waiting later still empty. Once the record arrived, the card would have
   gone in the first empty slot: it kept a place in the inventory, but not
   its slot.
2. **The reverse order loses the slot too.** A second session that holds
   the record first places the card in the first empty slot before the
   take's own write reaches it; the two then merge into one card in two
   slots, and the lower wins, which is not always the one chosen.
3. **Nothing orders the two.** The host's record and another tab's slot
   write travel on two documents, which Kyneta keeps no order between
   (S72), so either can arrive first.
4. **Waiting fixes it.** With the repair acting on a card only once it has
   been held, or not, for 2 s (`steadiness`, `STEADY_MS`), the second
   session showed the card in slot 3 within a fraction of a second, and the
   `host/cards` and `browser/page` checks passed every run. A card in two
   slots, and a slot that is no slot, are still settled at once: no other
   tab's write makes them right.

**What it changes.** ADR-0059's repair rule gains its wait: a tab places a
card, or clears its slot, only once the card is steady. A crash between the
host's acceptance and the slot's write still loses nothing: the card is
placed 2 s later. A slot naming a card that is gone stays until it is
written over; it draws as empty.
