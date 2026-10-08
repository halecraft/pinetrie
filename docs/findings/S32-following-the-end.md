# S32 — following a column's end, and the browser's order within a frame

- **Status:** Answered
- **Led to:** ADR-0054, ADR-0077

**Answers.**
1. **A column did not follow a reply being written** (measured). With a
   scripted reply of 40 paragraphs at 60 tokens/s, the gap between the
   column's end and the bottom of its viewport, sampled every 150 ms, went
   0 … 0 60 90 151 … 882 912 px. It closed only when the message committed.
   The follow effect ran on `view.nodes.length` and `view.tipId`, and a
   streaming reply changes neither.
2. **Within a rendering step, Chromium dispatches scroll events, then runs
   `requestAnimationFrame` callbacks, then ResizeObserver callbacks**
   (measured). The logged sequence was `scroll raf ro`, repeated for every
   step. No scroll event came between a step's `raf` and its `ro`. That is the
   order in HTML's "update the rendering".
3. **A ResizeObserver delivers at most once per frame**, however many times
   the content grew in it (measured: 60 growths, 4 ms apart, gave at most one
   callback per frame). A follow in its callback therefore scrolls once per
   frame.
4. **Setting `scrollTop` to its current value dispatches no scroll event**
   (measured: 0 events).
5. **A 10 px wheel up during growth is seen before the next follow** (measured).
   With content growing every 5 ms, and a ResizeObserver scrolling to the end
   unless released, `mouse.wheel(0, -10)` produced a scroll event at 3548
   against a last position of 3558. The rule "a scroll event above where the
   scroller was last left is the reader leaving" released it, and it held
   still from then on. So the rule needs no wheel, key or touch listeners:
   the reader's scroll reaches the page before a follow can override it.
6. **A zero-height `position: sticky; bottom: 0` slot at the end of a scroller
   adds nothing to its `scrollHeight`** (measured: +0 px), with an absolutely
   placed button inside it.

## Why it was asked

PLAN-2026-09-27-follow-the-end makes a column follow its end by watching its
size with a ResizeObserver, and releases it when a scroll event shows the
reader moved up. That works only if the reader's scroll is reported before the
column's next follow can undo it (2, 5), and only if the column can tell its
own follow's echo from the reader (4). The ↓ new below button must not change
the height it is measured against (6).

## Not tested

- Firefox and Safari. The order in 2 is the HTML standard's, but only
  Chromium 141 was measured.
- Touch and momentum scrolling, and dragging the scrollbar. Each reaches the
  page as scroll events. None was driven.
- Browser zoom, where `scrollTop` can be fractional. The rule allows 1 px.

## Method

`sandbox/s32-following-the-end/probe.ts`, copied into `apps/pinetrie/e2e/` to
run (the workspace resolves `@pinetrie/*` only from a package that declares
them) and deleted afterwards. It drives Chromium through the Playwright
server.
- For 1, it uses the app on a scripted host.
- For 2 to 6, it uses a bare 300 px scroller set with `page.setContent`: a
  `requestAnimationFrame` loop, a ResizeObserver on the content, and a scroll
  listener, each logging in order.
