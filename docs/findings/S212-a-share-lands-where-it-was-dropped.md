# S212 — A card's text gives Yjs-backed positions that follow others' edits, so an upload lands where it was dropped or pasted

- **Status:** Answered
- **Led to:** ADR-0151

**Question.** A share's upload takes time, and a card's text is typed
together: others, and the sender, may edit it before the upload returns.
Today a pasted image goes in at the offset captured at the paste, clamped
to the text (`insertAt`, `packages/interface/paste.ts`), so it can land
inside someone's word.

1. Does a card's text expose Kyneta's positions to the client?
2. Does a position made at the drop resolve, after others' edits arrive,
   to the same place in the text?
3. What happens at its boundary, and when the text around it is deleted?

**Kill criterion.** A card's text has no positions, or one does not follow
a remote edit, so the offset and its race stay.

**Throw away.** `sandbox/s204-cursor/probe.test.ts`, run as a test of
`packages/schema` (two `TextDoc`s, edits merged with `exportEntirety`).

## Answers

1. **Yes.** A card's text is a Yjs document (`TextDoc` in
   `packages/schema/text.ts`), and its `text` ref carries Kyneta's
   `[POSITION]` capability (`hasPosition` is true). The factory's methods
   are `createPosition(index, side)` and `decodePosition(bytes)`
   (`/kyneta/workspace/pineta/packages/schema/src/position.ts`); Kyneta's
   `TECHNICAL.md` calls them `create` and `decode`, which do not exist.
   The page reaches the ref as `session.cardText(id).text`, the one
   `bindText` attaches to the box (`packages/web/card-editor.tsx`).
2. **Yes.** Ada's text was `hello world`, with positions made at 5 (after
   `hello`). Bea inserted `>> ` at 0, then `,` exactly at the position,
   and Ada merged: the text was `>> hello, world`, a `left` position
   resolved to 8 (after `hello`, before Bea's comma) and a `right` one to
   9 (after it). Encoded and decoded, the `right` one still resolved to 9.
3. **It never resolves to null here.** With the whole text deleted and
   `new` typed, the position resolved to 0. `Position.resolve` may return
   null for a substrate whose anchor is gone, so the caller keeps a
   fallback: the end of the text.

**For the plan.**
- At a drop, paste or choice, a box bound to a card makes
  `cardText(id).text[POSITION].createPosition(selection, "right")`; when
  the upload returns, the share goes in at `resolve()`, or at the text's
  end when that is null, as one edit through the box (as typing is, so
  the binding sends it). `right` matches the box's own caret affinity
  (`@kyneta/react`'s text adapter): text typed at the spot meanwhile comes
  before the share.
- A box not yet bound to a card holds only its sender's typing, so its
  offset cannot be moved by anyone else. It keeps the offset; the edit
  that inserts the share makes the card, as the first keystroke does.
- `insertAt`'s clamp stays as the rule for where a share's own lines go
  (a newline where it would touch other text); its comment about an edit
  made during an upload goes.
