# S53: pasted images, pi's image path, and the model's seam

- **Status:** Answered
- **Led to:** ADR-0042, ADR-0051, ADR-0107

Pasting an image into a composer (ADR-0042) needs three things from pi: to
recognize an image from its bytes, to fit it to what a provider accepts, and a
place to add the image's bytes to what the model reads without storing them in
the session. These probes check each one in this install (pi 0.87.1, Node
24.21.0), and time what reading the bytes back costs.

**Answers.**

1. **Recognizing an image.** pi-coding-agent's `detectSupportedImageMimeType`
   (`dist/utils/mime.js`) reads magic bytes:

   | input | result |
   |---|---|
   | PNG, 3000×2000 | `image/png` |
   | PNG, 40×30 | `image/png` |
   | BMP, 40×30 | `image/bmp` |
   | SVG | null |
   | the first 200 bytes of a PNG | `image/png` |

   It also returns null for an animated PNG (read from the source, not run).
   It checks only the header, so a truncated file passes it: the resize is
   what refuses one.
2. **Resizing.** `resizeImage` (`dist/utils/image-resize.js`) with its
   defaults (2000×2000, 4.5 MB of base64):

   | input | output | time |
   |---|---|---|
   | noisy PNG 3000×2000, 17.7 MB | JPEG 2000×1333, 2.37 MB, `wasResized` | 1354 ms |
   | that JPEG again | JPEG 2000×1333, unchanged | 109 ms |
   | red PNG 40×30, 98 B | the same PNG, 98 B | 21 ms |
   | BMP 40×30 | the same BMP, `image/bmp` | 19 ms |
   | truncated PNG | null | 36 ms |

   It returns null both when Photon cannot decode the bytes and when nothing
   fits under the byte limit, so the caller cannot tell the two apart. A BMP
   comes back as a BMP: it is not converted. Nothing it returns has to be
   decoded again for its dimensions: `width` and `height` are in the result.
3. **The worker thread loads.** `resizeImage` starts
   `image-resize-worker.js` with `new URL(..., import.meta.url)`. Started by
   hand from `packages/pi` through pnpm's links, the worker reached `online`.
   So resizing runs off the host's event loop, and the in-process fallback is
   not what ran.
4. **`processImage` is not the right entry point.** It trusts the declared
   type (`normalizeSupportedImageMimeType` reads only the string), converts
   whatever else it can to PNG, and reports the new dimensions only as text in
   `hints`. `detectSupportedImageMimeType` followed by `resizeImage` gives the
   type from the bytes, and the dimensions as numbers.
5. **The seam.** `AgentHarnessOptions.toProviderMessages` defaults to
   `(messages) => convertToLlm(messages)` (`harness/runtime/harness.js`), and
   `execution/assistant.js` awaits it once per assistant request, on
   `requestContext.messages`. pi's compaction and branch summaries call
   `convertToLlm` directly (`compaction/compaction.js`,
   `compaction/branch-summarization.js`), not the seam: a summary request
   reads a chat's text, `![…](/blob/<sha>)` included, and not its images. The
   e2e suite confirms, with the scripted model, that a chat's images reach
   the request after its text (ADR-0042's check).
6. **Models without vision.** pi-ai's faux provider (the scripted model)
   declares `input: ["text", "image"]` and renders an image part as
   `[image:<mime>:<length>]` in its token count. For a model whose `input`
   lacks `"image"`, `api/transform-messages.js` replaces a user message's
   image with "(image omitted: model does not support images)".
7. **Reading bytes back costs little.** A `node:sqlite` table of 20 blobs of
   1,000,000 random bytes each: reading all 20 by key and base64-encoding
   them took 18 to 22 ms per pass, over 10 passes. A model request takes
   seconds, so the host reads the blobs again for every request, with no
   cache.

**How it was made.** A disposable script in `packages/pi` imported
`mime.js` and `image-resize.js` by file URL, as `deep.ts` does, and ran them
on images it wrote itself: PNGs from a minimal encoder (`zlib.deflateSync`
and hand-written chunks), and a BMP with a 54-byte header. A second script
started the worker by the URL `resizeImage` uses. The cost was timed in a
throwaway database under `/tmp`. The scripts were then deleted.
