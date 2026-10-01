# S66 — what closes a modal `<dialog>`, in Chromium and Firefox

Measured in a lane with Playwright 1.56: Chromium's headless shell (build
1194) and Firefox (build 1495). The person who asked uses Zen, a Firefox
browser. The probe opened a `<dialog>` with `showModal()` from inside a `<p>`
that clips (`overflow: hidden`, a `transform`), with focus on a button
beside it. The dialog held a 300 by 400 `<img>`, and the probe logged the
dialog's `click`, `cancel` and `close` events.

**Answers.** Both engines behaved the same on every step.

1. **The top layer escapes the clipping parent** (measured). The image was
   centred in the 1000 by 700 viewport (x 350, y 150) and not clipped.
2. **Escape closes it** (measured): `cancel`, then `close`, then
   `open === false`. Focus went back to the button that had it before.
3. **A click on the backdrop does not close it** (measured). It is a
   `click` whose `target` is the dialog itself, and the dialog stays open.
4. **A click on the image does not close it** (measured). It is a `click`
   whose `target` is the image.
5. **Focus moves to the dialog when it opens** (measured), since it holds
   nothing focusable.

6. **`closedby="any"` closes it on a backdrop click** (measured) in both
   Chromium 141 and Firefox 142, but not on a click on the image.

So a viewer gets Escape and the return of focus for free. It has to close on
a click itself. One `click` listener on the dialog sees clicks on both the
backdrop and the image, which makes `closedby` unnecessary.

**Not measured.** Safari, and Firefox before 142. A `<dialog>` inside a `<p>` is invalid HTML (a
`dialog` start tag closes an open `p`), and React warns about it, so a viewer
drawn from markdown goes through a portal.
