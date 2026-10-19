# S249 — Can a column draw thirty fitted images, or does a media column need thumbnails?

- **Status:** Answered
- **Led to:** ADR-0182

**Question.** A media column holds images to compare: a teammate's
uploads, an agent's screenshots, generated alternatives, each with its
versions. The blob store keeps an image's original and, when it differs,
its copy fitted to 2000×2000, which a column draws today (ADR-0151). With
about thirty images in one column, in Chromium at a Mac's pixel ratio of 2:

1. What do they cost the browser in memory and in the time to decode,
   drawn full (a column's width, scrolled through) and compact (half a
   column, all in view at once), from the fitted copy and from a copy 512
   wide?
2. Does scrolling a full column of them hold its frames, at 4× CPU
   throttling as S153 measured drags?

**Kill criterion.** If thirty fitted copies cost more than 1 GB of the
browser's memory, or scrolling them drops frames past 50 ms where 512-wide
copies do not, a media column needs a smaller copy of each image, made and
kept by the host, which the blob store does not have.

**Throw away.** The probe (`probe.ts`), its generated images and its page.

**Answers.**

Thirty images, each 2000 wide as a fitted copy is: ten screens (PNG,
about 490 KB each), ten photos (JPEG at 85, about 910 KB) and ten pieces
of pixel art (2000×2000 PNG, about 18 KB). The same thirty were also
scaled to 512 wide by the browser. Each was drawn in a 448 px column (a
thread column's width) with its stored width and height, `loading=lazy`
and `decoding=async`, and as 216 px tiles in a 6×5 grid, at pixel ratio
2. Memory is the PSS of every Chromium process, over a blank page's.

| drawn | from | memory added | all decoded | first scroll, 4× | scroll again, 4× |
|---|---|---|---|---|---|
| full, scrolled through | fitted | 469–484 MB | — | p95 16.8 ms, max 16.8 | p95 16.7 ms, max 16.8 |
| full, scrolled through | 512 wide | 55–57 MB | — | p95 16.7 ms, max 16.8 | p95 16.8 ms, max 33.3 |
| compact, all in view | fitted | 509–565 MB | 112–364 ms | — | — |
| compact, all in view | 512 wide | 60–61 MB | 19–33 ms | — | — |

(Ranges are over three runs; the frames are the last run's, over 160
and 240 frames. The column scrolled through 10,820 px of 11,680.)

Decoding one image (`createImageBitmap`, unthrottled) took 9–21 ms from
a fitted copy and 1–3 ms from a 512-wide one.

1. **A fitted copy costs about 16 MB of the browser's memory once drawn,
   whatever its bytes; a 512-wide copy about 2 MB.** That is the decoded
   bitmap, set by its dimensions: the 18 KB pixel art costs as much as
   the 910 KB photo. Chromium kept every decoded image after the column
   scrolled past it. Thirty in one column cost under 0.5 GB. Thirty as
   compact tiles cost as much as thirty full, since each tile decodes the
   whole fitted copy to draw 216 px of it.
2. **Scrolling held its frames.** At 4× throttling no frame went past
   50 ms, on the first scroll while images loaded, or after. Scrolling
   ran on the compositor, and decoding off the main thread.

The kill criterion is not met: a media column can draw the fitted copy
the blob store already keeps, with its stored size reserving its box
(`StoredImage`, `packages/web/blob-image.tsx`). A smaller copy is worth
about eight times less memory, for compact above all, where a tile shows
a sliver of what it decodes. Whether that is worth a third copy in the
blob store is for the design to weigh; nothing here requires it.

**Not measured.**

- A real Chrome on a Mac. The headless shell composites in software, and
  a GPU process holds rasters of its own. Its frames say only that no
  main-thread work blocked a scroll.
- Several media columns on one canvas, or versions drawn side by side,
  which multiply the per-image cost.
- Safari, which manages decoded images differently.

**Sources.** `S249-a-column-of-many-images/probe.ts`, which makes the
images, serves them and measures; `output.json`, the last run's numbers.
