# `@pinetrie/shell`: technical notes

Shell source as structure (ADR-0114, S138): a command's text in runs by role
(command, option, string, variable, operator, redirect, keyword, comment,
plain), and a one-line command laid out to a width. It knows nothing of
tool calls: `@pinetrie/interface` decides which call reads as shell, and
`@pinetrie/web` colours the roles. It declares only `unbash`, and only
interface declares it (`workspace.test.ts`). No DOM and no Node:
`tsconfig.pure.json` checks it with `lib: ["ESNext"]`, no ambient types and
only the globals `pure-globals.d.ts` declares.

## `readShell(source, width)`

One entry point, so a caller parses once and never knows how a layout is
checked. It returns the source's runs and, when the source is laid out, the
layout's runs, from the parse the layout's check already made.

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
