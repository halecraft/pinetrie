# S209 — A handler on the card's frame gets a file dropped anywhere on the card, textarea included; the drop point cannot be read as an offset in a textarea, so a share goes in at the selection

- **Status:** Answered
- **Led to:** ADR-0151

**Question.** A file dropped on a card box should become a share in its
text.

1. What does Chromium do with a file dropped on a textarea, or on the
   page, that nothing handles?
2. Does a `drop` handler on the card's frame receive a drop on the
   textarea inside it, with the files?
3. Can the drop's point be turned into an offset in the textarea's text,
   so the share lands under the pointer?
4. Where is the textarea's selection when the drop arrives?

**Kill criterion.** A handler outside the textarea cannot receive its
drops, or the files are not readable on `drop`.

**Throw away.** `sandbox/s201-drop/probe.ts` and `sandbox/s201-drop/caret.ts`:
a page of textareas and a card, driven by Playwright's headless Chromium
141.0.7390.37. Drops were sent through CDP's `Input.dispatchDragEvent`
with real files (`dragEnter`, `dragOver`, `drop`), which the browser takes
as an OS drag: trusted events, files in `dataTransfer`.

## Answers

1. **The textarea is left as it was** for a PNG and for a text file: no
   path or contents are typed in. The headless shell did not open the file
   in the tab either, but it has no browser window to navigate, so this
   says nothing of headed Chrome. MDN's "File drag and drop" says a page
   must cancel `dragover` and `drop` to keep the browser from opening the
   file. A page-wide guard costs one listener for each, so the plan has
   it without measuring headed Chrome.
2. **Yes.** With `dragover` cancelled when `dataTransfer.types` includes
   `"Files"` and a `drop` listener on the card, drops on the card's head
   and on its textarea (`target` the textarea) both arrived with their
   files. Two files dropped at once arrived in order, each with its name,
   type and size (`s201-red.png:image/png:70`, `s201-notes.txt:text/plain:5`).
   During `dragover` only `types` is readable (`["Files"]`), as the picture
   field already relies on.
3. **No.** `document.caretPositionFromPoint` returns the textarea and an
   offset, but compared with a real click at the same points it agrees
   only on the first line: (70, 40) gave 9 against a click's 26, (150, 40)
   16 against 33, and points on wrapped lines 63 against 97.
   `caretRangeFromPoint` returns the `BODY`, not the textarea. A mirror
   element measuring the textarea's layout could compute it, at the cost
   of code that tracks fonts, padding, wrapping and scroll.
4. **Where it was.** A drop does not move the textarea's selection
   (`[3, 3]` before and after). A textarea never focused reports `[0, 0]`.

**For the plan.**
- `file-drop.ts` holds the page-wide guard (`dragover` and `drop` on the
  window cancelled when `types` include `"Files"`), whether a drag brings
  files, and a drop's files. The card's frame takes the drop for its box.
- A share goes in at the box's selection when the box has focus, and at
  the end of its text when it does not, never at offset 0 of a box no one
  has typed in. The upload then inserts there, as a paste does.
