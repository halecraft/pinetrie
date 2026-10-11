# S154 — Can a short press start a pointer drag on iOS Safari, while a swipe still scrolls the strip and the column?

- **Status:** Open (deferred 2026-10-11: no iPhone at hand)

**Question.** ADR-0134 starts a touch drag with a short press, so that a
swipe still scrolls. On iOS Safari, with a column header that has
`touch-action` left as `auto` (so a swipe scrolls):
1. Is a press held still for 300 ms, then moved, delivered as a drag: the
   page gets every `touchmove` and `pointermove`, and the strip does not
   scroll, once a non-passive `touchmove` listener calls
   `preventDefault()` after the hold?
2. Does a swipe that moves before 300 ms still scroll the strip
   horizontally and the column vertically, with no drag?
3. Does the hold raise Safari's callout, its text selection or its
   magnifier, and do `-webkit-touch-callout: none` and
   `user-select: none` on the header stop them?
4. Does `setPointerCapture` on the header keep the moves coming once the
   finger leaves it, or does Safari send `pointercancel`?

**Kill criterion.** If a held press cannot stop the scroll that follows it
(question 1), or stopping it also stops a swipe (question 2), ADR-0134's
touch drag is not viable as described: a touch drag would then need a
handle of its own with `touch-action: none`.

**Throw away.** The probe page: a strip of columns with headers, a log of
the events each gesture delivers, and its answers on the page.

**The probe.** `docs/findings/S154-touch-drag/probe.html`, one page with
no dependencies. A press on a header held 300 ms without moving 8 px arms
a drag: the header turns blue, takes pointer capture (unless unticked),
and a non-passive `touchmove` listener on the document calls
`preventDefault()` from then on. A move past 8 px before that is a swipe,
left to the browser. For each gesture the page logs the pointer and touch
moves it got, how many `touchmove`s were cancelable and prevented, whether
the strip or a column scrolled during the drag and in the 600 ms after,
any `pointercancel`, lost capture, `contextmenu` and selection. Its
checkboxes turn off `-webkit-touch-callout: none` with `user-select:
none` on the headers, and the capture. Five steps on the page cover the
four questions; **copy results** puts the log on the clipboard.

**Run so far: Chromium's headless shell (141) with touch emulated**, not
an answer for iOS. A held press then a drag delivered 20 of 20
`pointermove`s and `touchmove`s, every `touchmove` cancelable and
prevented, nothing scrolled, capture held and never lost. A swipe got
`pointercancel` after 2 moves and scrolled the strip. The page's logic
works; Safari's answer needs the device. To run it there, serve the page
from a Mac (`python3 -m http.server` in its folder) and open it on the
iPhone over the same Wi-Fi.
