# S289 — can a canvas's members write its places, in Yjs, with no server deciding?

Numbered S276, then S280, until 2026-10-20, when two files held each number.

- **Status:** Answered
- **Led to:** ADR-0202

Asked with Duane, for the first-principles design of pine·trie's
documents: a canvas would be a collaborative document of its members, and
the server would own only the agent's part (pi's tree, runs, the take of a
queued card, the repo). Placing things then has no arbiter. Duane accepts
that two people may see different views while partitioned, as long as they
converge. Loro has a tree with move semantics, but costs about ten times
Yjs's size, is wasm, and its authors advise against documents over 10 MB,
so the question is whether Yjs is enough. A card's place in the places
document today is already one `.json()` value per card
(`packages/schema/places.ts`), which Kyneta stores as one leaf; only the
host writes it (ADR-0059).

**Question.**

1. Two members move one card at once, connected and while partitioned: do
   both end with it in one place, the same one? Which wins, and can the
   loser tell?
2. A move made after seeing another's: does it win everywhere?
3. A card's place and an independent field (its command), written at
   once by two members: do both survive when they are separate keys, and
   does one undo the other when they share one value?
4. Kyneta's undo of your move: does it put the card back, and leave it
   alone (or refuse, with `whole`) when someone has moved it since?
5. What each move costs the document, in bytes, kept or reclaimed.
6. A member typing in the document while partitioned, then reconnecting
   with the same seat: does the text reach the others intact (S28 part D
   saw corruption on a reconnect, but with a new page and no history)?

**Kill criterion.** Yjs is not enough, and the design needs Loro's tree
or a server, if a card can end in two places or in different places on
two converged peers, or if undo of a move can leave a place torn.

**Throw away.** The probe: a hub and two members as Kyneta `Exchange`s
over WebSocket in one Node process, with no pine·trie code but the schema
it declares itself.

**Answers.**

1. **One card ends in one place, the same on every peer.** In 20 races
   where two members, connected, moved one card in the same tick, every
   race converged on one column at the members and the hub. During a
   partition, each member saw its own move. On rejoining, all 40 cards
   agreed on every peer, and the moves of other cards made on each side
   both stood. **The winner is fixed for a pair of seats**: one member won
   all 20 races in a run, and the same member won the partitioned race.
   Which member it is changed between runs, because a store-less peer is a
   new seat each time and Yjs orders concurrent writes by `clientID`.
   **The loser can tell**: in 20 of 20, the losing member read the other
   column where it had written its own.
2. **A move made after seeing another's wins everywhere**, whichever
   member makes it. The fixed winner applies only to moves that neither
   member had seen.
3. **A value is never torn, and a shared value loses an independent
   write.** With the place and the command under separate keys, a move
   and a command written at once both stood, 20 of 20. In one `.json()`
   value, one writer's whole value won every time: never both writes (0
   of 20), and never a mix of fields (0 of 20 torn).
4. **Undo puts a card back, and leaves alone a card someone moved
   since.** Kyneta's undo of a member's own move put the card back in its
   column and order, on every peer. When the other member had moved the
   card since, the undo did nothing (`none`, the step dropped) and the
   card stayed where the other member put it. With `whole`, it was
   `refused`.
5. **A move costs 12 bytes, kept for good.** 1,000 moves of 40 cards
   grew the hub's copy by 12,047 bytes, about 12 a move. The whole
   document was then 16,249 bytes. 1,000 newly placed cards added 32,780
   bytes, about 33 each. Yjs keeps a little of each overwritten value.
   A canvas with a few hundred cards moved a few thousand times stays
   well under a megabyte.
6. **Reconnecting under the same seat lost nothing.** A member typed in
   the document's text while partitioned, the other typed at the start,
   and on rejoining all three copies read the same text
   (`Our Canvas by Ada`), with the member's seat unchanged. S28's
   corruption came from a new page reusing a seat with no history. A
   page that keeps its document in memory and reconnects does not.

**Consequences.**

- The kill criterion is not met. **Yjs is enough for placement.** A
  card's place as one value under its own key, in a canvas's document
  that its members write, converges with no server deciding, and Loro's
  tree is not needed for canvas, column, card.
- **Fields that change separately go under separate keys.** The places
  record today bundles a card's place with its command, its text
  version and more. Written by members, a command would then undo a
  concurrent move.
- **The winner of a concurrent move is the seat whose `clientID` orders
  last**, the same one each time within a pair of sessions. That is
  arbitrary but consistent. A seat that lasts (a browser store) would
  make it the same between sessions too.
- **Undo needs no server**: each tab's own stack does what the host's
  stacks of people's moves do (ADR-0066), refusals included.
- Not measured: more than two members, a hub restart from its store,
  and a browser.

**Method.** `probe.ts` in this spike's folder, run with `node` in a Linux
lane: a hub `Exchange` with an in-memory store, `authority: "self"`, and
a `WebsocketServerTransport` behind a `ws` server, and two members with
`WebsocketClientTransport`. It used no pine·trie code. A partition was the
member's transport removed (`removeTransport`) and a new one added. The
hub kept the default `departureTimeout`, so the member returned as the
same peer. Sizes are `Y.encodeStateAsUpdate` of the hub's copy. Run
twice, alike but for which member won; a third run matched the second.
`output.txt` holds the output.
