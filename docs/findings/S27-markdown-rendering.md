# S27 — rendering messages as markdown

**Answers.**
1. **react-markdown can render a message and still let a selection be cited.**
   A rehype plugin wraps each rendered text run in a span that carries the
   run's source range (`data-s`, `data-e`). An alignment then maps each
   character of the run to the source token that produced it: a literal
   character, a backslash escape, or a character reference. Source characters
   that produce nothing, such as indentation, `>` markers and trimmed spaces,
   are skipped. Over 3 592 messages, 28 734 characters were checked against
   ground truth with none wrong, and 21 552 random selections mapped in bounds.
2. **Code text needs two corrections.** Text inside a code block has no
   position of its own, so it takes its `code` element's range. The alignment
   has to start past the fence line (```` ```sh ```` followed by `sh -c …`
   otherwise maps `sh` to the info string), and past the opening backticks of
   inline code. `mdast-util-to-hast` adds a newline to the end of a block's
   value, and the source may not have one. Any other text without a position is
   whitespace that remark-rehype put between elements, and it must not inherit
   a range.
3. **Raw HTML shows as literal text, and nothing executable gets through.**
   react-markdown turns `raw` nodes into text by default. A `javascript:` link
   renders with an empty `href`. No `on*` attribute and no element outside
   ordinary markdown output appeared anywhere in the corpus.
4. **remend is safe for streaming text only.** Its `singleTilde` and
   `comparisonOperators` handlers insert escapes in the middle of the text. With
   both off, 43 of 20 242 streaming prefixes were rewritten, and every rewrite
   was at the end: an unfinished link, or an unfinished HTML tag stripped.
   remend also trims trailing whitespace. Committed text is rendered without
   remend. Streaming text is never citable (ADR-0017), so these rewrites cost
   nothing.
5. **Re-rendering the whole message on each change is fast enough.** Rendering
   the largest message (17 310 characters) took 8.8 ms with the spans and 7.5 ms
   without. Streaming it in 432 frames, re-rendering the whole string each time,
   averaged 5.8 ms per frame. All measured in Node. The added client bundle is
   52 kB gzipped (react-markdown, remark-gfm and remend, with React external).

## Why it was asked

The client shows message text as plain text. Markdown is the obvious fix, but
span references are UTF-16 offsets into `entryText` (ADR-0017), and
`selectedSpan` in `packages/client/message.tsx` measures a selection over the
rendered string. That only works while the rendered text is exactly
`entryText`. Once `**bold**` renders as "bold", the two diverge, so the renderer
has to say which source each rendered character came from.

The candidates were streamdown, react-markdown with remend, a renderer
of our own over `mdast-util-from-markdown`, and streaming-markdown.
streamdown is react-markdown plus remend, block memoization, Tailwind styling
and optional plugins, at about 148 kB gzipped. It splits the text into blocks
before parsing, so its positions are probably relative to each block, not the
message (not checked). streaming-markdown appends to the DOM outside React and
records no positions. `Streams` in `packages/client/column.tsx` re-reads the
whole string on each change anyway, so a renderer that takes the whole string
fits better than one that takes appended chunks.

## Result

| check | result |
|---|---|
| messages | 3 592: 17 hand-written edge cases, and the assistant text of every local pi session |
| text runs aligned | 83 758 of 83 759; the exception is a generated footnote backlink |
| visible text outside any run | 3 runs, all generated footnote parts (`1`, `Footnotes`, `↩`) |
| characters checked against ground truth | 28 734, 0 wrong |
| random selections | 21 552: 0 out of bounds, 211 empty (both ends in one gap between runs) |
| HTML or `javascript:` let through | 0 |
| streaming prefixes rewritten | 43 of 20 242, all at the end |
| streaming prefixes that threw | 0 |

**The ground truth.** For a sampled character, the probe replaces the source
token that the alignment names with a marker of the same character class, then
renders again. Only that one character of the rendered text may change. The
class matters: replacing the space after `**bold.**` with a letter stops the
`**` from closing, which changes the parse, not the mapping.

**The check can fail.** Each correction was removed in turn, and the check
caught each one:

| removed | wrong |
|---|---|
| backslash escapes in the alignment | 3 |
| skipping the fence line | 2 (the `sh` case) |
| skipping inline code's backticks | 2 |
| each character's end one too far | 4 730, and 38 selections out of bounds |

The fence and backtick cases pass on real messages alone. The hand-written edge
cases are what catch them.

## Consequences

- The client takes the pipeline react-markdown runs, with remark-gfm
  (`singleTilde: false`) and remend (`singleTilde` and `comparisonOperators`
  off, for streaming text only), plus the rehype plugin and alignment from this
  probe.
- ADR-0017 says a span covers "`messageText`, which is what the client renders".
  That stops being true, and `selectedSpan`'s comment with it. The offsets stay
  offsets into `entryText`; what changes is how a selection reaches them.
- A selection whose ends fall in the same gap between runs is empty, and
  so is a selection that the alignment cannot map (only generated footnote text
  so far). Either should cite the whole entry.
- Footnotes produce text with no source. Leave them uncitable, or turn them off.

## Not tested

- A real browser. The DOM was jsdom's, rendered with `renderToStaticMarkup`,
  not React in a page. Selections were built from random boundary points, not
  from mouse drags or triple-clicks.
- The reverse mapping, from a stored span back to a DOM range to highlight it.
  The client does not highlight cited spans yet.
- CRLF line endings. Models in the corpus wrote `\n`.
- Timing in a browser, and with several streams on screen at once.
- Syntax highlighting.

## Method

A disposable probe in `sandbox/s27-markdown/`, not checked in: `render.ts` (the
plugin, the alignment, the selection mapping) and `probe.ts` (the checks),
react-markdown 10.1.0, remark-gfm 4.0.1, remend 1.3.1, jsdom 30.1.1, Node 24.
The corpus is the text parts of assistant messages in `~/.pi/agent/sessions`.
It grows as sessions run, so the counts shift a little from run to run.
The failing variants were copies of `render.ts` with one correction edited
out, run over the first 600 messages.
