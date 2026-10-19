// Mutations for the terminal client, apps/tui. Run: pnpm mutate scripts/mutations/tui.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "apps/tui"]
const pureConfig = [
  "pnpm",
  "exec",
  "tsc",
  "--noEmit",
  "-p",
  "tsconfig.pure.json",
]

export const mutations: readonly Mutation[] = [
  {
    name: "an ask's row gains a kind the terminal does not draw",
    file: "packages/interface/ask-fold.ts",
    from: '  | { readonly kind: "outcome"; readonly text: string }\n',
    to: '  | { readonly kind: "outcome"; readonly text: string }\n  | { readonly kind: "gap"; readonly text: string }\n',
    // tsc names no failing check: with typecheck clean, any error is the
    // mutant's. Under the pure config only the terminal's draw switches on
    // an ask's rows (`assertNever`); the page's switch is the root config's.
    command: pureConfig,
  },
  {
    name: "the input chain gains a port the terminal does not hold",
    file: "packages/interface/perform.ts",
    from: "  readonly reload: () => void\n",
    to: "  readonly reload: () => void\n  readonly beep: () => void\n",
    // As above: `satisfies AppPorts` in the terminal's ports fails.
    command: pureConfig,
  },
  {
    name: "a view the terminal draws by leaves interface's index",
    file: "packages/interface/index.ts",
    from: "  pathRows,\n",
    to: "",
    command: unit,
    expect:
      "a thread's prompt, its ask's work folded and its last word, and the composer's button",
  },
  {
    name: "an ask's summary carries no points",
    file: "packages/interface/ask-fold.ts",
    from: '          pointsMarkdown: outline ? "" : pointsText(digest.points),\n',
    to: '          pointsMarkdown: "",\n',
    command: unit,
    expect:
      "an ask's digest is drawn with its points, after the fold interface anchors it to",
  },
  {
    name: "the terminal client declares rules",
    file: "apps/tui/package.json",
    from: '    "@pinetrie/interface": "workspace:*",\n',
    to: '    "@pinetrie/interface": "workspace:*",\n    "@pinetrie/rules": "workspace:*",\n',
    command: ["pnpm", "exec", "vitest", "run", "workspace.test.ts"],
    expect: "the terminal client declares only interface, session and core",
  },
]
