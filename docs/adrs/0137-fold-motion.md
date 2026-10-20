# ADR-0137 — A column folds and unfolds in motion, its name turning into its strip, which is its header turned on its side

- **Status:** Accepted (Duane, 2026-10-11)
- **Area:** `docs/06-interface.md`, `packages/web/TECHNICAL.md`,
  `packages/interface/TECHNICAL.md`
- **Evidence:** S164, S165, S166, S167
- **Amends:**
  - ADR-0116: a folded strip shows its thread's mark, and its name at the
    header's size and colour, in its thread's colour.
- **Amended by:**
  - ADR-0198: the strip is the whole header turned on its side, in the
    header's order; the fold toggle comes first and stays where it is.

**Context.**

- **A fold swapped a column for its strip in one frame.** Every column
  after it jumped sideways, and nothing showed which strip the column had
  become. `Strip` draws a folded column and an unfolded one as different
  elements, so a CSS transition had nothing to act on.
- **The strip looked unlike the header**: no mark, its name smaller
  (0.8rem against 0.85rem or 0.9rem) and grey, its top edge grey. A name
  turned from the header could not land on it: S167 measured glyphs up to
  5.5 px off at those sizes, and 0.00 px off at the same size.
- **An unfold renders in one long task**, a microtask after its click,
  about 250 ms for a column of 150 messages in the development build that
  `pnpm host` serves (S164). The column arrives whole in one frame.
- **The page already animated one move this way**: a moved card flies from
  its old box to its new one, and whether it flies is the plan's
  (`moveCard`'s `fly`).

**Decision.**

- **The strip is the header turned on its side.** A thread's strip shows
  its mark (its banner, or ✦), then its name at the header's size, in its
  thread's colour, under a top edge in that colour; the task column's and
  a note column's strip, their title at the header's size and colour.
  The strip's rows above its name have fixed heights, declared once as
  registered custom properties (`--strip-mark-top`, `--strip-name-top`),
  which the strip is laid out by and which a fold reads before its strip
  exists.
- **Folding a column moves it into its strip.** In 200 ms:
  its name turns 90° clockwise about its own top-left corner onto the
  strip's name, its mark moves to the strip's, everything else in it
  fades out in the first 40%, and its right edge closes in to the strip's
  width. The clip and every column after it follow that one edge, which
  stays clear of the turning name. Unfolding is the same, reversed, the
  rest fading in over the last 60%.
- **A fold animates the live column, then lands; an unfold lands, then
  animates.** A fold's end state holds until its strip is drawn, and is
  let go then, after React's commit and before the paint: let go before,
  and the old layout shows for a frame (S165). An unfold animates the
  column its commit draws, before its first paint; the motion adds no
  wait to the render's (S164).
- **Only a fold the reader asks for moves**: the strip's button, the ⋯'s
  Fold, the task column's fold and its strip. A fold or unfold a
  navigation makes (going to an entry, a reveal, a branch opened, a note
  column made, a card put on the canvas) lands at once. The plan says so
  (the `layout` effect's `moves`), and `perform` carries it out through
  the `foldColumn` port, as `fly` is carried out.
- **Nothing moves** under `prefers-reduced-motion`, during a drag, or for
  a column out of the strip's view; a name that wraps, outgrows the strip
  or is another size fades with the rest instead of turning. A press that
  starts a drag, or another fold, first brings a fold in flight to its
  end.

**Consequences.**

- What moves where is a value (`planFoldMotion`, `fold-motion.ts`), tested
  without a browser; the page measures and plays it
  (`use-fold-motion.ts`).
- A fold reaches the layout about 200 ms after its click. A check that
  reads the layout after a fold waits for the strip.
- A thread's strip and its column take their colour by one rule
  (`threadTrack`), so the two never disagree.
- Card flights now honour reduced motion too, and wait for their card
  through the same helper (`motion.ts`).
- On a slow machine an unfold still waits for its column to render before
  anything moves (S164); the frames of the motion itself keep an idle
  page's rate at 4× throttling (S166).

**Alternatives rejected.**

- **A CSS animation as the new element mounts.** It animates only what
  arrives, never what leaves, plays on every mount unless gated, and
  animating `width` lays out the whole strip each frame.
- **The View Transitions API.** The page is a snapshot while it runs,
  which takes no clicks; its cross-fade stretches the strip into the
  column; it needs the render synchronous in its callback.
- **Keeping the leaving column mounted** (an exit animation in React
  state). A folded column leaves the projection of paths, so its view is
  gone at the commit; keeping it would mean projecting folded columns too.
- **A copy of the column laid over the strip.** A light copy moving over
  the strip cost 50 ms frames at 4× throttling (S153), and the fade would
  have two things to cover.
- **Turning the name only once the strip is drawn.** The clip would cut
  the name while it still lies along the header, and the motion would
  come in two stages.
- **Moving something during the unfold's long render.** A compositor
  animation started a frame early keeps moving through it (S164), but the
  column's boxes do not exist until it renders.
