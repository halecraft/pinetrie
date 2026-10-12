# S190 — PixelLab draws 32×32 icons with a truly transparent background, but each noun needs a written subject, and a style reference copies its subject

- **Status:** Answered
- **Led to:** ADR-0143

**Question.** Can PixelLab's API draw a thread's icon as a 32×32 sprite
with a transparent background, one per noun of the 256 in
`packages/core/thread-names.ts`, recognisable at the column header's
24 CSS px and clean when magnified ×7 with `image-rendering: pixelated`?
How alike can 256 of them be made to look, what does each cost, and how
large is a sheet of them?

**Kill criterion.** Fewer than three in four of the nouns tried are
recognisable at 32×32, or the background is not truly transparent (stray
opaque pixels or a halo), or a reference image does not hold a set's
style together.

**Throw away.** The script, and every image but the ones kept as
sources. A free key allows 40 requests; this spike spends at most 30.

## Answers

- **The transparency is real.** Every image is a 32×32 RGBA PNG with
  binary alpha: no pixel is partly transparent, so there is no halo on
  either a dark or a light background, and the corners are clear. The
  exception is a noun drawn as a landscape (`canyon`, described as one):
  it fills the whole square, opaque to the edge.
- **The noun alone gives characters.** With the noun in a "game sprite"
  prompt, 5 of 12 were the thing (fox, toucan, zebra, lobster, violin).
  The other 7 became creatures or people: an anvil a rhino, a lantern a
  girl holding fire, a galaxy a frog. Saying "not a character, no person,
  no face" made it worse: all 7 again became characters, more of them
  people. The model reads a negated word as a subject.
- **A written subject fixes it.** The same 7 nouns, each given a concrete
  description with no negation ("an old brass oil lantern with a glowing
  yellow flame inside, a single object icon"), gave a recognisable
  lantern, galaxy, echo (a peak with sound-wave arcs) and zephyr (a swirl
  of wind with a leaf); the anvil reads only roughly, and the canyon came
  out as a full-bleed scene. With the noun alone where it works and a
  description where it does not, 10 of 12 are recognisable. The noun
  list is fixed, so 256 descriptions are written once, as the sheet's
  source; about 40% of the nouns are landscapes, weather or abstractions
  (`echo`, `zephyr`, `tundra`, `dawn`) and need one.
- **A style reference copies its subject.** Bitforge given the toucan as
  `style_image` at `style_strength` 60 drew an owl, a kettle, a comet and
  a cactus all as toucan-like birds. A weaker strength was not tried. The
  set's likeness has to come from one prompt template and one model, which
  already gave a fairly consistent look (similar outline, shading and
  saturation), and from redrawing the ones that do not fit.
- **At 24 CSS px and at ×7 both read.** Shown at the header's size,
  smoothly scaled, on the page's `#1b1e24` and on light grey, and at the
  details' 112 CSS px (224 device px, exactly ×7) pixelated, the
  recognisable ones read at both sizes. Their outline is mostly dark,
  which recedes on the dark page, but the silhouettes still read.
- **Cost and time.** The free plan counts generations (`usage` reports
  `{"type": "generations", "generations": 1}`) and runs one job at a time:
  a second concurrent request is refused with 429, and so is one sent a
  second or two after the previous reply. A generation took 16–81 s,
  median 36 s, so 256 run one at a time take about 2½ hours. PixelLab's
  API page lists Pixen at $0.007 for 32×32 on a paid plan: $1.79 for 256,
  before redraws.
- **The sheet is about 150 KB.** The 22 tiles drawn with transparency
  come as PNGs of about 1 KB each. Laid out 16 to a row and written as
  one RGBA PNG (zlib level 9, no filtering), they take 597 bytes a tile:
  about 149 KB for 256. They use 873 distinct colours between them, so a
  256-colour indexed sheet would need quantising first.

**Kill criterion.** Met on its third count: a reference image did not
hold the style together. The other two are not met: 10 of 12 were
recognisable with a written subject, and the transparency is clean.

## Evidence

Run on 2026-10-12 against `https://api.pixellab.ai/v2`, with a free key
(29 of its 40 generations), 32×32, `no_background: true`, `outline:
"single color outline"` (Bitforge: `"single color black outline"`),
`detail: "medium detail"`.

| round | endpoint | prompt | nouns |
|---|---|---|---|
| `pixen` | `create-image-pixen`, `view: side` | `{noun}, a single game sprite, side view, whole and centred` | fox, toucan, zebra, lobster, lantern, violin, anvil, canyon, aurora, echo, zephyr, galaxy |
| `pixen-icon` | `create-image-pixen` | `{noun}, a single icon of the thing itself, whole and centred; not a character, no person, no face` | the 7 that failed |
| `pixen-described` | `create-image-pixen` | one description each, below | anvil, lantern, galaxy, canyon, echo, zephyr |
| `bitforge` | `create-image-bitforge`, `style_image` the toucan, `style_strength: 60` | `a {noun}, a single icon, whole and centred` | owl, kettle, comet, cactus |

The descriptions: "a black iron blacksmith's anvil, a single object icon";
"an old brass oil lantern with a glowing yellow flame inside, a single
object icon"; "a purple and blue spiral galaxy of white stars, a single
icon"; "a red rock canyon landscape with a blue river at its bottom, a
single icon"; "a grey mountain peak with three curved white sound-wave
arcs beside it, a single icon"; "a swirl of pale blue wind with a green
leaf blowing in it, a single icon".

Sources, in `docs/findings/S190-pixellab-icons/`: `draw.py`, the script
that made each request (key from `PIXELLAB_KEY`, a 429 waited out), and
`tiles/<round>/`, each round's PNGs and its `log.tsv` (noun, seconds,
usage, status). Alpha, colour counts and the sheet's size were read with
a throwaway PNG decoder and encoder in Python's standard library; the
contact sheets were drawn in headless Chromium.
