# S60 — a wide image for a column's header

**Status:** Answered. Led to ADR-0050.

A column's header is to get a generated banner, drawn with
`background-size: cover`. The header is `28rem` (448px) wide and one or two
rows tall, about 34 to 55px: 8:1 to 13:1. This probe asks which image models
give a wide enough image, how the ratio is asked for, and what it costs.

pi-ai 0.87.1, `generateImages` over OpenRouter (`api/openrouter-images.js`),
2026-09-30. One prompt: "A wide banner: a calm abstract landscape band of
cranes over spring marsh at dawn, soft muted colours, low contrast, no text,
no letters." The ratio went in through `onPayload`, as
`image_config: { aspect_ratio }`, since pi-ai's adapter sends none.

| model | asked | got | ratio | type, size | time | cost |
|---|---|---|---|---|---|---|
| `google/gemini-3.1-flash-image` | none | 1584×672 | 2.36 | PNG, 1.6 MB | 10.9 s | $0.0034 |
| `google/gemini-3.1-flash-image` | 21:9 | 1584×672 | 2.36 | PNG, 1.6 MB | 10.4 s | $0.0034 |
| `google/gemini-3.1-flash-image` | 4:1, 8:1 | refused, 400 | | | | |
| `google/gemini-3.1-flash-image-preview` | 21:9 | 1584×672 | 2.36 | JPEG, 0.8 MB | 9.1 s | $0.0045 |
| `google/gemini-3.1-flash-image-preview` | 4:1 | 2064×512 | 4.03 | JPEG, 0.7 MB | 8.4 s | $0.0046 |
| `google/gemini-3.1-flash-image-preview` | 8:1 | 2928×352 | 8.32 | JPEG, 0.7 MB | 8.8 s | $0.0047 |

## What it shows

- **The ratio is honoured, and pi-ai needs `onPayload` to send it.**
  OpenRouter refuses a ratio the model lacks with a 400 naming the models
  that have it, and pi-ai returns that as `stopReason: "error"` with the
  message: nothing throws.
- **Only the preview of Nano Banana 2 goes wider than 21:9.** The released
  model (`-20260528`) refuses 4:1 and 8:1; the preview (`-20260226`) has
  them. A preview can be withdrawn, so the model is a setting, not a
  constant, and a refused ratio must fall back to 21:9.
- **Asked for nothing, the model read "wide banner" and made 21:9.** The
  brief shapes the image as well as the parameter does.
- **8:1 needs no crop to speak of.** Drawn at 448×34 and 448×55 with
  `center/cover`, the 8:1 image shows its whole scene; 21:9 keeps a middle
  band of about a third of its height, and still reads as a landscape,
  because the prompt asked for a horizontal band with no focal subject.
- **A light image loses a light name.** "Soft muted colours, low contrast"
  gave a pale, pastel image, and the header's light name was barely legible
  on it. The page is dark (`#1b1e24`). A second brief asked for "a very
  wide, dark, low-key banner for a dark user interface … deep blue-grey and
  muted teal, the left third darkest and quiet, the detail spread evenly
  along the horizontal band" (8:1, the preview, 8.1 s, $0.0046): the name
  was plainly legible at both heights, with no scrim, and the left third
  came back darkest as asked. So legibility is the skill's to get right,
  and its wording matters more than the ratio.
- **About 9 seconds and half a cent each.** The bytes are far more than a
  header needs (2928×352 for a 448×55 box, 3× over at 2× DPR), but under
  `MAX_UPLOAD_BYTES` (32 MB); resizing would need an image library on the
  host.
