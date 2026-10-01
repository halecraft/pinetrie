# ADR-0054 — A column says whether its agent is thinking or running a command, without moving

**Status:** Accepted. Evidence: S67. Implementation:
`PLAN-2026-10-01-column-activity`. Amends ADR-0049 (a column mounted again
draws its tool rows as they were left).

**Context.** Inside a column, the only sign that its agent was working was the
**Stop** button above the composer. Nothing said whether the agent was
thinking, which is the model's time, or waiting for a command, which is the
reader's machine. The two call for different patience. A tab, the rail and
the page header already pulse while the agent runs, but only for whole roots
and tips. The column showing the work had nothing of its own.

Any sign drawn inside a following column must not change its height. A
column at its end follows height (S32), and while its lane runs it does not
get shorter (`holding`, ADR-0044). A sign that comes and goes with the run, or
with each command, would scroll the column or leave floor behind.

**Decision.**
- **The mark before the thread's name pulses while the column's lane runs**
  (`.thread-mark.pulse`, `packages/client/column.tsx`), whatever the agent
  is doing, titled
  `workingWords`' "the agent is working". This is the sign seen from anywhere
  in the column. It reads `lane.running`, the fact Stop reads, computed once
  in `Column`. A read-only column shows it too. The mark is one square that
  holds the `✦` or, once there is one, the thread's banner over it
  (ADR-0053), so the square pulses, not the star: under a banner the star
  is hidden.
- **A command the work opened is outlined while it runs.** A row that is live
  (a stream and no result) and revealed (it streamed for `REVEAL_MS`, ADR-0049)
  carries `data-revealed`, and `.tool.live[data-revealed]` has a pulsing
  outline. An outline takes no layout. A call whose result comes sooner is
  never revealed, so it never shows one, as its row never opens. This applies
  to every tool, not only `bash`. The live row's gutter bar goes;
  a streaming reply keeps its own.
- **While the lane runs, a short line pulses at the end of the column's
  content**, centred, after the streaming reply and before the messages
  waiting for the lane: where the next text will appear (`.working-line`).
  It is drawn for the whole run, and CSS hides it while the column holds a
  revealed live row: `.column-content:has(.tool.live[data-revealed])`. So it
  shows while the model thinks or writes, and never at the same time as an
  outline.
- **The line has zero height.** An empty block's margins collapse through
  it, so the gap between messages, and between the last message and the end,
  is the same with or without it. The shadow draws it, and a transform lifts it
  into the gap above. Neither takes layout. `.column-content`'s own height,
  which the follow rule reads, does not change when the run starts or ends,
  or when a command starts or stops.
- **The tabs and the rail stay as they are**, one colour and one state. A
  tab covers several lanes, and a mixed state there would need a rule of its
  own.

**Consequences.**
- No new value decides which kind of work runs. The outline and the line
  read `ToolRow`'s own facts through `data-revealed`, so neither restates
  its live rule, and `REVEAL_MS` has one home.
- A command shorter than `REVEAL_MS` changes nothing on screen: the line
  stays, and no outline flashes.
- The line's hiding comes back with the row memory (ADR-0049, as amended): a
  tab shown again with a command running draws the line hidden and the row
  outlined from its first frame.
- The `:has()` rule costs nothing measurable while a reply streams into a
  column of 300 messages (S67).
- The browser suite checks: the mark pulses and stops; the line is centred,
  in the gap, and adds no height, both as the content's last child and above
  a waiting message; a slow command is outlined and hides the line; a 200 ms
  command does neither.

**Alternatives rejected.**
- A pulsing dot at the column's end: it said "working", not which kind.
- One dot whose colour shifts between thinking and running a command: the
  outline is drawn on the work itself, and the line where the next text goes.
- The line at the column's bottom edge, always visible: the star is already
  visible from anywhere, and the end of the content is where a reply
  appears.
- A `"model" | "tool"` value in `columnView`, with CSS delays from
  `REVEAL_MS`: it restated `ToolRow`'s live rule (a result, or a stream that
  outlives it) and copied `REVEAL_MS` into CSS. An `animation-delay` also
  restarts when an element mounts, so a running row shown again would fade
  its outline in after the switch.
- Negative margins for the line's net-zero height: as `.column-content`'s last
  child, its bottom margin escapes the content, which then grows by it.
- `streamingLanes` (the runs whose tip is on the column's path) for the
  star: Stop reads the thread's lane, and the two signs should agree.
- A two-state tooltip on the star: it needs the value rejected above, and
  the outline and the line already show the state.
