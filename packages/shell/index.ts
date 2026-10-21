// @pinetrie/shell — shell source as structure: a command's words by role,
// a one-line command laid out to a width, and where its statements lie.

export {
  readShell,
  type ShellRead,
  type ShellText,
  type ShownStatement,
} from "./read.ts"
export type { ShellRole, ShellSpan } from "./spans.ts"
export { parseStatements, type StatementSpan } from "./statements.ts"
