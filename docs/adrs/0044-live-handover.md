# ADR-0044 — Live work hands over to its entry on screen: a reply is current while its lane's tip is where it opened, a tool's output is in its row, and a following column only grows while its agent works

- **Status:** Accepted
- **Area:** `packages/web/TECHNICAL.md`, `docs/06-interface.md`
- **Evidence:** S17, S35, S55
- **Amends:**
  - ADR-0022: a stream no longer closes when its message or tool ends.
- **Amended by:**
  - ADR-0049: when a tool's row opens and closes, and the floor's height.

**Context.** An agent's column jumped five or six times per tool call, too fast
to see without a recording (S35). The column drew the agent's current step
from three sources that change at different times: stream records, committed
entries, and the layout's anchor. Each handover between them had a state in
between, and a slow render painted it.
- A stream closed on pi's `message_end` or `tool_end`, before the commit that
  wrote its entry, so a reader saw neither for 50–130 ms.
- `App` brought the layout up to date in an effect, one render after the
  index. The render between drew a new entry under the old anchor: a
  `⑂ 0 messages` chip, a row stuck at `…`, and no live panel.
- A finished tool's output box went, up to 16 rem, and a reply could wrap
  differently when it committed. A column at its end slid down each time.

**Decision.**
- **The layout drawn is derived in render.** `resolveLayout(stored, facts)`
  brings the stored layout up to one moment's index, lanes and archive; `App`
  draws it and an effect stores it. No effect dispatches from document facts,
  except the one-time `prune` at settle.
- **A reply is current while its lane's tip is where it opened.** A reply
  stream records the lane's tip when it opens (`under`). The commit that writes
  the reply's entry moves the tip (S55), so the stream stops being current in
  the same change that adds the entry. `isCurrentReply` is the one rule: the
  host appends to the current reply, and the reader draws it.
- **Nothing happens when a message or a tool ends.** A stream stays until the
  next one of its lane opens, or its run ends; by then its entry is written
  (S55). `messageEnd` and `toolEnd` are gone from `StreamEvent`.
- **A tool's live output is drawn in its row.** The row is open while its
  call has a stream and no result, and its result replaces the stream in the
  same element, in the render that holds the result. *Since ADR-0049, the
  row opens, capped, only after 500ms and stays open; only the reader closes
  it, or shows it whole.*
- **Live work is drawn in its committed form's box.** A streaming reply is a
  `.msg`, and live work's mark takes no width, so nothing rewraps when it
  commits.
- **A column that follows its end does not get shorter while its agent
  works.** A shrink is taken up by a floor below the content, set before the
  frame is painted, which what the agent writes next fills. The floor goes
  when the run ends. *Since ADR-0049, the floor is at most a third of the
  view.*

**Consequences.**
- The document keeps a finished stream a little longer: a reply until the
  lane's next stream opens, a tool until the next reply. `endRun` deletes the
  rest.
- `streams` gains `under`. Its row is inside a `Schema.record`, so the change
  is not migratable (S17); a store written before it opens, since the host
  clears every stream at start (S55).
- While an agent works, a column can show blank space below its last
  message, until the next message fills it. If a run ends shorter than its
  floor, the column moves once, at the end. A column that shrinks mid-run for
  another reason, such as a column opened to its left, keeps its floor until
  the run ends.
- The browser suite checks the invariant at 20× CPU throttle, frame by frame:
  no chip, no missing step, no shrink.

**Alternatives rejected.**
- Computing `sync` in render alone (S35's prototype): fixes the chip, not the
  missing step or the shrinks.
- Marking a stream `ended` and hiding it once superseded: a field and an op
  more, and the host and reader would each need their own rule.
- Closing a stream in the commit that writes its entry, inside
  `KynetaStorage`: couples pi's commit path to streams, and orders only the
  host's writes.
- Keeping a finished tool's output open: changes ADR-0022's folded rows, and
  covers only that one shrink. *Adopted by ADR-0049: that shrink was the
  floor's largest, and could leave a column with no text on screen.*
