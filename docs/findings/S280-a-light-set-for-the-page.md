# S280 — A light set keeps the dark set's contrasts and separations, and `light-dark()` holds both in one rule

- **Status:** Answered
- **Led to:** ADR-0196

**Question.** Is there a light value for each of the page's named colours
(ADR-0195) that keeps what the dark set guarantees?
- Text reads at the dark set's contrast on the page.
- A track colour is 4.5:1 or more on the page, 0.059 or more from every other
  track colour, and 0.08 or more from people's first colours, the attention
  amber and the review's lines (`colors.test.ts`).
- A person's colour shows as a ring and carries a readable initial.

Can one rule hold both sets, with no colour repeated outside it? And can a
banner, drawn on black for `mix-blend-mode: lighten`, show on a light page?

**Kill criterion.** No light track palette meets the dark set's separations
at 4.5:1. Or the bundled Chromium cannot resolve `light-dark()` through a
custom property, `color-mix()` and an inline `var()`.

**Throw away.** `sandbox/light/` (the solver and the probes).

## Answers

**One rule holds both sets.** In Chromium 156 (the suites' headless shell),
these all resolve per `color-scheme`, with `light dark` following the
system and `:root[data-theme]` forcing one:
- `--page: light-dark(#fbfbfc, #14161a)` in a custom property;
- the same nested in `color-mix()`;
- an inline `var()`;
- a box-shadow colour;
- an SVG `stroke` in `style`.

A relative colour takes another's components:
`hsl(from var(--person-tone) 171 s l)` resolves to the same
`rgb(114, 202, 189)` as the literal `hsl(171 45% 62%)`. So a later person's hue
can come from code while the theme sets their saturation and lightness.

**Text keeps its contrast.** Each text colour keeps the dark ramp's slight
blue and takes the lightness whose contrast on `#fbfbfc` matches its dark
contrast on `#14161a`:

| name | dark | contrast | light | contrast |
|---|---|---|---|---|
| `--text-bright` | `#fff` | 18.1 | `#13161c` | 17.5 |
| `--text` | `#e6e6e6` | 14.5 | `#23272c` | 14.5 |
| `--text-soft` | `#ddd` | 13.3 | `#2a2d33` | 13.4 |
| `--text-dim` | `#c9d1d9` | 11.7 | `#30363d` | 11.8 |
| `--text-muted` | `#aab4c3` | 8.7 | `#424a56` | 8.7 |
| `--text-faint` | `#8b93a1` | 5.9 | `#5b6370` | 5.9 |
| `--text-quiet` | `#6f7784` | 4.0 | `#757d8a` | 4.0 |

The surfaces are chosen, not solved. The page is near white, and the chrome
around it is a shade greyer, as ADR-0081 has it in dark. `--raised` (a menu, a
field, a hover fill) is white, which lifts off the page. The edges and lines
step down from the page as they step up from it in dark.

**Hues keep their OKLCH hue and chroma.** A hue used as text takes 4.5 to
6:1 on the light page (`--accent` `#456baa`, `--agent` `#3a6392`, `--danger`
`#b75650` …). `--action` (`#2f6feb`, white text, 4.6:1) and the pending
grey (`#777`, 4.0:1 dark and 4.3:1 light) read on both pages, so each has one
value.

**Track colours.** All twelve at 4.6:1 and chroma 0.14 come 0.050 apart at
the closest, which is under 0.059. A light page compresses readable colours
into a narrow band of lightness, and yellow and green cannot hold chroma
there. A search over each slot's contrast (4.5 to 6:1, chroma up to 0.2)
finds:

`#b84b01 #8d5801 #897203 #5d6d04 #037f20 #077f63 #057295 #0471cf #5d5be2 #8947ce #a733a8 #c52d7f`

These are 0.070 apart at the closest, and every slot keeps its dark hue.

**Reserved colours.** The search places them 0.088 or more from every slot:
- `--attention`: `#654a00`, at 8:1. At 6 to 7:1 it lands within 0.03 of
  slots 1 and 2.
- `--ok-soft`: `#2a552c`.
- `--danger-soft`: `#7d393c`.
- People's first colours: `#fe5dd9`, `#1f2328` and `#b59d02`. In dark the
  second person is white, the page's far end; in light it is near black.

**An initial reads on any person's colour** if its text is chosen from the
fill. In dark every person is bright, so text is ink (`#111`). In light,
`#1f2328` needs white. `oklch(from var(--fill) clamp(0.178, (0.56 - l) *
infinity, 1) 0 0)` gives ink (`oklch(0.178 0 0)`, `#111`) on a fill lighter
than 0.56 and white on a darker one. That is near where the two contrasts
cross (0.58). It also keeps every dark fill, the grey draft tone included
(0.567), on ink as today. The same rule serves the inbox's badge, a search
match and a card's main button, whose fills are bright in dark and dark in
light. A multiplier of 1000 leaves a grey for a fill within 0.001 of the
threshold (`#2575ca` came out `oklch(0.54 0 0)`); `infinity` does not.

**A later person's colour.** `hsl(h 45% 62%)` on the dark page reads 4.3 to
10.5:1 across every hue. On the light page, `hsl(h 50% 38%)` reads 3.2 to
10.4:1, with white initials.

**Banners.** `lighten` takes out a banner's black only where what lies under
it is darker. On a light page the black would stay as a box. A ground
under the mark, `light-dark(#14161a, transparent)`, keeps dark exactly as it
is (transparent) and gives each banner a dark tile in light.
