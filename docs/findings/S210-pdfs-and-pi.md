# S210 — pi 0.87.1 carries text and images to a model, never a document, so a shared PDF is an opaque file

- **Status:** Answered
- **Led to:** ADR-0151

**Question.** Some providers read PDFs inline (Anthropic's `document`
block, for one). Can a shared PDF reach the model through pi, or is it an
opaque file the agent reads in its lane with `save_blob`?

**Kill criterion.** None: either answer is a plan. Its point is to take
the PDF branch out of the plan.

**Throw away.** Nothing ran; this was read from pi's built source.

## Answers

- **pi's content parts are text and images only.** In
  `@earendil-works/pi-ai` 0.87.1 (`dist/types.d.ts`), a `UserMessage`'s
  `content` is `string | (TextContent | ImageContent)[]`, and a tool
  result's `(TextContent | ImageContent)[]`. There is no document or file
  part.
- **An image part cannot smuggle one.** Anthropic's converter
  (`dist/api/anthropic-messages.js`, `convertContentBlocks`) writes every
  non-text part as `{ type: "image", source: { type: "base64",
  media_type: block.mimeType, … } }`. A PDF given as an `ImageContent`
  would be sent as an image of type `application/pdf`, which the API
  refuses. No provider module in the package mentions `application/pdf`.
- **A model that reads no images gets a placeholder** for each image part
  (`dist/api/transform-messages.js`: "(image omitted: model does not
  support images)"), decided by `model.input`. A shared image's fitted
  copy reaches such a model as that line; its quote of text does not
  depend on it.

**For the plan.** A PDF is opaque: stored, downloadable, described to the
model by name, kind and size, and read in the lane through `save_blob`.
Decision 3's "PDF: per spike 5" becomes "PDF: opaque". Passing PDFs to
models that take them would wait on pi carrying a document part, and is
not in this plan.
