# S35 — why an agent's column jumps while it works

**Status:** Answered. With S55, led to ADR-0044.

**Answers.**
1. **Each tool call changes the column's height five or six times, and each
   shrink moves everything down.** A column following its end sits at the
   bottom, so when the content gets shorter the browser clamps `scrollTop` and
   every message slides down. When it grows again, `useFollow` scrolls to the
   end and everything slides back up. Measured at 20× CPU throttle, one
   `bash` call went 1182 → 1256 → 1209 → 1182 → 1272 px: the live panel
   opens, the live panel closes while a `⑂ 0 messages` chip appears, the
   chip goes as the row turns ✓, and the next message arrives.
2. **Live work closes before the entry that replaces it arrives** (measured,
   in a Node client's document). A reply's stream closes on pi's
   `message_end`, and a tool's on `tool_end`. Each is its own batch, written
   before the commit that adds the entry. A client therefore sees a state with
   neither the stream nor the entry. On the recording that state lasts 50 ms
   after a reply and 130 ms after a tool.
3. **The entry and the lane's tip arrive together** (measured: the new entry
   was never a child of the tip the client read). pi writes `insertEntry` and
   `setValue(branchTip)` in one commit.
4. **The column's anchor follows the tip one render later.** `App` dispatches
   `sync` from a `useEffect` (`app.tsx`), so the render that first holds the
   new entry still has the old anchor. A bound column is pinned at that
   anchor, so in that render:
   - the new entry is a branch leaving the column's last message that no
     column shows, drawn as `⑂ 1 message` (an assistant message) or
     `⑂ 0 messages` (a tool result, which `summarizeBranch` does not count);
   - its tool call has no result on the path yet, so the row stays `…`;
   - `streamingLanes` keeps only lanes whose tip is on `p.path`. The tip has
     moved past the path, so `Streams` draws nothing.
5. **That stale render reaches the screen when rendering is slow.**
   `useTracked` updates through `useSyncExternalStore` at sync priority, and
   React flushes their effects before returning. But the `dispatch` inside the
   effect is scheduled at default priority, in a separate task, and the
   browser can paint between the two. With a small session and a fast CPU, the
   intermediate states never showed (0 painted frames with a chip). At 20×
   throttle, every one showed, for 200 to 300 ms. On the recording (1542
   entries) the `⑂ 0 messages` chip is on screen for about 175 ms, which
   suggests an `App` render of that length at that size. That duration is
   inferred from the video, not measured.
6. **Markdown is not the cause.** `MessageText` memoises its tree by text, so
   committed messages are not parsed again. The one markdown-related change of
   height is the reply's own: `.streaming` is 0.75 rem + 2 px narrower than a
   committed `.msg` and has no bottom margin, so a long reply can wrap to a
   different number of lines when it commits.

7. **Drawing the layout as `sync` will store it removes the stale render**
   (measured, 20× throttle, prototype since reverted). With
   `layout = layoutReducer(stored, { kind: "sync", index, lanes })` in `App`,
   and the effect left to store it, no chip was painted, and the reply stream
   was painted where before it never was. One `bash` call went 1182 → 1256 →
   1182 px instead of 1182 → 1256 → 1209 → 1182. The shrinks from item 2
   remain: the live panel still goes when its stream closes.

## The sequence, from the recording

Screen recording, 25 s, one agent column scrolled to its end, the agent
running `bash` through `python3 - <<'EOF'`. At 12.2 s to 13.5 s:

| t (s) | drawn at the column's end | height |
|---|---|---|
| 12.24 | streaming reply "Now the tests for…" (indented, dimmed) | — |
| 12.30 | neither the stream nor the message: stream closed, entry not arrived | shrinks: content slides down |
| 12.35 | committed message, its `bash …` row pending | grows |
| 12.51 | live tool panel below it: the label again, an empty output box | grows |
| 13.15 | output "Tests 19 passed (19)" | grows |
| 13.20 | live panel gone, row still `…` | shrinks: slides down |
| 13.33 | `⑂ 0 messages` chip | grows |
| 13.51 | chip gone, row `✓` | shrinks: slides down |

The same cycle repeats at 16.0 s, 21.4 s to 22.9 s, and 23.9 s to 25.1 s.

## Why it was asked

Duane noticed an agent's column jumping while the agent ran shell commands, too
fast to see without a recording.

## Contributing geometry

- The live panel (`.tool.live`) repeats the label of the pending row
  directly above it, so the command shows twice while it runs.
- Its output box is up to 16 rem tall (`.tool-output`). When the tool ends,
  the box is removed and the committed row is a closed `<details>`, so the
  column loses up to about 270 px at once. *Since ADR-0049 the row opens
  only for a command that runs past 500ms, capped, and stays open when it
  ends.*

## Not tested

- Render time at 1542 entries, which item 5 infers. `App` rebuilds
  `readTreeIndex` and every projection on each change of the document.
- Browsers other than Chromium.
- A real model: the probes use `scriptedModel`. The recording shows the same
  states, with longer gaps between the host's writes.

## Method

- **Frames:** the recording was decoded with AVFoundation
  (`AVAssetImageGenerator`, zero tolerance). The column was cropped from each
  frame, and the mean difference between neighbouring frames found the jumps.
- **Document order:** `sandbox/s35-agent-work-jumps/probe.ts`, a scripted host
  and a Node client, logging each change of the client's document: entry
  count, lane tip, whether the tip had children, and open streams.
- **Painted states:** `sandbox/s35-agent-work-jumps/browser-probe.ts` samples
  the agent's column every animation frame (messages, last tool status,
  `.streaming`, `.tool.live`, `.open-branch`, content height, `scrollTop`).
  `S35_THROTTLE=20` slows the CPU through CDP. Both are copied into
  `apps/pineta/e2e/` to run, and deleted afterwards.
