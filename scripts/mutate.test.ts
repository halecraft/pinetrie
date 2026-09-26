import { describe, expect, test } from "vitest"
import { judge, run as runGroup } from "./mutate.ts"

const run = (status: number | null, output: string, timedOut = false) => ({
  status,
  output,
  timedOut,
})

describe("judge: what a mutant's run proves", () => {
  test("a passing run means the check did not notice: SURVIVED", () => {
    expect(judge(run(0, "Tests 5 passed"), undefined)).toBe("SURVIVED")
  })
  test("a mutant that does not load proves nothing: BROKEN, even if it exits non-zero", () => {
    expect(judge(run(1, "SyntaxError: Unexpected token"), undefined)).toBe(
      "BROKEN",
    )
  })
  test("a failing run with no expectation is KILLED", () => {
    expect(judge(run(1, " FAIL  some test"), undefined)).toBe("KILLED")
  })
  test("with an expectation, only the intended check failing counts", () => {
    const out = "  PASS  one\n  FAIL  the colour check\n"
    expect(judge(run(1, out), "colour check")).toBe("KILLED")
    expect(judge(run(1, out), "alignment check")).toBe("ELSEWHERE")
  })
  test("the expected text must be on a failing line, not anywhere in the output", () => {
    const out = "  PASS  the colour check\n  FAIL  something else\n"
    expect(judge(run(1, out), "colour check")).toBe("ELSEWHERE")
  })
  test("a hang is a failure: KILLED", () => {
    expect(judge(run(null, "", true), "anything")).toBe("KILLED")
  })
})

describe("run: nothing a command starts outlives it", () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  // The shell is the child; the sleep it starts in the background is a
  // grandchild, as vitest's worker is under pnpm.
  test("on a timeout, the whole process group is killed, grandchildren too", async () => {
    const r = await runGroup(
      "sh",
      ["-c", "sleep 60 & echo $!; wait"],
      process.cwd(),
      500,
    )
    const pid = Number.parseInt(r.output, 10)
    expect(r.timedOut).toBe(true)
    await new Promise(res => setTimeout(res, 100))
    expect(alive(pid)).toBe(false)
  })
  test("when the command ends, what it left running is killed", async () => {
    const r = await runGroup(
      "sh",
      ["-c", "sleep 60 >/dev/null 2>&1 & echo $!"],
      process.cwd(),
      10_000,
    )
    const pid = Number.parseInt(r.output, 10)
    expect(r.timedOut).toBe(false)
    await new Promise(res => setTimeout(res, 100))
    expect(alive(pid)).toBe(false)
  })
})
