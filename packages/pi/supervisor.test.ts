import { execFileSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import { helloRun, superviseCommand } from "./supervisor.ts"

describe("superviseCommand", () => {
  const supervision = {
    supervise: "/pinetrie-runtime/bin/supervise",
    socket: "/run/pinetrie/runs-1.sock",
    root: "/workspace",
    shared: ["/workspace/.plans"],
    shell: "/bin/bash",
  }

  test.each([
    ["quotes", `echo 'it''s' "a b"`],
    ["a newline", "echo a\necho b"],
    ["dollars and backslashes", "echo $HOME \\$HOME `id`"],
  ])("the inner shell gets the command byte for byte, with %s", (_, command) => {
    const line = superviseCommand(supervision, "r1", command)
    // `printf` stands in for the supervisor: the words it would be given.
    const words = execFileSync("sh", [
      "-c",
      `${line.replace(/^exec \S+/, "printf '%s\\0'")}`,
    ])
      .toString()
      .split("\0")
      .slice(0, -1)
    expect(words).toEqual([
      "--root",
      "/workspace",
      "--shared",
      "/workspace/.plans",
      "/run/pinetrie/runs-1.sock",
      "r1",
      "--",
      "/bin/bash",
      "-c",
      command,
    ])
  })
})

describe("helloRun", () => {
  test("a supervisor's hello names its run; any other line is none", () => {
    expect(helloRun("hello\tr1")).toBe("r1")
    expect(helloRun("hello\t")).toBeNull()
    expect(helloRun("end\t1")).toBeNull()
  })
})
