// shell/nodes — unbash's parse as a tree any walk can read: its nodes,
// and every child of one, those unbash computes on first read included.

/** A node of the parse, as the walk sees one: its type and its place. */
export interface Node {
  readonly type: string
  readonly pos: number
  readonly end: number
}

export const isNode = (v: unknown): v is Node =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Node).type === "string" &&
  typeof (v as Node).pos === "number" &&
  typeof (v as Node).end === "number"

/**
 * unbash computes some children on first read, as getters on its classes'
 * prototypes, which `Object.values` does not list (`unbash/dist/word.js`,
 * `expansion.js`, `assignment.js`, `heredoc.js`, `parser.js`). `args` and
 * `redirects` are left out: they repeat `prefix` and `suffix`.
 */
const LAZY = [
  "parts",
  "script",
  "elements",
  "index",
  "value",
  "expression",
  "initialize",
  "test",
  "update",
] as const

export const nodeChildren = (node: Node): unknown[] => [
  ...Object.values(node),
  ...LAZY.map(key => (node as Node & Partial<Record<string, unknown>>)[key]),
]
