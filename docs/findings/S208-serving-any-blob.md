# S208 — Any blob is safe to serve from the host's origin with `nosniff` and `Content-Security-Policy: sandbox`; opaque bytes download under the chip's own name

- **Status:** Answered
- **Led to:** ADR-0151

**Question.** `GET /blob/<sha>` serves from the page's own origin, which
holds the session's cookie. Once any file can be shared:

1. Which headers keep an HTML or SVG file from running script, opened
   directly or drawn by the page?
2. Does an opaque file download, and under what name, when the blob has
   none (the name lives in the link's text)?
3. Can an SVG still be drawn as a picture safely?

**Kill criterion.** Some kind of file runs script on the host's origin
under every header set tried, so blobs need an origin of their own.

**Throw away.** `sandbox/s200-serving/probe.ts`: a Node server answering
one body under each header set, driven by Playwright's headless Chromium
1194 (Playwright 1.56). Each case was opened top-level; a script in the
body sets `document.title` to `RAN`.

## Answers

| served as | opened top-level |
|---|---|
| HTML as `text/html` (control) | script **ran** |
| SVG as `image/svg+xml` (control) | script **ran** |
| HTML as `text/html`, `Content-Security-Policy: sandbox` | drawn, script blocked |
| SVG as `image/svg+xml`, `nosniff`, CSP `sandbox` | drawn, script blocked |
| HTML as `text/plain; charset=utf-8`, with or without `nosniff` | shown as source text |
| HTML as `application/octet-stream`, inline or `attachment` | downloaded |

1. **CSP `sandbox` blocks script even in a document Chromium draws**, and
   `text/plain` is never drawn as HTML. The controls ran, so the probe
   could see script run.
2. **`application/octet-stream` downloads**, with or without
   `Content-Disposition: attachment`. An `<a download="logs.zip">` to a
   blob served as `attachment` with no filename saved as `logs.zip`: the
   chip names the file, and the host never needs to know the name.
3. **Yes, in `<img>`:** an SVG served as `image/svg+xml` with `nosniff` and
   CSP `sandbox` drew at its size (`naturalWidth` 10), and opened top-level
   its script was blocked. Served as `text/plain` with `nosniff`, `<img>`
   drew nothing (`naturalWidth` 0).

**Before this.** `blobResponse` (`apps/pinetrie/host/responses.ts`) sent
the stored type with `nosniff` and `content-security-policy: default-src
'none'` (its `IMMUTABLE` headers, shared with offers' reads), which already
blocks script in a drawn document; it served only images and markdown.

**For the plan.**
- Every blob response carries `x-content-type-options: nosniff` and
  `content-security-policy: sandbox`, in the base that `blobResponse`'s
  per-kind record extends: an image's type (one of `IMAGE_MIMES`, from its
  bytes), text as `text/plain; charset=utf-8`, opaque as
  `application/octet-stream` with `content-disposition: attachment`.
- The chip's link carries `download="<name>"`; the pane fetches a text
  blob and draws it as text.
- An SVG is UTF-8 text, so it is a text blob: shown as code, quoted to the
  model. Drawing it as a picture would be a kind of its own served as
  `image/svg+xml` under the same base; it is not in this plan.
