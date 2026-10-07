# ADR-0042 — A pasted image is a blob; a message holds its reference, and the model reads the bytes when its context is built

**Status:** Accepted. Evidence: S53. Implementation:
`PLAN-2026-09-29-pasted-images`. Amends ADR-0022 (admission checks where a
request comes from) and ADR-0023 (image bytes are never part of the
compacted document). Extended by ADR-0051: a tool's images are blobs too.
Amended by ADR-0098: a person's picture is a blob, and the
sweep counts it as a reference.

**Context.** A person cannot show the agent or a collaborator an image: a
screenshot, a mockup, an error dialog. The session document is replicated
to every client and rewritten whole at every compaction (ADR-0023), so bytes
stored in it are paid for again by every compaction and every client that
joins, and a message's text would hold megabytes of base64. An upload is
also the host's first HTTP endpoint that writes, and admission as it stood
checked only the invite key, which loopback does not have.

**Decision.**
- **Pasting uploads, and the text refers.** Pasting an image into a composer
  sends it to `POST /blob`, and inserts `![name](/blob/<sha256>)` at the
  cursor. The markdown reference is the attachment: the text says where the
  image goes, and editing the text removes it.
- **Blobs are a table beside Kyneta's.** `pinetrie_blobs` sits in the host's
  SQLite file, on the store's own connection (S47: the store owns its file):
  one file to back up, keyed by the SHA-256 of the stored bytes, so a write
  is idempotent. Each row keeps the image's type, width and height, so a
  reference is read without its bytes. A host without a file keeps blobs in
  memory. `GET /blob/<sha256>` serves one, immutable, with `nosniff` and a
  `default-src 'none'` policy.
- **Recognized and resized once, at upload,** by pi's
  `detectSupportedImageMimeType` and `resizeImage` (S53): the type comes from
  the bytes, never the request, and the image is fitted to 2000×2000 and
  4.5 MB of base64, what Anthropic accepts. PNG, JPEG, GIF and WebP are
  kept; anything else is refused. The model is not told the original
  dimensions, as pi's `read` does: a pasted image's original is never kept,
  so there is nothing to map coordinates back to.
- **A message holds references; the model reads bytes.** A chat's
  `details.images` lists `{sha256, mimeType, width, height}` for each
  `/blob/` image its text shows, in order, found by the host when the
  message is sent. `content` stays the attributed text. pi's
  `toProviderMessages` seam adds each chat's images after its text, read
  from the store for every request (S53 item 7: 20 MB in about 20 ms). The
  stored payload, the outbox, and pi's Storage conformance are unchanged, and
  compaction rewrites no image. The cost: pi's context estimate and its
  compaction summaries read the stored message, so they see a chat's text
  and not its images (S53 item 5), and a context of many screenshots
  compacts later than its size warrants.
- **A missing blob refuses the send** (`image_missing`), and the message
  returns to its composer. A blob gone after its message was sent reaches
  the model as "[image <sha256> is no longer stored]".
- **Unreferenced blobs are deleted** at compaction, once untouched for 24
  hours. The references are read where they live: every chat, every held
  message, and the text of every note, including notes the host has not
  loaded, since a draft can be seeded from a composer's text. The grace
  period covers an image uploaded and not yet sent, which no document holds.
- **Admission checks where a request comes from.** A request or upgrade
  whose `Origin` names another host than its `Host` is refused, key or no
  key; on a loopback bind, so is a `Host` that is not a loopback name or
  address. Before this, any page open in the person's browser could open the
  loopback host's WebSocket, the command channel included, and a name
  rebound to 127.0.0.1 reached it as its own origin. A request with no
  `Origin` (a Node client, a navigation) is admitted as before.
- **Other images are unchanged here.** Tool results' images, workspace paths
  and remote images are later work, which extends this decision.

**Alternatives rejected.**
- Image parts stored in the chat's `content`: `KynetaStorage` would have to
  split the bytes out of each payload and rejoin them, and `drain` would need
  them too. The split is still needed for tool results, which pi writes.
- `processImage`: it trusts the declared type and reports dimensions only as
  text (S53 item 4).
- Our own magic-byte and header readers: pi has both, and every image passes
  through its resize.
- Inline `data:` URLs: megabytes in the document and the composer.
- Attachments sent beside the text: the text would no longer say where an
  image goes, and a draft, a Yjs text, would need a second channel.
- Uploading over the Line: base64 in a command, through the document layer.
- A cache of base64 in the seam: up to 16 images would hold about 72 MB, to
  save about 20 ms a request.
- An `Origin` check on the upload alone: the WebSocket, which carries every
  command, would stay open to other pages on loopback.
- Reference counting: the references live in chats, the outbox and Yjs
  texts; a sweep reads them where they are.
