# S251 — Which model writes a useful gist of an image as it lands, and at what cost?

- **Status:** Open (its probe needs a model key, and runs on the Mac)

**Question.** A media column's agent is told it exists, not shown its
images, until a tool reads a card on demand. A short text gist of each
image, written by a vision model when the image lands, would let an agent
know what the column holds without the image in its context. pine·trie's
requests outside a thread (`PiSetup.complete`, `packages/pi/config.ts`)
send text alone, on the describe or title model, which may read no images
(the person's is Cerebras; of Cerebras' models pi lists, only
`qwen-3.8-27b` takes images).

1. Which vision model, among cheap ones pi lists (Gemini 3.1 Flash Lite
   and 2.5 Flash Lite, Qwen3-VL 8B, GPT-5 nano, Claude Haiku 4.5 through
   OpenRouter, and Cerebras' Qwen 3.8 27B), writes a gist that says what
   the image is and what in it matters?
2. Does a gist tell apart near-identical alternatives, which a media
   column holds to compare: one thread with and without its image in the
   pane, and three generators' drawings of one noun?
3. What does one cost, in tokens and money, and how long does it take?

**Kill criterion.** If no model under about a tenth of a cent an image
writes gists that tell the alternatives apart, a gist gives the agent
nothing a title does not, and the agent should learn an image only through
the tool that reads a card.

**Throw away.** The probe's replies, once read into the answers.

**Sources.** `S251-a-gist-of-each-image/`:

- `images/`: seven images. `ui-thread.png`, `ui-thread-pane.png` and
  `ui-board.png` are pine·trie's page in Chromium, a thread with a sheet
  of icons, the same with the sheet in the pane, and the board.
  `art-anvil-a.png`, `-b` and `-c` are S190's three generators' anvils,
  scaled to 512. `diagram.png` is four boxes and their arrows.
- `fixtures.ts` made them, against a suite host.
- `probe.ts` asks each model it has a credential for, with the system
  prompt in its source, and writes `output.json`.
