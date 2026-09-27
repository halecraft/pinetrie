# S37: why a column changes width

Probe: `sandbox/s37-column-width/probe.ts`. It renders `index.html`'s stylesheet
over a static strip of two columns in Chromium, puts one kind of content in
the first column, and measures both columns at viewports 900 and 1800 px wide.

**Answers.**
1. **A column grows to its widest unbreakable line.** `.column` is
   `flex: 0 0 28rem` and sets no `width`, so as a flex item its automatic
   minimum width is its min-content width. `flex-shrink: 0` doesn't prevent
   this: the flex basis is clamped up to that minimum. `overflow-x: auto` on
   a `pre` lets it scroll only when its container is narrower than it. It
   does not lower the `pre`'s min-content contribution, so the contribution
   passes up through `.column-body` to `.column`.
2. **Three kinds of content widen it** (448 px is 28rem):

   | content | width |
   |---|---|
   | a fenced code block with a long line (`.text pre`) | 1645 |
   | a tool call's label, e.g. `read <long path>` (`.tool-label`, up to 120 chars) | 1585 |
   | tool output with a long unbroken token (`.tool-output`, `pre-wrap`) | 1496 |
   | plain text, a long URL, long inline code, a GFM table (spaced or not) | 448 |

   Text and tables stay put because `.text` sets `overflow-wrap: anywhere`,
   which adds break points to the min-content width. It doesn't reach `pre`,
   which is `white-space: pre`. Tool labels and tool output are outside
   `.text`.
3. **The viewport's width has no effect**: every width was the same at 900
   and 1800 px. A column that looks wider "by default" holds one of the items
   above somewhere in its path, even if it's scrolled out of view. That
   includes a column in the Archive preview, which uses the same `.column`.
   When one appears while the agent works (a streamed code block, a tool
   row), the column widens as it arrives.
4. **`.column { min-width: 0 }` holds every case at 448.** The code block and
   the tool output then scroll inside themselves. A tool label is not a
   scroll container, so it overflows `.column-body` sideways (+1109 px of
   horizontal scroll). It needs its own wrapping, e.g.
   `overflow-wrap: anywhere`.
