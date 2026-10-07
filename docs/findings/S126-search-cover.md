# S126 — A layer over a column's body, its thread made `inert`, keeps the body's scroll and fires no resize; a positioned wrapper keeps every message's offset from the body

- **Status:** Answered
- **Led to:** ADR-0101

**Question.** A search draws each column's matches on a layer over its
thread, and leaves the thread mounted under it (ADR-0101). Does covering a
scrolled `overflow-y: auto` body with an absolutely positioned layer, and
setting `inert` on what it covers, keep the body's `scrollTop`, and fire
no `ResizeObserver` callback on the body or its content? What happens to
focus in a covered text box? The wrapper the layer is positioned in becomes
`position: relative`: does a message's `offsetTop` minus the body's, which
`placement` (`packages/interface/align.ts`, through `alignOnOpen` in
`packages/web/app.tsx`) and `placeOnReturn` measure, stay the same?

**Kill criterion.** If the scroll moves, a resize fires, or the offsets
change, the thread cannot stay under the layer unchanged, and the search
must restore each column on leaving instead.

**Throw away.** A page in Chromium's headless shell (Playwright 1.56): a
header and a `.column-below` wrapper holding `.column-under` (a body of 60
messages 30 px tall, scrolled to 500, and a textarea) and a hidden layer.

**Answers.**

1. **The scroll holds.** `scrollTop` was 500 while covered and 500 after
   uncovering.
2. **No resize fires.** A `ResizeObserver` on the body and its content saw
   no callback from covering to uncovering. Covering changes no box under it.
3. **Focus in a covered box is dropped.** Setting `inert` blurs the focused
   textarea (`blur` fires), `document.activeElement` becomes `<body>`, and
   the textarea cannot be focused while `inert`.
4. **The offsets hold.** A message's `offsetParent` moved from `#workspace`
   to the newly positioned wrapper, and its `offsetTop` minus the body's was
   900 before and after: both are measured against the same parent.
