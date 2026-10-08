# S110 — Twelve track colours at OKLCH lightness 0.72 and chroma 0.14 read apart, and apart from what already has a colour; a root steps through them by 7

- **Status:** Answered
- **Led to:** ADR-0089, ADR-0098

**Question.** ADR-0089 seeds each root's tracks from a larger palette. Which
colours, at one lightness and chroma in OKLCH, and how many:

- are each at least 4.5:1 against `--page`, since a column's name is drawn
  in its track colour (`.agent-name`)?
- are far enough apart from each other that neighbouring tracks can be told
  apart on the rail and in two headers side by side?
- can't be mistaken for the colours that already mean something: a
  person's first colours (`#ff4fd8`, `#ffffff`, `#ffe030`, `presence.tsx`),
  the attention amber (`#e0c080`), and the review's added and removed text
  (`#a8d8a8`, `#e89a9a`)?
- leave the working ring (`#9ecbff`, `.root-status.working`) readable
  around a tile of any of them?

And which stride, coprime with the count and near `count / φ`, puts the
first five tracks of any seed furthest apart?

**Kill criterion.** If fewer than 12 colours meet every bound, ADR-0089
keeps the seed and stride and takes as many as do, and its consequence on
shared colours is worked out again for that count.

**Throw away.** A swatch page rendered with headless Chromium: every
candidate as a rail track, a column header's name and stripe, a list tile
with initials, ringed and not, on `--page` and `--chrome`, beside the
review's lines. The page and its screenshots are deleted after; the
chosen colours, their contrast and distances are recorded here.

**Answers.**

Distances are Euclidean in OKLab (ΔE). The old palette's closest pair was
`#9ecbff` and `#b2ccd6`, 0.062 apart, and its track 2 was the attention
amber itself (0.000). A script searched lightness 0.72 to 0.86 and chroma
0.08 to 0.17 for the most hues, on a 1° grid, that are in sRGB, at least
0.06 from each other, at least 0.08 from every reserved colour, and 4.5:1
on `--page`.

1. **Twelve colours meet every bound, at L 0.72 and C 0.14**, at hues 45,
   70, 95, 120, 145, 170, 228, 253, 278, 303, 328 and 353:
   `#eb8656 #dc932e #c0a320 #9ab140 #67bb6b #13c097 #03b4e9 #60a8fa
   #919afb #b68dec #d383d1 #e67dac`. Rounded to hex, the closest pair
   (`#03b4e9`, `#60a8fa`) is 0.0596 apart. Thirteen or more need the bound
   between colours under 0.06, which the old palette's closest pair
   already set as the floor. The gap from 170° to 228° is the cyans that
   lightness and chroma can't reach in sRGB.
2. **Their lightness keeps them off what already has a colour.** The
   reserved colours are all lighter (amber 0.82, added text 0.84, yellow
   0.91), so a track at the same hue still sits 0.08 or more away. The
   nearest of each:
   - amber `#e0c080`: 0.114
   - removed text `#e89a9a`: 0.081
   - added text `#a8d8a8`: 0.130
   - magenta `#ff4fd8`: 0.116
   - yellow `#ffe030`: 0.189
   - white: 0.312
   - the working ring's `#9ecbff`: 0.121
3. **Contrast:** at least 6.81:1 on `--page` and 7.16:1 on `--chrome`. The
   page's own colour drawn on any of them as initials is 6.81:1 too.
4. **A person's hashed colour** (`hsl(h 45% 62%)`, from the fourth person
   on) can come within 0.043 of a track at the same hue. The rail draws a
   ring with a dark gap, so it still reads as a ring. The first three
   people's colours are each 0.116 or more away.
5. **Stride 7.** It is coprime with 12 and the nearest whole number to
   12/φ (7.4). Neighbouring tracks are 5 slots apart around the circle. Any
   five tracks from one seed are at least 2 slots apart, which is the most
   five can be among twelve.
6. **Seen:** on a swatch page in Chromium 141, each colour as a rail
   capsule, a header's name and a list tile with initials, ringed in the
   working blue and carrying an amber dot, on `--page` and `--chrome`,
   beside the old palette and the people's rings. The amber dot reads on
   the orange and gold tiles, and so does the working ring on the blues.
