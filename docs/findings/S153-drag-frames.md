# S153 — Does a pointer drag that hit-tests drop zones and slides the neighbouring columns keep up with the display on a wide canvas of long columns?

- **Status:** Answered
- **Led to:** ADR-0134

**Question.** ADR-0134 drags every column, card and task with one pointer
engine. Each pointer frame it would:
1. move the dragged column with a transform (lifted: scaled, shadowed),
   letting the pointer through it;
2. find the drop zone under the pointer with `elementFromPoint` and
   `closest(DROP_ZONE)`;
3. slide the neighbouring columns apart, with a CSS transition, when the
   gap the column would land in changes;
4. mark the target under the pointer, and leaving the strip, show a small
   card face in place of the column.

On pine·trie's own page, with its own CSS (`:has()` rules among it), a task
of ten unfolded columns of 100 to 200 messages each, at 1920 × 1080: does
that work fit a frame, at full CPU speed and with the CPU throttled four
and six times?

**Kill criterion.** The engine as ADR-0134 describes it is not viable if,
at 4× throttling, the frames during a drag are slower than the same
pointer movement with no drag (the page's own baseline) by more than 2 ms
at the 95th percentile, or any frame goes over 50 ms that the baseline
does not. Then the plan must hit-test against geometry cached at the
drag's start rather than `elementFromPoint`, or drop the live slide.

**Throw away.** The probe: a script that starts a suite host, writes the
task through the session, opens the page in Chromium's headless shell,
injects the engine's per-frame work as a stand-in, and drives the pointer
across the strip and out to the sidebar. It is not the engine.

**Answers.** Yes, with three conditions the plan must keep. Against the
kill criterion as written, the engine exactly as ADR-0134 first described
it fails narrowly at 4×: its continuous frames match the baseline at the
95th percentile, but it adds one 67–100 ms frame at the press, and its
lift costs about 25 more frames over 20 ms per drag.

1. **Hit-testing with `elementFromPoint` is cheap enough.** Its share of a
   frame's work is at most 0.4 ms at the 95th percentile at 4× when the
   dragged column only translates, and 4–6 ms when it is also scaled,
   rotated and shadowed. Geometry cached at the press costs 0.2–0.4 ms;
   the frames it gives are the same. Caching is not needed.
2. **The lift must not scale, rotate or shadow the real column.** At 4×,
   moving the column flat gave 6–9 frames over 20 ms per drag (the
   baseline 2–4) and a 95th percentile equal to the baseline's; scaling,
   rotating and shadowing it gave 26–53, with its 95th percentile up to
   33 ms in one run. A lift has to be drawn on something light: the
   column's header, or an element of its own.
3. **Nothing light may move over the strip unless the columns are their
   own layers.** A light copy of the column (`ghost`) moved over the strip
   made the median frame 50 ms at 4×, and the 95th percentile 67 ms:
   whatever it overlapped was repainted. With each column its own layer (`will-change: transform`)
   the copy ran at the baseline, but making the layers cost one frame of
   130–230 ms at the press, and each column as a layer, without a copy,
   was worse than none (149–180 frames over 20 ms). The card face drawn
   off the strip, over the sidebar, cost nothing measurable.
4. **Every variant pays one long frame at the press** under throttling
   (67–100 ms at 4×, 117 ms at 6×, up to 233 ms with layers; at 1× no
   frame passed 33 ms): the
   first frame that lifts the column and arms the neighbours'
   transitions. The plan arms them at
   `pointerdown`, before the 5 px threshold, so that frame falls before
   the column is seen to move.
5. **Neighbours sliding apart cost little.** A gap change costs one frame
   over 50 ms in a few runs at 4×, and none at 1×.
6. **At 6× nothing holds the display's rate**: the drag's 95th percentile
   is 33–50 ms in every variant (83–100 ms for the copy without layers),
   against the baseline's 16.8 ms.

**How it was measured.** `docs/findings/S153-drag-frames/probe.ts` (run
from `apps/pinetrie/e2e/`, as its header says) starts a suite host with the
scripted model, and writes one task through the session: a trunk of 200
messages and nine branches of 120, the messages a mix of paragraphs,
lists, code blocks and tables. Chromium's headless shell (141) opens it at
1920 × 1080, unfolds the ten columns (24,563 elements, 1,280 messages) and
injects the stand-in, which takes the press before `use-column-drag.ts`
does. Each pass drives the pointer through 350 points 16 ms apart: along
the strip and back, out over the sidebar and back, then Escape. The
baseline is the same pass with no button held. It records each frame's
interval (`requestAnimationFrame`), the stand-in's own time per frame,
and what happened in the 400 ms before each frame over 50 ms. Three runs
per variant, at 1×, 4× and 6× (`Emulation.setCPUThrottlingRate`); the
summaries are `docs/findings/S153-drag-frames/runs.txt`.

**Limits.** The headless shell draws in software, with no GPU: layers,
shadows and overlap cost far more there than in a browser compositing on
its GPU, so conditions 2 and 3 are pessimistic. Running the probe with
`S153_CHROME=1` on a Mac measures the same with Chrome's GPU; the plan
can loosen them on that evidence. The host serves React's development
build, which does not matter here: the stand-in writes to the DOM and
renders nothing.
