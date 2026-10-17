import { execFileSync } from "node:child_process"
import path from "node:path"
import { expect, test } from "vitest"

test("a command that exits before reading its input is answered by its exit", () => {
  // In a process of its own, so a crash there is its exit, not this run's.
  // More input than a pipe holds, so the write is still going when the
  // command exits.
  const script = `
    import { command } from ${JSON.stringify(path.join(import.meta.dirname, "command.ts"))}
    const input = "x".repeat(8 * 1024 * 1024)
    const ok = await command("true", [], { input }).then(() => true)
    const failed = await command("false", [], { input }).then(() => false, () => true)
    console.log(ok && failed ? "answered" : "wrong")
  `
  const out = execFileSync("node", ["--input-type=module", "-e", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  expect(out.trim()).toBe("answered")
})
