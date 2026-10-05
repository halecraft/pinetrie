# S75 — where an inventory card's place lives, and undoing moves

Measured in a lane (Linux, Node 24), for ADR-0048's step 4, the inventory.
It answers the ADR's probe 1 (places as a CRDT) and the rest of probe 4
(undo in pine·trie's shape, for moves). The probe is kept under
`.plans/s75-probe/` with its output, and was not committed.

**Superseded in part by S76.** Answers 2, 3, 10 and 11 showed that a
card's place does not merge, so its consequences 1–4, 6 and 7 do not
stand: a place in a session is written only by the host, through
handoffs, and your inventory is a document of your own (S76).

**Answers.**

1. **An inventory card's place belongs on its record in the session's cards
   document**, as fields: `kind` `inventory`, a holder (the person) and a
   slot. A document per person, with the record moved into it, puts one card
   in two inventories. When Ada and Bea took one card at once, it ended up in
   both inventories in 40 of 40 tries. With fields on the record there was
   one holder everywhere, in 100 of 100.
2. **A move writes every field of the place, not only those that change.**
   A Yjs map settles each key on its own: concurrent writes to one key go to
   one writer, by `clientID`, and a key only one side wrote is not in
   conflict, so it applies. When Ada's take wrote `kind`, holder and slot
   while Bea's queue wrote `kind`, `order` and `by`, only `kind` was
   contested. Every record was mixed (100 of 100): 99 were Ada's inventory
   card carrying Bea's `order` and `by`, and the one where Bea's queue came
   second was a queued card still carrying Ada's holder and slot, since
   writing only what changes leaves the last place's fields behind even
   without a race. When each move wrote every place field (all but
   `owner`), every key was contested, the same writer won each (Yjs orders
   two clients the same way for every key, and a move arrives as one
   transaction), and no record was mixed (0 of 200).
3. **Who wins a concurrent take is arbitrary but the same everywhere.** Ada
   won 100 of 100 against Bea: her `clientID` orders after Bea's, which says
   nothing about who meant it more. The loser's take is simply gone, so the
   loser's client has to notice, as an unqueuer does (S69).
4. **Two of your tabs can fill one slot.** Two takes into the same empty slot
   from two tabs kept both cards, both claiming the slot, in 40 of 40 tries.
   Nothing is lost, but a read has to settle which card a slot shows.
5. **The host's take still wins, and a take seen first is respected.** A
   queued card that Ada took into her inventory while the host took it was
   sent in 88 of 100 races. In the 12 where her take reached the host first,
   the card was not queued at the take, so it was not sent. No card was sent
   from an inventory. Every lost take of Ada's ended with her client seeing
   the host let go of the card's document (76 of 76), as a lost unqueue does.
6. **A move does not touch the text.** Bea typed ten keystrokes while Ada
   took the card, and in 20 of 20 tries every replica ended with all of
   them, in Ada's inventory.
7. **One stack filtered to the cards document reaches creations.** Card
   creation writes the cards document, so `undo({ docs: ["cards"] })` on the
   text stack undid the newest card's creation (its record gone, its text
   emptied) instead of the move before it.
8. **A second stack for moves, in the same undo document, keeps them
   apart.** A stack records only commits made inside its own gestures. The
   moves stack (`key: "moves"`) did not record a card's creation, and the
   text stack did not record a move. Undo and redo on the moves stack put a
   taken card back below the line and returned it to its slot.
9. **A move's step says which card it moved.** Its footprint lists record
   keys: `["cards", <card id>, <field>]`. A swap of two slots is one step,
   one part, naming both cards, and undoes as one.
10. **Undoing a move after someone else moved the card leaves their move.**
    Ada took a card, Bea queued it from there, Ada undid her take: the card
    stayed queued by Bea, whole. A field is restored only while it holds
    what the step wrote, so when Bea wrote only `order` after Ada queued, Ada's
    undo unqueued the card and left Bea's `order` on a drafting card. A read
    has to take only the fields of the card's `kind`.
11. **`undo()` can report `true` and change nothing.** That happened twice:
    undoing a take after Bea moved the card, and undoing a queue after the
    host sent the card (its record gone, its text destroyed). The cards
    document is held, so the step stands as far as Kyneta knows. A person
    pressing Cmd+Z would see nothing happen.
12. **Undoing a card's creation after it moved empties it but keeps its
    record.** The text stack's undo of a card's creation, from its box,
    emptied the text, but the record had changed since (the take), so it
    stayed, in the inventory, empty. The host's sweep of empty cards
    (`planCardSweep`) would then remove it at the next start.
13. **Each tab's moves stack is its own.** Ada's second tab, undoing, undid
    its own earlier move; the move made in her first tab stood.

## Why it was asked

ADR-0048 stores the inventory as "one per person" and leaves open whether a
card's place is a movable tree or a field per card (probe 1). S69 settled a
queue's order as a field per card. Step 4 adds a move across places that
belong to different people, and ADR-0052 gives moves a history of their own
per tab, which S69 left unmeasured ("moves undone from a move history
filtered to the cards document while other live cards have steps there").

## Method

One disposable probe in `apps/pinetrie/e2e/`, run with `node`, built as S69's
was: a host whose exchange is built as `startHost` builds it (the SQLite
store, `WebsocketServerTransport` behind `ws`, `departureTimeout: 0`, a
`resolve` for the cards document, `card:` texts and `inventory:` documents,
and a policy rejecting `undo:`), and three clients over websockets: Ada in
two tabs and Bea. Each client had two undo stacks in one undo document: the
text stack, scoped as `connectSession` scopes it today, and a moves stack
over the cards document and `inventory:` documents. A card's record was a
probe schema of eight flat strings (`owner`, `kind`, `at`, `lane`,
`holder`, `slot`, `order`, `by`). Cards were created as `createCard` creates
them, in one gesture with their text; a move was a `batch` of field writes
in one gesture of the moves stack.

Each race ran two writes, either in the same tick (one try in four, so that
neither side had heard the other) or each after a random 0–3 ms, then
waited until every replica agreed.

| check | result |
|---|---|
| both take one card, whole place, 100 | one holder everywhere (Ada 100), coherent 100 |
| both take one card, changed fields only, 100 | one holder everywhere; slot always the holder's |
| take ∥ queue, whole place, 100 | inventory 98, queued 2, mixed 0, diverged 0 |
| take ∥ queue, changed fields only, 100 | mixed 100: 99 inventory with Bea's `order` and `by`, 1 queued with Ada's holder and slot |
| two tabs take two cards into one empty slot, 40 | both kept 40, same slot 40 |
| host's take ∥ Ada's take of a queued card, 100 | sent 88, Ada's take first 12, sent from an inventory 0 |
| lost takes where Ada saw the host let go | 76 / 76 |
| Bea types ∥ Ada takes, 20 | all keystrokes everywhere 20, in Ada's inventory 20 |
| a document per person, both take one card, 40 | in both inventories 40 |
| one stack, `undo({ docs: ["cards"] })` | undid the newest creation, not the move |
| two stacks: text stack records a move | no |
| two stacks: moves stack records a creation | no |
| moves stack: undo, redo a take | back below the line; back in its slot |
| a move step's footprint | `["cards", id, field]` per field written |
| swap two slots in one gesture | one step, one part, both cards; undone together |
| undo a take after Bea queued the card | `true`; queued by Bea, unchanged |
| undo a queue after Bea wrote `order` | `true`; drafting, Bea's `order` left on it |
| text undo of a creation after a take | text emptied, record kept in the inventory |
| undo a queue after the host sent the card | `true`; nothing comes back |
| second tab's moves undo | its own step; the first tab's move stands |

## Consequences

1. **The inventory is a place on the card's record**, in the session's cards
   document: `kind: "inventory"`, holder, slot. ADR-0048's "one per person
   for the inventory" becomes no document of its own. A page per session
   (ADR-0048) is then this session's cards with you as holder.
2. **Every move writes the whole place**: `kind` and every field any place
   uses, empty where this place has none. Queue and unqueue already write
   whole records' fields (`queueFields`, `unqueueFields`), and step 4 keeps
   to that for take, put and swap.
3. **`decodeCard` reads only the fields of the card's `kind`**, since an undo
   can leave another place's field behind (answer 10).
4. **A slot two cards claim is settled when it is read**: one rule, the same
   on every replica (the lower card id keeps the slot, and the other is
   shown in the first empty slot), and the holder's client writes the
   settled slot back. Every tab computes the same write, so two of them
   writing it agree.
5. **A lost take is told to the loser**, as a lost unqueue is: the client
   remembers the cards it took until it sees whose inventory each reached,
   or that the host let it go.
6. **Moves get a second Kyneta stack**, `key: "moves"`, in the tab's undo
   document, over the cards document. Card boxes keep the text stack
   (ADR-0052). A move's step names its cards in its footprint, which is what
   "undoing a move first shows where it acts" needs.
7. **Before undoing a move, the client checks that something would change**:
   the cards its step names still exist and some field still holds what the
   step wrote. Otherwise Cmd+Z would do nothing visible (answer 11). Whether
   Kyneta could report "nothing changed" itself is a question for Kyneta.
8. **An emptied inventory card is not swept** while it is a step's to bring
   back, or the host's sweep must skip inventory cards. Step 4's plan
   decides which.

## What was not measured

- A browser, and drag: this was the documents and the stacks only.
- Ctrl+Shift+I and Ctrl+Shift+O off a Mac, where browsers use them.
- A take from the past (a message, or a selection in one), which creates a
  card rather than moving one.
- Cards whose `owner` is not their holder: who a card in Bea's inventory
  belongs to, for marks.
- A stored undo document; both stacks lived in memory, as each tab's does.
- A movable tree (Loro): with a field per card enough for every case above,
  it was not built.
