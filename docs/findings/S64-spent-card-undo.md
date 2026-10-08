# S64 — does Kyneta's new undo skip a spent card, and how does a client know one was spent?

- **Status:** Answered
- **Led to:** ADR-0048, ADR-0052, ADR-0059

**Answers.**
1. **Redo of a step of several commits to one text is fixed** in the Kyneta
   build pine·trie links (`needed-by-pinetrie`, "a step of several commits to one
   text undoes and redoes in order"). Typing `more` after `Go` a key at a
   time, then undo and redo, gives `Gomore` (S58's addendum measured
   `Goerom`). A word backspaced a key at a time and undone comes back as it
   was.
2. **Kyneta now skips a step whose document is not held, but a client still
   holds a spent card's document.** An undo opens a step's documents with
   `exchange.open` ("an undo never creates a document"), and a part whose
   document is not held does not stand. When the host destroys a card's
   document, the client is only told the host left it (`dismiss`); the
   client's replica stays. So after a spend, the owner's Cmd+Z still returns
   `true` and changes only that dead replica, as S58 found.
3. **When the client destroys its own replica, the spent card's steps are
   skipped, and the undo goes on to the step below.** With two cards created
   in turn and the second spent, one Cmd+Z skipped the second's steps and
   undid the first card's creation: its record and its text were removed.
   That card can be anywhere, in another root's column.
4. **The client can tell a spend from an undo by the host leaving the card's
   document.** All three of these delete a card's record:
   - your own undo past the card's creation;
   - another person's undo past the creation of a card of theirs;
   - the host spending it.

   The deleted record looks the same in each case. Another person's undo
   reaches the client as a `replay` changeset, just as the host's spend does,
   so `replay` cannot tell the two apart. **What differs is the card's
   document:** only after a spend does the host leave it. The host's entry
   disappears from `sync(cardText).peerStates`. After either undo, the host
   is still there.
5. **A host departing looks like the host leaving every document**, but it
   also leaves `exchange.peers`. When the document's peer states changed on
   the host's shutdown, the host was already gone from `exchange.peers`. A
   dropped connection changes neither: in Kyneta's source, a peer whose
   channels are all gone keeps its per-document states through the grace
   period (`handlePeerUnavailable`, `packages/exchange/src/sync-program.ts`:
   "preserve docSyncStates for reconnection"), and only departure deletes
   the peer, from the session first (`sync/peer-departed`). So "the host left
   this document while still connected" means the host destroyed it.
6. **The two arrive in either order.** The host deletes the record, then
   destroys the document (`CardPort.spend`, `apps/pinetrie/host/cards.ts`). Over
   the real host, though, a client heard the host leave the card's document
   while the record was still there: the `dismiss` is sent at once, and the
   record's delete with the next sync of the cards document. (Measured by
   logging the client's peer-state callback in the e2e suite's cards section.
   S58's answer 7 was about writes, not a `dismiss`.) So a client marks a card
   whose document the host let go of, and destroys its copy only once the
   record is gone as well. Destroying earlier would let a render that still
   sees the record read its text, which makes a new, empty copy.

## Method

Disposable probes in `apps/pinetrie/e2e/`, not checked in, run with `node`.
They used three `Exchange`s over Kyneta's in-process transport
(`@kyneta/bridge-transport`, imported from the Kyneta build by path): a host
with the `resolve` `startHost` uses (`cards` → `CardsDoc`, `card:` →
`TextDoc`), and two clients, Ada and Bea. Each client had a
`createUndoStack` scoped like `connectSession`'s, and created cards as
`createCard` does: one gesture writing the record and the first text.
Records were watched with `subscribe` on the cards document, each card
document's peers with `sync(doc).peerStates` and `onPeerSyncChange`, and the
connection with `exchange.peers`.

| check | result |
|---|---|
| typing `m`,`o`,`r`,`e` after `Go`; undo; redo | `Go`, then `Gomore` |
| backspacing four keys; undo | `Gomore` |
| host spends the card; Ada holds its document still | yes |
| then Ada's Cmd+Z | `true`; changes only Ada's dead replica |
| host spends; Ada destroys her replica; Cmd+Z | `true`; skips the spent card, undoes the earlier card's creation |
| Ada's undo past creation: the record's delete | local (`replay` false) |
| Bea's undo past her card's creation, seen by Ada | `replay` true, `origin` `sync` |
| host's spend, seen by Ada | `replay` true, `origin` `sync` |
| Ada's card document's peers after Bea's undo | the host still there |
| the same after the host's spend | the host gone |
| host shuts down: Ada's document's peers, and `exchange.peers`, as the document's peers change | both without the host |

## What was not measured

- pine·trie's real topology, except the order of answer 6: a hub, with every
  client connected only to the host over websockets. The in-process
  transport here meshed all three peers.
- An abrupt disconnect. Here the host shut down cleanly; a drop is
  read from Kyneta's source (answer 5). The suites must still check that a
  host restart destroys no live card's replica on a client.
- A browser.

## Addendum: one history per card

Asked when a send made the next Cmd+Z undo a card in another root (ADR-0052).
A disposable probe, with one `Exchange` and no transport: two stacks,
`createUndoStack` with keys `a` and `b`, in one undo document, each scoped to
the cards document and its own card's text. Each card was created as
`createCard` does it, in one gesture, and `a` then had a typing step.

| step | returns | cards and texts after |
|---|---|---|
| `b.undo()` | `true` | `b`'s record and text gone; `a` untouched |
| `b.undo()` again | `false` | nothing changes |
| `a.undo()` | `true` | `a`'s typing undone |
| `a.undo()` | `true` | `a`'s record and text gone |
| `a.redo()` | `true` | `a` back, `alpha` |
| `b.redo()` | `true` | `b` back, `beta` |

**Two stacks whose scopes share the cards document stay separate.** Each
records only commits made in its own gestures, and undoing in one never
reaches the other's steps. `createUndoStack` is asynchronous (it waits for
its undo document to load), so a stack cannot be made inside the input
handler that creates a card. It has to be ready beforehand.

## Addendum 2: undo and redo by document, on one stack

Kyneta added `stack.undo({ docs })` and `stack.redo({ docs })` ("undo and
redo by document on one undo stack"): they take the newest step that wrote
any of `docs`, even under steps on other documents. A pushed step clears only
the redo steps that wrote a document it writes. A disposable probe ran one
stack scoped like `connectSession`'s, created cards as `createCard` does,
and passed `docs: [cardDocId(id)]`:

| step | returns | after |
|---|---|---|
| card `a` created, typed `" more"`; card `b` created; undo `a` | `true` | `a` is `alpha`; `b` untouched |
| undo `a` | `true` | `a`'s record and text gone |
| undo `a` | `false` | nothing |
| typing in `b`, then redo `a` | `true` | `a` back, `alpha`: a step in another card's text does not clear `a`'s redo |
| undo `a`; card `c` created; redo `a` | `true` | **`a`'s record still gone, and its text `" more"`** |

**One stack serves every card**: an undo filtered by a card's document never
reaches another card's steps.

**Clearing redo by conflict is not transitive.** Creating `c` writes the
cards document, so it cleared `a`'s creation step from the redo list. It
kept `a`'s typing step, which wrote only `a`'s text. The next redo filtered
to `a` redid that step into the text of a card whose record is gone. Nothing
on screen changes. A redo step must also go when a step it builds on, one
that shares a document with it and was undone after it, is cleared. Asked of
Kyneta.

Creating any card writes the cards document, so it clears every card's
pending redo of its creation. After you undo past a card's creation, creating
a card anywhere puts that card's redo out of reach.

## Addendum 3: steps conflict by what they write

Kyneta's fix ("undo steps conflict by what they write, and a step is never
taken from under one it conflicts with") changes the rule addendum 2
measured:
- each step carries the region it wrote: a document, down to its record keys
  and texts, so two cards' creations no longer conflict, though both write
  the cards document;
- a new step clears the redo steps it overlaps, and every redo step built on
  a cleared one (`clearDependents`);
- `undo({ docs })` and `redo({ docs })` never take a step from under a newer
  step it overlaps, so either can be `false` while the card has steps.

The same disposable probe, in pine·trie's shape:

| step | returns | after |
|---|---|---|
| `a` created, typed `" more"`; `b` created; undo `a` twice | `true`, `true` | `a` gone; `b` untouched |
| card `c` created; redo `a` | `true` | `a` back, `alpha`, record and text |
| redo `a` | `true` | `alpha more` |
| undo `b`, under newer steps on `a` and `c` | `true` | `b` gone |

**Creating a card no longer clears another card's redo**, and the redo that
wrote into a gone card's text (addendum 2) cannot happen. In pine·trie a newer
step on a card's record or text is only ever that card's own, from its own
box, so its Cmd+Z is never refused. The e2e suite's check 2b now creates a
card between the undo past a card's creation and the redo.
