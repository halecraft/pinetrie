# S211 — pi's resize returns an image that fits byte for byte; one it must shrink comes back without EXIF and, from a GIF, as a single PNG frame; its size note never reaches the model

- **Status:** Answered
- **Led to:** ADR-0151

**Question.** `POST /blob` fits every image with `prepareImage`
(`packages/pi/images.ts`), which calls pi's `resizeImage`. With originals
kept and a fitted copy made only when needed:

1. Is an image that already fits returned unchanged, metadata and
   animation included?
2. When it must shrink, does the copy keep EXIF, and does a GIF stay
   animated?
3. Does pi's note of the original size reach the model through
   `POST /blob`?

**Kill criterion.** None: the answers set what the fitted copy is and what
the model is told. Its point is to take these beliefs out of the plan.

**Throw away.** `sandbox/s203-resize/probe.ts`, which built a JPEG of grey
noise with pi's Photon and spliced an APP1 `Exif` segment into it, and a
two-frame GIF89a with a `NETSCAPE2.0` loop, then ran `prepareImage` on each.

## Answers

| input | out | bytes unchanged | EXIF | frames | pi's note |
|---|---|---|---|---|---|
| JPEG 300×200 with EXIF, fits | JPEG 300×200 | yes | kept | n/a | none |
| JPEG 2400×1200 with EXIF | JPEG 2000×1000 | no | **dropped** | n/a | "original 2400x1200, displayed at 2000x1000. Multiply coordinates by 1.20…" |
| GIF 300×20, 2 frames, fits | GIF 300×20 | yes | none | 2 | none |
| GIF 2400×20, 2 frames | **PNG** 2000×17 | no | none | **1** | "original 2400x20, displayed at 2000x17…" |

1. **Yes.** `resizeImageInProcess` (`pi-coding-agent`'s
   `dist/utils/image-resize-core.js`) returns the input's own bytes when
   it fits 2000×2000 and 4.5 MB of base64. Its width and height are read
   after EXIF orientation is applied; the bytes still carry the tag, which
   browsers honour.
2. **No to both.** Otherwise Photon decodes the first frame, resizes it
   and encodes PNG and JPEG candidates afresh, keeping the smaller under
   the limit: no metadata survives, and a GIF becomes one PNG frame.
3. **No.** `prepareImage` returns the note as `resized`, but
   `receiveBlob` (`apps/pinetrie/host/http.ts`) stores only the image, and
   a chat's image parts (`withChatImages`, `packages/rules/chat.ts`) carry no
   text. A model given an upload's fitted copy is not told it was scaled.

**For the plan.**
- An image share's `original` is the upload's bytes as they came; `shown`
  is `prepareImage`'s result, the same blob when it fits. A fitted copy
  carries no location, so only the original needs the warning.
- An animated GIF too large to fit is shown and read as its first frame;
  the original keeps its animation for the pane, a download and
  `save_blob`.
- When `shown` is not the original, the model's image part is preceded by
  a line naming the original's size and the scale, from the two refs'
  sizes: words of pine·trie's own, in one function beside the quote's
  labels, since `@pinetrie/rules` does not import pi.
