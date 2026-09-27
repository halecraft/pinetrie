# S33 — picking a message from the rail, and whether it lands in view

**Answers.**
1. **Picking a message a column already shows did nothing** (measured). The
   column was at its end, 2,453 px below the picked message, and stayed there.
   `openAt` stored the id in a ref and dispatched `show` for the tab it was
   already on. The layout reducer returns the same state for that, so React
   did not render, and the effect that would have scrolled never ran.
2. **Picking a message no column shows opened a column that did not show it**
   (measured). The new column opened beside the first and was aligned to its
   fork point, at the top of the thread. The picked message, the 26th of 32,
   was 2,207 px below its viewport. An earlier message, the 6th, happened to
   land in view at 401 px of a 436 px viewport.
3. **The Archive preview's pick did not scroll either** (measured): the column
   re-anchored and stayed at its end, 2,163 px below the message.
4. **An agent message that only called tools is drawn as `.msg[data-entry]`**
   (measured: 32 of 32 messages, 30 of them tool-only steps).
5. **With a reveal that scrolls at once when the message is drawn, and after
   the next render otherwise, all three cases land in view** (measured: 106,
   181 and 184 px from the top of a 440 px viewport), and stay there after a
   second.
6. **`PLACED` is what keeps a revealed column there.** With the reveal but no
   `PLACED`, the preview jumped back to its end. A column at its end is
   following, and the new path's content resized it after the scroll, so it
   followed. A newly opened column scrolled down from 0 held only because
   nothing resized it afterwards. Scrolling down is not the reader leaving
   (`follow.ts`), so the next resize, a window's included, would have taken
   it to its end.

## Why it was asked

PLAN-2026-09-27-rail-runs draws a stretch of messages as one capsule, and
clicking the capsule opens its first message. That is only useful if a pick
lands in view. The plan assumed the `scroll` case worked. Answer 1 shows it
stopped working when tabs came (ADR-0029), since a pick on the tab you are on
changes no state.

## What it changed

`useReveal` (`packages/client/use-reveal.ts`) replaced the `scrollTo` ref and
its effect. It scrolls at once if the message is drawn, and otherwise after
the render the pick causes, and dispatches `PLACED` on the column body in
both cases.

## Not tested

- A pick into another root's tab. It is the same code path as answer 2, after
  the tab switch renders.
- Firefox and Safari.

## Method

`sandbox/s33-picking-from-the-rail/probe.ts`, copied into `apps/pineta/e2e/`
to run and deleted afterwards. It drives Chromium through the Playwright
server against a scripted host with tools. It writes a thread of 32 messages
(a person's, 30 steps that each call `read`, and a reply), then picks from the
rail in each case, and reads the message's rectangle against its column
body's 100 ms and 1.1 s later. For 2 it branches from the first message,
sends there, and closes the loop's column. For 6 it replaced the `PLACED`
dispatch with a no-op and ran again.
