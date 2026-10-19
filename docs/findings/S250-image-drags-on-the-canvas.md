# S250 — Can a canvas take an image dragged in from the desktop or out of a thread?

- **Status:** Answered
- **Led to:** ADR-0182

**Question.** A media column (ADR-0116's media card, images only) is made
four ways: a file dropped on the canvas, an image dragged out of a thread,
put from the pane, or put by the agent. The first two rest on the page's
two drag systems, which ADR-0134 keeps apart: the browser's own drag and
drop for a file from the desktop (`packages/web/file-drop.ts`, its one
door), and the pointer engine for everything that starts in the page
(`packages/web/use-drag.ts`). In Chromium, through its own drag machinery
(CDP `Input.dispatchDragEvent`, as a drop from the desktop arrives, and
Playwright's intercepted mouse drag for one that starts in the page):

1. Where on the strip does a file drag land today: between columns, past
   the last, on a column's header, its body, an image in it, the composer?
   Which take it, which does the window's guard refuse, and does any
   `dragover` there carry the point the page would need to place a
   landing?
2. Does the pointer engine see anything during a file drag (pointer
   events, `data-card-drag`)? Can the two be told apart?
3. Pressing on an `<img>` in a thread's message and moving: does the
   browser start its own drag, what does it carry (`Files`?), and where
   does it drop today (a composer that takes files)?
4. Pressing on an `<img>` inside a drag handle (the thread's icon in its
   header): does the engine's prevented `dragstart` hold, so the pointer
   engine drags instead?

**Kill criterion.** A file drag over the strip that cannot be told where
it is (no point on `dragover`, or events that reach no element under the
pointer), or an image in a message whose browser drag cannot be prevented
in favour of the pointer engine, would leave a drop onto the canvas or a
drag out of a thread without a design on today's two systems.

**Throw away.** The probe (`probe.ts`), and the host and browser it starts.

**Answers.**

1. **Every place on the strip gets the file drag, with its point, and
   only a card takes it today.** A file dragged in from the desktop
   reached the element under the pointer at each of the eight places
   tried. Each `dragover` carried the point it was sent at. Only the
   composer (its card's `fileDropProps`) cancelled it. At every other
   place, the window's guard did, and it set `dropEffect` to `none`, so
   Chromium fired no `drop`: the page stayed on its URL, and nothing was
   uploaded. **There is no gap between columns to hit:** the canvas
   column ended at x 324 and the thread began there, and a point "between"
   them hit the thread's body. Past the last column, the target was still
   inside `#strip`. So a canvas that takes a file places it as a column's
   reorder does, from the point's x against the columns' centres
   (`pointerGap`, `packages/interface/reorder.ts`). A handler on `#strip`,
   below the cards that take files, covers every point.
2. **The pointer engine saw nothing.** No pointer event fired during
   any file drag, and no `data-card-drag`, `data-dragging` or
   `data-drop-mark` was written. The two are told apart by the event
   alone. A file drag is HTML drag and drop, with `Files` among
   `dataTransfer.types` from `dragenter` on. A drag that starts in the page
   is pointer events.
3. **An image in a message starts the browser's own drag.** At
   `dragstart` it carried `text/uri-list`, `text/html` and `Files`. The
   pointer was cancelled (`pointercancel`) after two moves, so the pointer
   engine would lose it. Dropped on the composer, it fired `drop` there.
   Playwright's interception passed only the two text types to the
   target, so whether a real drag would hand the composer the image as a
   file, and upload a copy, was not measured. **With the image's
   `dragstart` prevented,** the pointer events went on: 15 moves and the
   `pointerup` over the composer, with no `pointercancel`. The release
   was away from the press, so it opened no pane.
4. **An image inside a handle drags its column.** Pressing on the
   thread's icon in its header (`/noun-icons/…`, inside `data-drag-card`)
   and moving fired no `dragstart`. The engine marked the column
   `data-dragging`, the body `data-card-drag` and the strip
   `data-reordering`, and Escape sprang all three back.

The kill criterion is not met. A drop onto the canvas needs one HTML
drop handler on the strip, which places by `pointerGap` and is drawn
with the pointer engine's marks. A drag out of a thread needs the
image to be a handle of its own, whose browser drag is prevented as
every handle's already is.

**Not measured.**

- A real desktop drag. CDP's `Input.dispatchDragEvent` goes through
  Chromium's drag machinery, but no OS drag session, and the probe sent
  its own `dragover`s, so their rate in a real drag is not known here.
  The HTML standard fires one every 350 ms (±200 ms) while the pointer is
  still, and one on each move.
- Safari and Firefox.

**Sources.** `S250-image-drags-on-the-canvas/probe.ts`, run against a
suite host with a scripted model in Chromium's headless shell at
1440×720; `output.json`, everything it recorded.
