# `@pinetrie/session`: technical notes

One client's connection to a host: the documents it syncs and the requests
it sends, deciding nothing about what is shown. `connectSession`
(`connect.ts`) opens a Kyneta `Exchange` over a WebSocket, finds the host's
seat, and returns a `SessionClient`. The page (`@pinetrie/web`'s
`main.tsx`) and the e2e suites (`join` in `apps/pinetrie/e2e/harness.ts`) use
the same code.

**It runs unchanged in a browser and in Node, and declares no React**
(`workspace.test.ts` pins its dependencies), so it cannot draw. The only
value specific to one of the two is the `WebSocket` constructor, which the
caller passes.

Where a rule lives, as `packages/rules/TECHNICAL.md` and
`packages/repo/TECHNICAL.md` state it too:

> Core holds the vocabulary (ids, intents, every record's type) and the
> reads of the tree. A format or type that `lanes` or `repo` must read,
> write or name lives in core too, since neither can declare
> `@pinetrie/rules`. What a stored shape says, and how the host changes it,
> is `@pinetrie/rules`', whoever reads it. One client's own in-flight state
> (its moves, held roots, slot repair, commands out) is
> `@pinetrie/session`'s. What a person sees and can do, and its words, is
> `@pinetrie/interface`'s, for any client; how the page draws it is
> `@pinetrie/web`'s (ADR-0093).

So `answerOf`, `withPending`, `settleSlots` and `nextActing` are here, while
the host's command rules (`planChat`, `planMove`, `planStop`) are
`@pinetrie/rules`'. This package's `answerOf` (a move's answer) shares its
name with `@pinetrie/rules`' banner rule; `index.ts` does not export it.

`index.ts` lists every name another package imports; a name only this
package and its tests use is not exported there.

## "Session" means two things

`@pinetrie/session` is this client's connection. `SessionClient.session` is
the session document (ADR-0063), the records every root shares. The names
are the code's own (`connectSession`, `SessionClient`).

## The parts (`connect.ts`)

`connectSession` connects, builds its parts, and subscribes them to each
other. Each part is a small shell; its decisions are pure functions beside
it.

| part | owns | decides with |
|---|---|---|
| `rootDocs` (`root-docs.ts`) | the roots held, the `pinetrie.roots` policy | `planHold` (`root-hold.ts`) |
| `cardTexts` (`card-texts.ts`) | each card's text, and the copies to destroy | `hostLetGo`, `spentCards` (`card-copies.ts`) |
| one `snapshotStore<LocalState>` | the host's records, this tab's moves, the cards drawn | `localStep` (`card-moves.ts`) |
| `inventorySlots` (`inventory-slots.ts`) | your inventory's slots, the repair's alarm | `repairStep`, `takeIntoInventoryWrites`, `swapWrites` (`inventory.ts`) |
| `attentionStore` (`attention-doc.ts`) | what you have dealt with, the read marks' alarm | `readStep` (`read-marks.ts`) |
| `openList` (`open-list.ts`) | your list: the roots you have open, in your order (ADR-0085) | `placeInList`, `planOpenRepair` (`open-repair.ts`) |
| `presenceSeat` (`presence-seat.ts`) | this seat's reading and typing | none |
| `hostLine` (`host-line.ts`) | the requests waiting for their replies | `encodeIntent`, `decodeReply` |
| one `snapshotStore<ActingState>` | your offer and line commands out | `nextActing` (`acting.ts`) |
| `chat` | what a chat asks the host, and what it draws | `planChatRequest` (`chat.ts`) |

- **Order matters to Kyneta.** `writersPolicy` is registered before the
  transport is ready, and `rootDocs` registers its `canShare` policy before
  any root's `get` (S86). The inventory repairs, and your attention is
  written, only once the host's copy has reached this one (`personDoc`'s
  `ready`, S101).
- **The host is found by principal** (`HOST_PRINCIPAL`, `whenPeer`), since
  its seat is Kyneta's to issue: a Line is addressed by seat.
- **A closed line answers at once** (`HostLine.close`). When the host
  leaves, or the client closes, every request waiting is answered
  `failed`, and every later one at once, with nothing sent: a client does
  not reconnect, so it would otherwise wait for good. Failed, not refused:
  the host may have acted on one waiting. The host leaving also drops the
  moves the host accepted (`hostLeft`), since no copy of the places will
  reach their `rev`.
- **`close()` rejects only when the exchange's shutdown does**, as the
  host's `shutdown()` rejects only at its last step: every other part's
  disposal is in its own `try`, so one that throws stops no other. The last
  part clears this seat's typing.
- **`exchange` is the one way past the session.** `ExchangeProvider`
  renders from it, and a host-suite check reads `exchange.has`; nothing
  else should reach past the session's own methods.
- **`mark` and `retitle` find their root** (`inRootOf`): both name an entry,
  and the session sends it in the held root that has it (`rootOf`), else
  refuses with `NO_ROOT` before sending.
- **`versionOf` is the one read of a card's text version** this client
  makes: a move into a queue is stamped with it (`stampSeen`), and a chat's
  card and pinned cards are gathered by it before `planChatRequest` (S96).
  It opens a card's document it does not hold yet, so it is a gather,
  never called from a plan.

## The roots held (`root-docs.ts`, `root-hold.ts`, ADR-0063)

- **`SessionClient.holdRoots` opens what is new and `destroy`s what is
  not**, which leaves the host's copy (S86). Which roots the page asks for
  is the interface's (`planHeldRoots`, `@pinetrie/interface`). A root this client
  starts is held from its first send until the page asks for it, and after
  that only while the page does. `planHold` (pure) decides what opens and
  goes; `rootDocs` carries it out.
- **It declines every other root.** Kyneta takes in every announced document
  whose schema a client knows, and every root's is the session's, so a
  `canShare` policy refuses a `root:` document the client does not want.
  Kyneta asks it as `get` opens a document, and not again, so `rootDocs`
  records a root as `wanted` before it calls `get` (S86): a root allowed
  only after would be opened and never asked for.

## A chat (`chat.ts`)

`chat` gathers (the root, minted and held for a send at the root; the card
as drawn; each card's text version), plans (`planChatRequest`), then sends:
tracked as a move of its card when it has one, else a plain request. The
plan never refuses: the root a send at the root mints is held before it,
so a refusal added to the plan must move the minting after it.

## This tab's moves (`card-moves.ts`, ADR-0048, ADR-0059)

The page reads the cards' records as `session.cards`, a snapshot store; it
never holds the places document itself. `connectSession` registers
`writersPolicy` (`@pinetrie/protocol/writers`), so a write to the places, the
session or someone else's inventory throws before it is made.

- **Every move is a request to the host**: creating a card (its text in one
  undo step, then a `move` from nowhere, then its command), queueing,
  unqueueing, discarding, and setting a command. The host applies each in
  arrival order or refuses it. A move into a queue gets its text's version
  as this client has it as it is sent (`stampSeen`, S96); nothing else
  changes the move the page planned.
- **The tab's moves are one pure reducer** (`movesStep`): sent, answered,
  the copy changed, the host left. `localStep` holds it with the host's
  records and the cards drawn from the two, in one store, so a change to
  the places moves the `rev` and the drawn cards together and tells each
  listener once. `withPending` draws each move the copy does not yet hold
  over the host's records, so a move shows at once. An accepted move stays
  drawn until the copy's `rev` reaches the one its reply carried: the reply
  and the change to the places reach the tab separately, in either order,
  and a move can be overtaken (popped, moved back) before the copy catches
  up. Dropped at the reply, the card would jump back and a new card would
  leave its editor; dropped when the card looks moved, an overtaken move
  would be drawn for good. With nothing drawn, `withPending` returns the
  host's records array itself.
- **A send is a move of its card**: out of the composer until the copy holds
  what the host did with it, spent or queued. Without it, the composer's
  `yourCard` finds the card still drafting at the thread's end between the
  reply and the change, and takes it back.
- **A reorder is tracked as a move is** (`reorderCard`, ADR-0048 step 7):
  a pending `reorder` is drawn by running core's rules' `planReorder` over
  what is drawn, so the card sits where the host will put it, its queuer and
  placer kept, until the copy reaches the reply's `rev`. A refused one draws
  nothing, and its refusal is kept where you acted. It is not a
  `HostRequest`, so the page cannot send one untracked.
- **Several cards move as one** (`moveCards`, a keep): never none. A keep
  with no card left is the page's to settle (`planKeep` closes the column),
  so the session's moves always name a card.
- **Refusals are values** (`CardRefusal`, kept by `movesStep` until your
  next move where you acted); the page words them (`refusalWords`). Each
  move carries where you were looking when you made it (`ActedAt`: a
  column's key, or the inventory), and its refusal is drawn there.
- **An undo of moves waits for the copy** (`whenRev`): the session sends
  `undo-move` and resolves once its copy of the places reaches the reply's
  `rev`.
- **The store** is `snapshotStore` (`store.ts`): a new value tells its
  listeners, the same value does not, as `useSyncExternalStore` needs.

## Cards' texts (`card-texts.ts`, `card-copies.ts`, S64)

- **A box undoes only its own card** (ADR-0052): `SessionClient.undoFor`
  passes Kyneta the card's text document (`undo({ docs })`), so it takes
  that card's newest step even under newer steps in other cards. The stack
  is in memory, over every `card:` document, and `SessionClient` exposes
  only `undoFor`: the stack's own `undo()` takes its top step, which can be
  anywhere. `CardUndo` is the shape `@kyneta/react`'s `attach` takes, typed
  from `@kyneta/exchange`'s `UndoStack`.
- **A card the host spent is destroyed on every client holding it**, so no
  step on it stands, and no undo or redo in its box can write into it. The
  host's `dismiss` leaves a receiver's copy, so `cardTexts` watches each
  card document `cardText` opens, the client's one opener of them:
  `hostLetGo` says the host left it while connected, and `spentCards`
  destroys the copy once the record is gone too. The two arrive in either
  order, and a copy whose record is live is never destroyed: a render could
  still read its text and make a new, empty copy.

## Your inventory's slots (`inventory.ts`, `inventory-slots.ts`, ADR-0059)

- **Two layers.** The host's records say which cards are in your inventory
  (`CardPlace` `inventory`, `heldBy`); your inventory document
  (`inventory:<you>`, `InventoryDoc`) says which slot holds each. The
  session opens it and repairs it on every change (`repairStep`:
  `steadiness`, then `planSlots`).
- **`settleSlots` is the one slot rule**: the page's panel draws it
  (`inventoryView`, `@pinetrie/interface`), the repair writes towards it, and a
  take into the inventory lands by the same `firstEmpty`: the selected slot if empty, else the
  first empty.
- **The repair waits for a card to be steady** (`steadiness`, S79): it
  places a card, or clears its slot, only once the card has been held, or
  not, for `STEADY_MS`, and looks again then. It reads the host's records,
  not the drawn ones, so a put in flight keeps its slot until accepted.
  It writes nothing when nothing differs.
- **The slot a take into the inventory chose is written at the answer** (`slotOnAccept`, then
  `takeIntoInventoryWrites`), before the answer is recorded: if the places reached the
  tab first, the answer drops the pending move at once, and a repair in
  between would place the card in the first empty slot. Until then the
  pending move's `slot` is an intent: drawn there, and left alone by the
  repair.
- **A swap is undone by this tab's own stack** (`swaps`, key `slots` on the
  tab's undo document, scope your inventory). `swapSlots` writes inside its
  gesture; the repair writes outside any, so an undo of a swap whose slot
  the repair changed is refused, `slots-changed` (S90). The text stack, on
  the same document under `cards`, never takes a swap step.

## A person's documents (`person-doc.ts`, ADR-0059, ADR-0077, ADR-0085)

Your inventory, your attention and your list are each a document of yours
(`personDocId`), written only by your tabs and relayed by the host to you
alone. `personDoc` is the one shell over either: the document read as a
`Readable`, `onChange` for its changes and its sync with the host, and
`ready()`, whether the host's copy has reached this one. A value written
before then can win over a later one from another of your devices when
the two merge (S101), so a writer asks `ready()` first.

## What you have dealt with (`attention-doc.ts`, `read-marks.ts`, ADR-0077)

- **`attentionStore`** reads your `AttentionDoc` (`readAttention`) and
  writes it: read marks, "not needed" (`dismiss`, `dismissOffer`) and the
  inbox's seen mentions (`setInbox`, as the page's `inbox.ts` decides
  them). Nothing is written before `ready()`; a click before then is
  dropped.
- **Its first write sets where you start**: `since` and `mentionsSince`
  from `startOf`, the directory's newest entry, or `EARLIEST` in an empty
  session, and only once the session document has arrived (S29). Until
  then `since` is "", which the page raises nothing against.
- **Read marks are timed by `readStep`**, pure, as the repair is by
  `repairStep`: a lane's mark only moves forward, is written at most once
  a `READ_EVERY`, every waiting mark at once on `leave()`, and none before
  `ready()`, losing nothing reported meanwhile. Each write stays in the
  document's history, about 10 bytes (S101).

## Your list (`open-list.ts`, `open-repair.ts`, ADR-0085)

- **Your list is `OpenList`**: your `OpenDoc` read in order (`roots`, the
  same array until the document changes, since the page reads it in
  render), `open` (before a root, or at the end; one in it moves),
  `ensure` (at the end, unless it is there), `close`, and `here`, the root
  the page shows. Every write waits for `ready()` (S101).
- **The repair deletes archived roots but the one you are on**
  (`planOpenRepair`), on every change to your document, to the session's
  records, and to `here`: a restore then brings a root back only for whoever
  restores it (ADR-0030). It writes nothing when nothing differs.
- **A root you start is in your list**: `chat` ensures it once its answer
  says the send at the root was written (`startsRoot`: `appended` or
  `started`). A refused or failed send writes nothing.
- **`placeInList` renumbers** when `orderBetween` finds no room between a
  root's neighbours, as the board does.

## Your offer and line commands (`acting.ts`)

`SessionClient.offer` and `.line` go through `sendActing`, which marks the
command `sent` in the `acting` store at once and records the answer when it
comes; `nextActing` decides. A refusal or failure stays until your next
command on that lane (or the line); an answer that carried it out clears
it, since the record then says how things stand. An acceptance names the offer
this tab's record shows as it sends (`offerSeen`, ADR-0065). A split is
no offer command: it is a card's command, queued (ADR-0080).
A refusal keeps its code (`Unsuccessful.code`), so a view can act on why:
the page's publish toast offers "resolve with the agent" only for
`yours_conflict` (ADR-0090). A line command's refusal or failure is shown by
that toast, not a menu.

## Presence (`presence-seat.ts`, ADR-0024)

Presence is per seat (`seatKey(writer, exchange.peerId)`), so your tabs
never overwrite or clear each other's. Write it only through `setReading`,
`clearReading` and `setTyping`. `setTyping(end, card)` writes the thread
end (`typing`, the composer's "typing…") and the card typed in (`typingIn`,
which the host reads to pop no card someone types in, ADR-0048 step 7) in
one batch; `dispose` clears both.

## Tests

- Unit tests sit beside each module; `fixtures.ts` is their test support.
  `host-line.test.ts`'s `wire()` is a Line's two ends in memory.
- The host suite and the browser suite are what prove the session connects,
  holds, moves and undoes against a real host.
- Mutations are in `scripts/mutations/session.ts`; the suite mutations on
  this package's files are in `scripts/mutations/app.ts`.
