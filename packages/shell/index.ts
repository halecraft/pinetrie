// @pinetrie/shell — shell source as structure: a command's words by role,
// a one-line command laid out to a width, and where its statements lie;
// and a terminal's output as structure: its text by style.

export {
  readShell,
  type ShellRead,
  type ShellText,
  type ShownStatement,
} from "./read.ts"
export type { ShellRole, ShellSpan } from "./spans.ts"
export { parseStatements, type StatementSpan } from "./statements.ts"
export {
  type PaletteIndex,
  PLAIN_STYLE,
  paletteIndex,
  plainText,
  type StyledRun,
  sgrOnlyText,
  styledRuns,
  type TerminalColor,
  type TerminalStyle,
} from "./terminal.ts"
