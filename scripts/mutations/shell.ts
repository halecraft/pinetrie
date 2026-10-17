// Mutations for @pinetrie/shell. Run: pnpm mutate scripts/mutations/shell.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/shell"]
const layout = "packages/shell/layout.ts"
const spans = "packages/shell/spans.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "every node fits its line",
    file: layout,
    from: "  const fits = (n: Span, indent: number) => indent + n.end - n.pos <= width",
    to: "  const fits = (_n: Span, _indent: number) => true",
    command: unit,
    expect: "mkdir -p /tmp/wc && cd /tmp/wc",
  },
  {
    name: "a layout is kept without its printer's check",
    file: layout,
    from: "    print(again) === print(parsed) &&\n",
    to: "",
    command: unit,
    expect: "a line break that splits a command is not",
  },
  {
    name: "a layout may drop what the printer drops",
    file: layout,
    from: "    print(again) === print(parsed) &&\n    squeezed(text) === squeezed(source)",
    to: "    print(again) === print(parsed)",
    command: unit,
    expect: "a comment dropped is not",
  },
  {
    name: "a chain's first part takes a continuation's indent",
    file: layout,
    from: "        const line = node(part, i === 0 ? indent : indent + INDENT)",
    to: "        const line = node(part, indent + INDENT)",
    command: unit,
    expect: "while read -r line",
  },
  {
    name: "a pipeline's time or ! is dropped",
    file: layout,
    from: "${i === 0 ? lead : pad(indent + INDENT)}",
    to: '${i === 0 ? "" : pad(indent + INDENT)}',
    command: unit,
    expect: "! grep -q TODO",
  },
  {
    name: "a command expansion is never walked",
    file: spans,
    from: '  "parts",\n  "script",\n',
    to: '  "parts",\n',
    command: unit,
    expect: "command marks",
  },
  {
    name: "a command's name is a plain word",
    file: spans,
    from: '  walk(name, mark, "command")',
    to: "  walk(name, mark)",
    command: unit,
    expect: "command marks",
  },
  {
    name: "a lazy child is never walked",
    file: spans,
    from: "  ...LAZY.map(key => (node as Node & Partial<Record<string, unknown>>)[key]),",
    to: "",
    command: unit,
    expect: "string marks",
  },
]
