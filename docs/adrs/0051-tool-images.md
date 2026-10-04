# ADR-0051 — A tool's image is a blob; what pi stores holds its reference, and the rejoin restores its bytes

**Status:** Accepted. Evidence: S93. Implementation:
`PLAN-2026-09-30-tool-images`. Extends ADR-0042, whose "Other images are
unchanged here" left tool results for later. Amends ADR-0015 (a message's
image parts in `payload` are references) and ADR-0049 (a row whose result has
an image opens capped, and draws the image in place of its text).

**Context.** A `read` of an image showed only its caption, "Read image file
[image/png]". pi's `read` returns the image as a base64 part, and
`KynetaStorage` stored it inline. pi writes a tool result twice (S93): first
as a `pi.pending.entry` value, then as the entry. Both held the bytes, and a
deleted value stays in the history until compaction (S22). So every client
that joined received each image twice, compaction rewrote the entry's copy,
and the model was sent the file unresized. Core kept only text parts, so the
image was never drawn.

**Decision.**
- **`read` stores the image before pi writes it.** `createAgent` builds
  `read` with an image processor (`readImageProcessor`,
  `packages/pi/images.ts`) that fits the image with `prepareImage`, as a
  pasted image is fitted, puts it in the blob store, and returns it to pi.
  After a resize, pi's own note of the original size and scale goes to the
  model with the caption. An image the store does not keep (BMP, SVG) or
  cannot read is omitted, with a line saying why. The processor runs before
  pi writes anything (S93), and awaiting is allowed there, where
  `KynetaStorage`'s commit is synchronous.
- **What pi stores holds a reference.** When pi commits a message entry or a
  `pi.pending.entry` value, each image part whose blob the store has, found
  by the SHA-256 of its bytes, is stored as `{type: "image", mimeType,
  sha256, width, height}`. One the store lacks stays inline: only `read`
  writes image parts in this harness, so that is an image written without a
  store, as conformance runs.
- **The rejoin restores the bytes,** so pi reads exactly what it wrote, and
  its compaction and summaries, which read entries without the
  `toProviderMessages` seam, see the image. A blob no longer stored rejoins
  as ADR-0042's "[image <sha256> is no longer stored]". There is no cache:
  pi rejoins each entry on a branch about twice a model request, and a rejoin
  of a 2 MB image costs 0.65 ms (S93).
- **A reader sees the reference.** `messageImages` (core) admits a stored
  reference, never an inline part, and a tool call's result carries its
  images. The sweep counts them, so a tool's image lives as long as an entry
  shows it.
- **The row draws it.** A result with an image opens its row capped, when it
  arrives and on every mount after (`rowSize`'s `shows`), and draws the
  image in place of the caption (`toolBody`). The caption and any resize note
  are the image's `title`, its path its `alt`. A capped row caps the image at
  10rem tall; a click on the summary shows it whole, and only the reader
  closes it, as ADR-0049 says of every row.

**Consequences.**
- A `read` of an image stores its bytes once, in the blob store, and the
  session only the reference. The model gets the image fitted to 2000×2000
  and 4.5 MB of base64 where it got the whole file.
- A row with an image grows its column when the result arrives. The image's
  stored size gives its box before the bytes load, so the column grows once.
- Images read before this are inline in their sessions. They are not drawn,
  and their row shows the caption: no migration.
- A BMP is no longer sent to the model as pi's "configure an
  imageProcessor" line, but as this processor's omission: pi's conversion of
  other types to PNG is not used.

**Alternatives rejected.**
- Drawing the inline base64 as it was: two small changes, but the bytes stay
  in the document twice, and the model still gets the whole file.
- Splitting the entry alone: the pending value put the bytes in the history
  until compaction (S93).
- The reference in what pi reads, with the bytes added in
  `toProviderMessages`, as a chat's are: pi would hold image parts without
  `data`, its compaction reads entries without the seam, and conformance
  would no longer read back what it wrote.
- Measuring an image at commit with a synchronous header reader: needed only
  if the image were not stored before pi wrote it.
- pi's `processImage` as the processor: it trusts the declared type (S53).
- A cache of rejoined images: 0.65 ms a rejoin does not need one, and
  ADR-0042 turned one down at similar numbers.
- The caption above the image: it says only that an image was read.
- A closed row that draws the image once opened: the image is what a reader
  of a `read` wants to see.
