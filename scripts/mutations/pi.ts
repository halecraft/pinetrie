// Mutations for @pineta/pi. Run: pnpm mutate scripts/mutations/pi.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/pi"]
const e2e = ["pnpm", "run", "e2e"]

export const mutations: readonly Mutation[] = [
  {
    name: "checkpoints are stored whole",
    file: "packages/pi/storage.ts",
    from: "                write.namespace === CHECKPOINT_NAMESPACE",
    to: '                write.namespace === "never"',
    command: unit,
    expect: "the record keeps only a shell",
  },
  {
    name: "a scripted tool call drops its arguments",
    file: "packages/pi/scripted.ts",
    from: "                    step.args as Parameters<typeof fauxToolCall>[1],",
    to: "                    {},",
    command: e2e,
    expect: "a read is stored as a call paired with its result",
  },
  {
    name: "a field pi does not own re-indexes everything",
    file: "packages/pi/storage.ts",
    from: '  if (field !== "entries" && field !== "values" && field !== "lists")\n    return { kind: "none" }',
    to: '  if (field !== "entries" && field !== "values" && field !== "lists")\n    return { kind: "all" }',
    command: unit,
    expect: "ignored, whatever it is called",
  },
  {
    name: "a direct lane's tools do not wait for its setup",
    file: "packages/pi/lanes.ts",
    from: "        await ready",
    to: "        void ready",
    command: unit,
    expect: "a tool waits for setup",
  },
  {
    name: "a turn is not awaited before the next request",
    file: "packages/pi/agent.ts",
    from: "      if (tip !== null)\n        await lanes.hooks.turnDone(event.lane as LaneName, entryId(tip))",
    to: "      if (tip !== null)\n        void lanes.hooks.turnDone(event.lane as LaneName, entryId(tip))",
    command: unit,
    expect: "each turn is recorded before the next request",
  },
  {
    name: "Buffer bytes are encoded as their toJSON shape",
    file: "packages/pi/lane-protocol.ts",
    from: "  const raw = (this as Record<string, unknown>)[key]",
    to: "  const raw = value",
    command: unit,
    expect: "a Buffer crosses as bytes, not in its toJSON shape",
  },
  {
    name: "the lane protocol drops an error nested in a result",
    file: "packages/pi/lane-protocol.ts",
    from: "  if (raw instanceof Error) {",
    to: "  if (false) {",
    command: unit,
    expect: "an error nested in a result is rebuilt",
  },
  {
    name: "the helper drops { abort }",
    file: "packages/pi/lane-helper.ts",
    from: '    if ("abort" in request) running.get(request.abort)?.abort()',
    to: '    if ("abort" in request) return',
    command: ["pnpm", "exec", "vitest", "run", "packages/pi/lane-env.test.ts"],
    expect: "an abort kills the command and its children",
  },
]
