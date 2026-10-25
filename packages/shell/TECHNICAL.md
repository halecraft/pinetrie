# `@pinetrie/shell`: technical notes

Shell source as structure (ADR-0114, S138): a command's text in runs by role
(command, option, string, variable, operator, redirect, keyword, comment,
plain), a one-line command laid out to a width, and its top-level
statements: where each lies, and the lines a reader sees each begin on.
And a terminal's output as structure (ADR-0214): its escape sequences read,
its SGR styles as values, its text in runs by style. It knows nothing of
tool calls: `@pinetrie/interface` decides which call reads as shell, and
`@pinetrie/threads` which writes a terminal's output; `@pinetrie/web`
colours the roles and draws the styles. It declares only `unbash`, and only
interface, `@pinetrie/pi` (whose `bash` tool counts a call's statements and
keeps its output's SGR) and the app (whose observer suite runs the
statements' fixture) declare it (`workspace.test.ts`). No DOM and no Node:
`tsconfig.pure.json` checks it with `lib: ["ESNext"]`, no ambient types and
only the globals `pure-globals.d.ts` declares.

## `readShell(source, width)`

One entry point, so a caller parses once and never knows how a layout is
checked. It returns the source as a `ShellText` (its runs, and the lines its
statements begin on) and, when the source is laid out, the layout as one,
from the parse the layout's check already made.

- **Runs join to their text.** Every character of the source is in exactly
  one run (`spans.test.ts` checks a corpus). A source that does not parse is
  one plain run.
- **A layout changes whitespace and statement separators only.** Every leaf
  is copied from the source: a node that fits its line is its source text,
  and one that does not breaks where the shell takes a line break (one
  statement a line; one part of an `&&`, `||` or `|` chain a line, the
  operator ending the line, a pipeline's `time` or `!` before its first
  part; a subshell's, group's, loop's or `if`'s body indented). `sameProgram` keeps a layout only when unbash's printer, which
  ignores line breaks, prints both the same, and the two are the same
  characters once whitespace and `;` are dropped. The second test is there
  because the printer drops comments too.
- **Only one-line commands are laid out.** A command with lines of its own
  was laid out by the agent, and a heredoc needs its lines as written. In a
  one-line command, a comment can only be the last thing on the line, so the
  layout keeps it after the last statement.

## A command's statements (`statements.ts`, ADR-0204)

`statementSpans` is the one definition of a top-level statement: a leaf of
the command's `;`, `&` and newline connections, so an `&&`, `||` or `|`
chain is one, and a backgrounded one keeps its `&`. pine·trie's bash
numbers the same statements, in the same order, as it starts each (the patch,
`packages/lanes/image/bash/apply.py`, marks them), and
unbash agrees with it on every kind of statement in the observer's command
(`fixtures.ts`, `@pinetrie/shell/fixtures`, which the observer suite runs
and `statements.test.ts` checks). Where they could disagree, the join
leaves the call undivided, never wrongly split
(`packages/rules/TECHNICAL.md`).

- **A span's lines count from 1, as bash counts a `-c` string's**, so a
  signal's line compares to them unchanged. `ShellText.statements` gives
  them from 0, in the text shown, laid out or not: a layout keeps every
  statement, in order.
- **A span ends past its heredocs' terminators.** unbash keeps a heredoc's
  closing line outside every node's range, and its body may follow other
  statements on its line (`cat <<EOF; echo x`), so the end is the furthest
  any node of the statement reaches, a heredoc's closing included. A
  heredoc with no terminator spans the rest of the command, as bash reads
  it.
- **`parseStatements`** is the entry `packages/pi` uses: none for a
  command that does not parse, whose statements bash would count in a way
  unbash cannot tell.

`statementLines` is derived from the spans: the lines that begin a
statement past the first, which `@pinetrie/web` sets apart.

- **Only a statement that starts its line begins one.** `a; b` stays one
  line's worth; a chain's later parts are the same statement.
- **The comment lines directly above a statement are its own**, so the gap
  goes above them. The walk up stops at the statement before's last line,
  which can start with `#` inside a string, or be its heredoc's
  terminator: between two statements lie only comments and blank lines.
- **A statement after a blank line begins none:** the agent already set it
  apart.
- **It never changes the text**, only names its lines: a command with lines
  of its own is still shown as written.

## Roles (`spans.ts`)

Each node marks its range, and a node inside another marks over it, so the
innermost wins: a `$?` inside a double-quoted string is a variable inside a
string. A word is plain unless its command says otherwise: its name is the
command, and an argument starting with `-` an option. Text between words is
read by its characters: a `#` starting a word begins a comment, a keyword
(`do`, `done`, `then`…) is a keyword, and `&|;(){}!` (and a `$` opening a
substitution) are operators.

## A terminal's output (`terminal.ts`, ADR-0214, S342)

One regex, `ESCAPE_SEQUENCE`, splits text into pieces: text, an SGR, or any
other escape sequence. `sgrOnlyText`, `plainText` and `styledRuns` are each a
fold over those pieces, so what counts as a sequence is decided once for
keeping, dropping and styling.

- **`sgrOnlyText` keeps an SGR as written and drops any other sequence
  whole**: an erase, a cursor move, a private mode (`ESC[>4;2m` is not SGR),
  an OSC hyperlink or title, a charset. Its `sanitize` (pi's
  `sanitizeBinaryOutput`) sees only the text between sequences, so the
  control bytes it drops can never include an SGR's ESC.
- **A sequence the text ends inside of is dropped**: a live view cut
  between two chunks would otherwise show the cut sequence's parameters
  until the next view.
- **The 8-bit C1 forms are text**, as pi's sanitiser leaves them.
- **`styledRuns` keeps a style across lines, and never joins two runs**: a
  run is the text between two sequences, and its `at` is where it starts in
  the text read, escape sequences counted, so a range of that text (a
  record's stderr, `@pinetrie/interface`) cuts it exactly. An empty
  parameter is 0, a reset; an unknown code changes nothing; `38`
  and `48` take their colour's fields in both the `;` and the `:` forms,
  even when the colour is out of range.
- **A palette colour is a `PaletteIndex`**, made only by `paletteIndex`,
  which returns null outside 0 to 255, so a client's lookup needs no range
  check.

## Gotchas

- **`ESCAPE_SEQUENCE`'s alternatives are tried in order.** The cut-sequence
  alternative must come before the catch-all, which would otherwise read a
  cut CSI's `ESC [` as a whole sequence and leave its parameters as text.

- **unbash computes some children on first read**, as getters on its node
  classes (`parts`, `script`, `elements`, `index`, `value`, `expression`,
  `initialize`, `test`, `update`), which `Object.values` does not list. The
  walk reads them by name (`LAZY`, `nodes.ts`, which every walk shares). A new unbash version may add one, as 6
  did `script`: a role then goes missing, and `spans.test.ts`'s role table
  fails.
- **Nested scripts' offsets are into the outer source**, so a `$(…)` is
  walked in place, except a script that owns a `source` of its own (an
  escaped backtick's), whose offsets index that decoded text: it is left
  plain.
- **unbash's printer is a check, never the output.** It drops comments and
  every line break the source chose.
