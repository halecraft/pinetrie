# S142 — A bash result is its live output's text, then a status line after a blank one; a row's summary can show the same tail either side of the handover

- **Status:** Answered
- **Led to:** ADR-0123

**Question.** A tool row's summary is to show the last five lines of a
call's output, its live stream while the call runs and its result after
(ADR-0123). Would the handover from one to the other change the summary's
height? And how many characters does a laid-out command get once the row
has the column's full width?

**Kill criterion.** The result's text is not the stream's text with lines
added at its end: then the tail would jump at the handover, and the
summary would show its output's head instead.

**Throw away.** Nothing: this was read from source, and worked out on
paper.

## Answers

**The result is the stream, then a status.** Read from pi's bash tool
(`@earendil-works/pi-coding-agent`, `dist/core/tools/bash.js`, 0.87.1):

- Each live update is the output accumulator's snapshot
  (`emitOutputUpdate`, `snapshot.content`), already cut to its last 2000
  lines or 50 KB, as the result is.
- The result is `formatOutput(snapshot)`: the same snapshot's text, or
  `(no output)` when there is none, then, when the output was cut, a blank
  line and `[Showing lines …]`.
- A failure throws the same text, then a blank line and its status:
  `Command exited with code N`, `Command aborted`, `Command timed out after
  N seconds`, `Command terminated without an exit code`.

So the result's last lines are the stream's last lines, at most two of
them replaced by a blank line and a status. Five lines either side of the
handover are five lines: the summary keeps its height. A command with no
output goes from no lines to one, `(no output)`, which grows the column
and never shrinks it.

**The width.** A 28rem column's body is padded .75rem left and 1.75rem
right; a tool row takes 1rem of the right padding back (`.tool`'s margin),
so it is 26.5rem, 424px at a 16px root. A row's command is .8rem, 12.8px,
and the Mac's SF Mono is 0.6em a character, 7.68px: 55 characters a line.
Headless Chromium has no SF Mono; its fallback monospace is 0.5em, so this
width is computed for the Mac's font, not measured.
