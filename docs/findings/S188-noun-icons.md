# S188 — PixelLab's Pro model drew all 256 noun icons at 32×32 for about $21, and one 512×512 sheet of them is 129 KB

- **Status:** Answered
- **Led to:** ADR-0143

**Question.** Can a 32×32 icon with a transparent background be made for
every noun in `packages/core/thread-names.ts`, recognisable at the column
header's 24 CSS px, looking like one set, by asking PixelLab's Pro model
(`generate-image-v2`) for 64 variants of each noun and choosing one? What
does it cost and take, and how large is the sheet?

**Kill criterion.** More than one noun in ten has no recognisable
candidate among its 64, or a picked icon has partial transparency, or the
whole set costs more than the $25 of credit.

**Throw away.** Nothing drawn: every candidate is kept, so a pick can be
changed without drawing again. The scripts are sources, not maintained.

## Answers

- **Every noun has a usable icon.** All 256 got 64 candidates, and each
  noun had several recognisable ones; S190's characters-for-objects
  problem did not recur, since every noun went in with a written subject
  (`prompts.json`), and Pro draws the subject asked for. Places were asked
  for as "a tiny round diorama of …, a small piece of land floating on its
  own", which gave them a contained silhouette that matches the objects',
  instead of S190's full-bleed canyon.
- **The set looks like one set.** The same template for every noun gave a
  shared style (a dark outline, bright saturated colour, similar shading).
  Seen together at 24 CSS px on the page's `#1b1e24`
  (`/workspace/.plans/noun-icons/preview-24.png`, made by `preview.mjs`),
  nothing stands out as from another style.
- **Black subjects disappear on the dark page.** Crow, raven, panther, mink
  and yak came out near-black. Redrawn with words asking for highlights
  ("glossy black feathers shining bright blue and purple in the light"),
  raven, crow, mink and yak became legible. Panther needed a second
  redraw, asked for as lit by moonlight so its back shines silver-blue
  (`redo2:` in `picks.json`). A few dark greens (alder, bay, forest) read, but
  only just.
- **Wide subjects spill across cells.** Pro draws its 64 variants on one
  8×8 canvas, and a subject wider than a cell (an open atlas, a canoe side
  on, a belt buckle on its strap) runs into the next cell, so a candidate
  can be half of one. Those were passed over for whole ones (an end-on
  canoe, a closed atlas).
- **The transparency is clean.** The sheet has no partly transparent pixel.
- **Cost: $21.28 for 266 charged jobs, $0.08 each.** 256 nouns, 6 redraws,
  and 4 jobs lost when a run was stopped mid-job (charged, never saved).
  Six jobs failed on PixelLab's side ("Generation failed"), were not
  charged, and succeeded when tried again. A trial job before the run
  used the free plan's generations, not the credit.
- **Time: about 12 hours, one job at a time.** A job took 10 s to 52 min,
  median 162 s. The account runs one job at a time, and a second is
  refused with 429 until the first is done.
- **The sheet is 512×512 and 129 KB.** 16 × 16 tiles of 32×32 in the order
  of `NOUNS`, so the noun at index *i* is at column *i* % 16, row
  *i* // 16. A name's pair index (`pairAt` in `packages/rules/names.ts`)
  keeps the noun in its low byte, so that byte is the tile. RGBA, zlib
  level 9 with no filtering; the sheet has 6,971 colours, so an indexed
  PNG would need quantising first.

**Kill criterion.** Not met: every noun has a recognisable icon, none has
partial transparency, and the set cost $21.28 of the $25.

## Evidence

Run on 2026-10-12 and 13 against `https://api.pixellab.ai/v2`,
`generate-image-v2`, `image_size` 32×32, `no_background: true`; the
description is the template in `draw.py` around each noun's subject.

Sources, in `docs/findings/S188-noun-icons/`:

- `subjects.py` writes `prompts.json`, each noun's subject; `redo.json`
  holds the redrawn subjects.
- `draw.py` draws one noun's 64 candidates; `keep.sh` restarts it when a
  run ends (the key is read from an untracked file).
- `next.sh` and `grid.mjs` show four nouns' candidates at a time, numbered;
  `pick.py` records each choice in `picks.json`, where `redo:N` or
  `redo2:N` names a redrawn candidate.
- `sheet.py` builds `noun-icons.png` from the picks; `preview.mjs` shows
  the sheet as the page would draw it, named, at a given size.
- `png.py` decodes and encodes PNGs in Python's standard library.

The candidates are not committed: 16,768 PNGs, in
`/workspace/.plans/noun-icons/candidates/<noun>/00.png … 63.png` and
`candidates-redo/` and `candidates-redo2/`, each folder's `log.tsv` recording every job (noun,
seconds, usage, status). The grids judged are in
`/workspace/.plans/noun-icons/grids/`.
