# S93: a tool's image through pi, the session and the store

Numbered S59 until 2026-10-03, when two spikes held that number.

Before moving a `read`'s image out of the session (PLAN-2026-09-30-tool-images),
these probes check where pi writes a tool result's image, whether an image
processor in `read` gives a stored, resized image before any of those writes,
and what rejoining an image on every read of an entry would cost. pi 0.87.1,
Node 24.21.0.

**Answers.**

1. **An image processor in `read` runs before anything is written.**
   `createReadTool({ imageProcessor })` called it once, with the file's bytes
   and the sniffed type, before pi's first write of the result. A
   2400×1000 noise PNG of 7,203,263 bytes came back from `resizeImage` as a
   JPEG of 2000×833, 2,687,868 characters of base64, in 794 ms. So a
   processor can put the image in the blob store, and every later write can
   find it there by hash.
2. **pi writes the result twice, and the first write is a value.** In order:
   - `pi.pending.entry`, the finalized message, 2,688,369 bytes
     (`runtime/drive/tools.js`, `publishToolOutcome`);
   - pi reads it back once (`getValue`);
   - the `toolResult` entry, 2,688,392 bytes, and in the same commit the
     value's delete.

   Both carry the base64. S22 found that deleting a value does not remove it
   from Loro's history or from the store, so the pending value's copy stays
   until compaction, sent to every client that joins before then. Splitting
   the image out of the entry alone would still store the bytes once.
   `pi.pending.tool_output` held no image: `read` sends no partial results.
3. **The model is sent what the processor returned.** The stored content was
   `[{type:"text", text:"Read image file [image/jpeg]\n[Image: original
   2400x1000, displayed at 2000x833. Multiply coordinates by 1.20 to map to
   original image.]"}, {type:"image", data, mimeType:"image/jpeg"}]`: pi
   puts the processor's `hints` in the text part. The scripted model's next
   context held the text, then `[image image/jpeg <sha256>]`.
4. **pi rejoins every entry on the branch about twice a model request.** Each
   request scans the branch to the last compaction (`runtime/transcript.js`,
   `runtime/lane.js`), and `KynetaStorage.scanBranch` rejoins every entry on
   the path to the root before it applies `stopAtType`. Counted in
   `fromStoredRow`, over runs of 9 model requests each:

   | run | entries at its end | rejoins |
   |---|---|---|
   | 2 | 22 | 287 |
   | 3 | 40 | 647 |
   | 4 | 58 | 1007 |

   About 2 × the branch's length per request, all from `scanBranch`; one
   `getEntries` a request adds one more.
5. **Rejoining an image costs well under a millisecond.** From a `node:sqlite`
   table, reading a 2,015,901-byte blob and base64-encoding it took 0.65 ms,
   averaged over 50 runs. Decoding the same base64 and hashing it, which a
   commit would do to find the blob, took 1.08 ms. At two rejoins a request,
   twenty such images add about 26 ms to a request that takes seconds, so the
   rejoin needs no cache.
6. **What else in pi reads an image part** (source, not run). Compaction's
   estimate counts an image as 4,800 characters whatever its size
   (`estimateTextAndImageContentChars`, `compaction/compaction.js`). It and
   the summaries read entries through the same `scanBranch`, so they see the
   rejoined part.

**How it was made.** A disposable vitest file in `packages/pi` built an agent
with the scripted model and tools in a temporary directory holding the PNG,
with temporary hooks in `storage.ts` (`fromStoredRow`, `#applyCommit`,
`getValue`) and `agent.ts` (the read tool's options). One run read the PNG;
three more made 8 `read`s of a text file each. The cost in answer 5 came from
a separate script against an in-memory `node:sqlite` table. The hooks and
both scripts were then removed.

## Addendum: after ADR-0051

The same 2400×1000 noise PNG, read through `createAgent` with a store, as
`PLAN-2026-09-30-tool-images` built it:

| what pi wrote | before | after |
|---|---|---|
| the `toolResult` entry | 2,688,392 bytes | 455 bytes of `payload` |
| `pi.pending.entry`, its largest value | 2,688,369 bytes | 577 bytes |
| the blob store | nothing | a 2000×833 JPEG, 2,015,680 bytes |

The scripted model's next context still ended with the image's
`[image image/jpeg <sha256>]`: the rejoin gave pi the bytes. Measured with a
disposable vitest file in `packages/pi`, since removed, watching the
document's values on every change.
