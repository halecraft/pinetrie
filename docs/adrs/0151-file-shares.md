# ADR-0151 — A file dropped, pasted or chosen in a card box is shared in the conversation, as a blob its message links; an agent saves one into its own lane with `save_blob`

- **Status:** Accepted (Duane, 2026-10-15)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/web/TECHNICAL.md`,
  `packages/pi/TECHNICAL.md`, `packages/rules/TECHNICAL.md`,
  `docs/06-interface.md`
- **Evidence:** S206, S207, S208, S209, S210, S211, S212, S213
- **Amends:**
  - ADR-0042: a pasted image is one share among any files; the blob is the
    image as it came, and the model reads its fitted copy.
  - ADR-0126: the blobs hold any file, sorted by their bytes into images, text
    and opaque files; a reference's quote is a text blob like any other.

**Context.**

- A person dragging a file into the box where they talk with people and
  agents means to share it: everyone who reads the message should see it,
  point at it and read it. Until now a box took pasted images only, and
  dropping a file on the page opened it in the tab.
- Agents work in lanes. A shared file is often needed as a file there (a
  CSV to run a script on, an asset to commit), but who sees a share must
  follow the conversation, not reach every lane of the project.
- The blob store took four image types and markdown, refusing anything
  else by its declared type, and kept only an image's fitted copy.

**Decision.**

- **Sharing is a link in the text.** A file dropped on a card, pasted into
  its box, or chosen with its "share a file" button is uploaded to `POST
  /blob`, and goes in as `![name](/blob/<sha>)` for an image or
  `[name](/blob/<sha>)` for anything else (`shareMarkdown`, the one
  writer; `textBlobs`, the one reader). Every writable card box takes them:
  the composer, a queued, note or pinned card's box, and the new note box.
  A share goes in at the box's selection while it has focus, else at the
  end of its text, at a place in the card's text that others' edits move
  with (S209, S212).
- **Any file is accepted;** only size refuses. Its kind comes from its
  bytes, never the browser's type: an image pi can read and fit, UTF-8 text
  with no NUL, or opaque (S210: a PDF is opaque, since pi carries no
  document part). An image keeps its original; its fitted copy, when it
  differs, is recorded against it, and is what the column draws inline and
  the model reads, after a line naming the original's size (S211).
- **A sent message holds its shares** (`ChatDetails.shared`, beside
  `images`): each one's name, original, size, the copy shown, and whether
  its bytes hold a location (S213), which its chip warns of. A text file up
  to `shares.quoteBytes` (32 KiB by default) is quoted for the model under
  the message, fenced; anything larger, or opaque, is described with a
  pointer to `save_blob`.
- **Every blob is served with `nosniff` and CSP `sandbox`;** text as plain
  text, an opaque file as a download its chip names (S208).
- **`save_blob(blob, path)`** writes a blob some message on the thread's
  path showed its model into the agent's own lane, through the tool's
  environment, so the write is the agent's (S206, S207). Nothing is copied
  into any lane when a message is sent.

**Consequences.**

- The model reads a shared text file without a tool call; a large or
  binary one costs one `save_blob` and the agent's own tools.
- The sweep keeps every share's original and fitted copy, and a draft's
  links, as it kept images.
- A text file is quoted as sent, and replayed with the message each turn:
  `shares.quoteBytes` bounds that.
- Formats pi cannot decode (HEIC, TIFF, AVIF) are chips without a preview.

**Alternatives rejected.**

- **A drop box folder in the project's `pinetrie.json`**, into which the
  host copies every share: a shared directory reaches every thread's lane
  and the person's working copy, widening a share past its conversation.
- **Copying every share into the lane when its message is sent:** a lane
  that does not exist yet has nowhere to take it, and most shares are
  never needed as files.
- **A list of accepted types:** browsers declare types badly (`.ts` as
  `video/mp2t`, many files as none), and `save_blob` makes any file
  useful; the kind decides how a file is shown, not whether it is shared.
- **Keeping only the fitted copy of an image:** an asset or a test
  fixture saved into a lane would not be the file dropped.
- **Placing a share under the pointer:** a textarea gives no offset for a
  point beyond its first line (S209).
