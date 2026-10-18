# S241 — Every kind's compact fits half a column at one height, 4rem, if its lead and second line are one flow cut at two lines

- **Status:** Answered
- **Led to:** ADR-0171

**Question.** Compact is half a column wide, a header row and two lines,
its text cut past them, and one component draws it for every kind
(ADR-0171, proposed). Half of a thread's column (28rem) less the bag's gap
is about 13.6rem.
- At the page's font and sizes, how many characters does a line hold, and
  does a text card's lead say enough to be told from its neighbours (the
  first lines of the cards in a real inventory)?
- Does `-webkit-line-clamp: 2` cut a lead and second line at the same
  height in every kind, a line of CJK, an emoji and a long unbroken word
  (a path, a URL) included, with no box taller than the rest?
- Does a header row hold the kind's icon, the author's circle or a
  thread's banner, and a badge (1–9, "stopped", "3 queued") without
  wrapping?
- A reference's quote is fetched once per page (`useQuote`): drawn before
  it arrives with its kind's words, does the slot keep its height when the
  quote replaces them?
- Six rows of compact slots and a status line: how tall is the panel, and
  does it fit a 768px-high viewport below the header?

**Kill criterion.** If two lines at half a column cannot tell a real
inventory's cards apart, or one kind's compact cannot keep the common
height, compact's shape changes (a third line, or a wider ratio) before
the plan.

**Throw away.** A probe page drawing each kind's compact from sample
cards, screenshotted and measured in the lane's headless Chromium.

**Answers.** Measured in the lane's headless Chromium 156 with a probe
page (`docs/findings/S241-compact-fit/compact.html`, driven by
`s241.mjs`) that loads the page's own styles (the `<style>` of
`packages/web/index.html`) and draws twelve compacts: the six text cards
of a real inventory and five made to break it (a URL, CJK with an emoji,
a long thread name, a reference before its quote is read), a note column
and a fact. Font `ui-sans-serif, system-ui` resolves to the lane's Linux
sans, not the Mac's SF, so a line holds about as many characters on the
Mac, give or take a few.

1. **Half a column is 13.1rem** (209 px): a thread's column is 28rem,
   less the bag's padding and one gap, halved.
2. **One flow clamped at two lines tells cards apart; one line per field
   does not.** At 0.78rem a line holds about 34 characters. Drawn as a
   lead line and a second line, each cut at one line, a text card showed
   its first 30 characters ("A possible simplification, not do…") and
   left the second line empty. Drawn as one flow, lead then second line
   in a dimmer colour, cut with `-webkit-line-clamp: 2`, it showed about
   65 ("A possible simplification, not done: inside a file's history the
   host…"), about what today's three lines of 20 show. A thread's name
   then its last line, and a reference's quote then its thread, read as
   one sentence in two colours.
3. **Every kind keeps the same height.** At 3.6rem and at 4.1rem all
   twelve compacts measured the same, none overflowing: the URL broke
   with `overflow-wrap: anywhere`, CJK and the emoji wrapped in place, a
   long thread name took both lines. The text ended 6 px above the box's
   bottom at 4.1rem, 5 px at 3.6rem.
4. **The header row holds** the kind's icon, the author's circle or a
   thread's banner, and "stopped · 3 queued" on one line, 1.1rem high.
5. **A reference before its quote is read** shows its kind's words ("a
   quote") in the same box; the quote replaces them at the same height,
   since the box's height is fixed, not its content's.
6. **The panel is about 520 px tall** at 4rem compacts: the bag 446 px
   (six rows and gaps, its padding), a header and a status line. At
   `top: 30vh` on a 768 px viewport it would run 20 px under the footer,
   so its top is the smaller of 30vh and what keeps its foot above the
   footer.

The kill criterion did not hold, with the change in 2: compact draws its
lead and second line as one flow clamped at two lines, at 4rem.

**Sources.** `compact.html` is the probe page (it links `page.css`, the
`<style>` block of `packages/web/index.html` saved beside it when run),
`s241.mjs` the Playwright run.
