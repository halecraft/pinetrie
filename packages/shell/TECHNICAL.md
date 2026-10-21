# `@pinetrie/shell`: technical notes

Shell source as structure (ADR-0114, S138): a command's text in runs by role
(command, option, string, variable, operator, redirect, keyword, comment,
plain), a one-line command laid out to a width, and the lines its
top-level statements begin on. It knows nothing of
tool calls: `@pinetrie/interface` decides which call reads as shell, and
`@pinetrie/web` colours the roles. It declares only `unbash`, and only
interface, `@pinetrie/pi` (whose `bash` tool counts a call's statements)
and the app (whose observer suite runs the statements' fixture) declare it
(`workspace.test.ts`). No DOM and no Node:
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

## Where statements begin (`statements.ts`)

A reader tells a call's commands apart by its top-level statements, so
`statementLines` names the lines that begin one, past the first, in the
source or the layout alike; `@pinetrie/web` sets them apart.

- **Only a statement that starts its line begins one.** `a; b` stays one
  line's worth; a chain's later parts are the same statement.
- **The comment lines directly above a statement are its own**, so the gap
  goes above them. The walk up stops at the statement before's last line,
  which can start with `#` inside a string; a heredoc's body, past that
  line, ends in its terminator, which no walk passes.
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

## Gotchas

- **unbash computes some children on first read**, as getters on its node
  classes (`parts`, `script`, `elements`, `index`, `value`, `expression`,
  `initialize`, `test`, `update`), which `Object.values` does not list. The
  walk reads them by name (`LAZY`). A new unbash version may add one, as 6
  did `script`: a role then goes missing, and `spans.test.ts`'s role table
  fails.
- **Nested scripts' offsets are into the outer source**, so a `$(…)` is
  walked in place, except a script that owns a `source` of its own (an
  escaped backtick's), whose offsets index that decoded text: it is left
  plain.
- **unbash's printer is a check, never the output.** It drops comments and
  every line break the source chose.
