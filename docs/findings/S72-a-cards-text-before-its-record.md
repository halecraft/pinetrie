# S72 — a card's text can reach the host after its record

Measured in a lane (Linux, Node 24) for `PLAN-2026-10-01-queued-cards`,
after `e2e:lanes` failed on the Mac: the conflicted bring-up-to-date check
found the resolution prompt without the card's text. The question: when a
client writes a card's text and then a field of its record, does the host
see the text when it sees the field? The probe started a host as `startHost`
does and joined one client. On the host, a subscription to the cards
document recorded each card's text at the moment its marker field arrived.
The probe is kept under `.plans/s72-probe/`, and was not committed.

**Answers.**

1. **No: Kyneta keeps no order between documents.** 100 cards created and
   marked at once: the host saw the marker before any of the text in 100 of
   100.
2. **Not even for a text the host already has.** 100 cards whose text
   documents were `synced` with the host (`sync(doc).peerStates`), then
   edited and marked at once: the host saw the marker before the edit in 99
   of 100.
3. **A text's version says what the host holds.** `version(ref)` (from
   `@kyneta/schema`) serializes a Yjs state vector; `YjsVersion.parse` (from
   `@kyneta/yjs-schema`) reads it back, and `compare` says whether a copy is
   behind, equal, ahead or concurrent. A copy that has every write in the
   version compares `equal` or `ahead`, whoever else has written since.

**Consequences.**

- **A queued card's record carries its text's version as its queuer had it**
  (`seen`, `textVersion` in `packages/schema/text.ts`), written with the
  queue fields. The host takes a card only once its copy holds that version
  (`textHolds`); until then the card is `behind` (`takeTop`), stays on top,
  and the host drains the lane again when the text arrives
  (`CardPort.whenHolds`). The cards behind it keep their order.
- **An edit by someone else after the queue does not hold the take up**: the
  host's copy is then `ahead`. One by the queuer that has not arrived does:
  the host's copy is `behind` or `concurrent`.
- **A card queued by a client that left before its text arrived waits** until
  someone unqueues it; queueing it again writes that person's version.
- **No acknowledgement API is needed.** Kyneta exposes no per-write ack
  (`sync` reports `pending`, `synced` or `vacant` per peer, a coarse state),
  and the version comparison answers the question on the host alone.
