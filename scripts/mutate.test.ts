import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { stopMessage } from "../apps/pinetrie/e2e/checks.ts"
import { planUnitRequirements } from "../apps/pinetrie/e2e/requirements.ts"
import {
  choose,
  failingChecks,
  judge,
  type Mutation,
  mutantEnv,
  mutationCommand,
  narrowedCommand,
  notHerePlace,
  planMutant,
  run as runGroup,
  SUITES,
  skippedRequirements,
  testsToList,
} from "./mutate.ts"
import type { ListedTest } from "./proofs.ts"

const run = (status: number | null, output: string, timedOut = false) => ({
  status,
  output,
  timedOut,
})

describe("judge: what a mutant's run proves", () => {
  test("a passing run means the check did not notice: SURVIVED", () => {
    expect(judge(run(0, "Tests 5 passed"), undefined)).toBe("survived")
  })
  test("a mutant that does not load proves nothing: BROKEN, even if it exits non-zero", () => {
    expect(judge(run(1, "SyntaxError: Unexpected token"), undefined)).toBe(
      "broken",
    )
  })
  test("a failing run with no expectation is KILLED", () => {
    expect(judge(run(1, " FAIL  some test"), undefined)).toBe("killed")
  })
  test("with an expectation, only the intended check failing counts", () => {
    const out = "  PASS  one\n  FAIL  the colour check\n"
    expect(judge(run(1, out), "colour check")).toBe("killed")
    expect(judge(run(1, out), "alignment check")).toBe("elsewhere")
  })
  test("the expected text must be on a failing line, not anywhere in the output", () => {
    const out = "  PASS  the colour check\n  FAIL  something else\n"
    expect(judge(run(1, out), "colour check")).toBe("elsewhere")
  })
  test("a hang is a failure: KILLED", () => {
    expect(judge(run(null, "", true), "anything")).toBe("killed")
  })
  test("a suite stopped at the expected check is KILLED by it", () => {
    const label = "the colour check (red)"
    // What a stopped suite prints: its lines, then Node's report of the
    // uncaught error `ok()` throws.
    const out = [
      "  PASS  one",
      `  FAIL  ${label}`,
      "  STOP  at the check PINETRIE_STOP_AT names",
      "file:///suite/checks.ts:55",
      "        throw new Error(stopMessage(label))",
      "        ^",
      "",
      `Error: ${stopMessage(label)}`,
      "    at Object.ok (file:///suite/checks.ts:55:15)",
    ].join("\n")
    expect(judge(run(1, out), "colour check")).toBe("killed")
  })
})

describe("choose: the mutations a filter names", () => {
  const m = (name: string): Mutation => ({
    name,
    file: "f",
    from: "a",
    to: "b",
    command: ["true"],
  })
  const list = [m("accepted proposed changes"), m("a huge diff")]
  test("every one without a filter; those whose name contains it with one", () => {
    expect(choose(list, undefined)).toEqual(list)
    expect(choose(list, "huge")).toEqual([list[1]])
  })
  test("a filter that names nothing is refused, not run as nothing", () => {
    expect(choose(list, "the record keeps")).toBe(
      `no mutation's name contains "the record keeps"`,
    )
    expect(choose([], undefined)).toBe("the list has no mutations")
  })
})

describe("failingChecks: the lines that name a failing check", () => {
  test("a suite's FAIL, Vitest's ×, and an assertion error; never a pass", () => {
    const out = [
      "  PASS  the colour check",
      "  FAIL  the alignment check",
      "   × planMessage > a busy lane holds 3ms",
      "AssertionError: expected 1 to be 2",
      " ✓ something else",
    ].join("\n")
    expect(failingChecks(out)).toEqual([
      "  FAIL  the alignment check",
      "   × planMessage > a busy lane holds 3ms",
      "AssertionError: expected 1 to be 2",
    ])
  })
  test("a mark Vitest coloured still names its check", () => {
    const out =
      "\x1b[31m   \x1b[31m×\x1b[31m planChat > a busy lane holds\x1b[39m"
    expect(failingChecks(out)).toEqual(["   × planChat > a busy lane holds"])
  })
})

describe("narrowedCommand: a unit mutant runs its expected test", () => {
  const vitest = (...paths: string[]) => [
    "pnpm",
    "exec",
    "vitest",
    "run",
    ...paths,
  ]
  const tests: readonly ListedTest[] = [
    { file: "packages/jj/repo.test.ts", name: "a lane > accepts" },
    { file: "packages/jj/repo.test.ts", name: "a lane > refreshes" },
    { file: "packages/jj/owner.test.ts", name: "the owner accepts" },
    { file: "packages/rules/card.test.ts", name: "a card accepts" },
    { file: "packages/rules/a (b).test.ts", name: "a [card] (one)" },
  ]
  test("narrowed to the files holding the expected test, and to its name", () => {
    expect(narrowedCommand(vitest("packages/jj"), "accepts", tests)).toEqual(
      vitest(
        "packages/jj/owner.test.ts",
        "packages/jj/repo.test.ts",
        "--testNamePattern=accepts",
      ),
    )
  })
  test("only the files under the command's paths", () => {
    expect(
      narrowedCommand(vitest("packages/rules/card"), "accepts", tests),
    ).toEqual(
      vitest("packages/rules/card.test.ts", "--testNamePattern=accepts"),
    )
    expect(narrowedCommand(vitest(), "a lane > refreshes", tests)).toEqual(
      vitest(
        "packages/jj/repo.test.ts",
        "--testNamePattern=a lane > refreshes",
      ),
    )
  })
  test("an expect with regex characters is matched literally", () => {
    const command = narrowedCommand(
      vitest("packages/rules"),
      "[card] (one)",
      tests,
    )
    const pattern = command.at(-1)?.replace("--testNamePattern=", "") ?? ""
    expect(new RegExp(pattern).test("a [card] (one)")).toBe(true)
    expect(new RegExp(pattern).test("a c one")).toBe(false)
  })
  test("a command with flags, or not vitest's run, runs as written", () => {
    const flagged = [...vitest("packages/jj"), "-t", "accepts"]
    expect(narrowedCommand(flagged, "accepts", tests)).toBe(flagged)
    const tsc = ["pnpm", "exec", "tsc", "--noEmit"]
    expect(narrowedCommand(tsc, "accepts", tests)).toBe(tsc)
  })
  test("an expect no listed test's name holds, or none, runs the command as written", () => {
    const command = vitest("packages/jj")
    expect(narrowedCommand(command, "owner.test.ts", tests)).toBe(command)
    expect(narrowedCommand(command, "nothing like it", tests)).toBe(command)
    expect(narrowedCommand(command, undefined, tests)).toBe(command)
  })
})

describe("testsToList: what one vitest list collects for a batch", () => {
  const unit = (command: string[], expect?: string): Mutation => ({
    name: "m",
    file: "f",
    from: "a",
    to: "b",
    command,
    ...(expect === undefined ? {} : { expect }),
  })
  const vitest = (...paths: string[]) => [
    "pnpm",
    "exec",
    "vitest",
    "run",
    ...paths,
  ]
  test("the paths of the commands that can narrow, each once", () => {
    expect(
      testsToList([
        unit(vitest("packages/jj"), "x"),
        unit(vitest("packages/rules", "packages/jj"), "y"),
        unit(vitest("packages/core")),
        unit(["pnpm", "exec", "tsc"], "z"),
      ]),
    ).toEqual(["packages/jj", "packages/rules"])
  })
  test("every file for a bare run; nothing to list when none can narrow", () => {
    expect(
      testsToList([unit(vitest("packages/jj"), "x"), unit(vitest(), "y")]),
    ).toEqual([])
    expect(
      testsToList([
        unit(vitest("packages/core")),
        {
          name: "s",
          file: "f",
          from: "a",
          to: "b",
          suite: "host",
          scenario: "boot",
          expect: "c",
        },
      ]),
    ).toBeNull()
  })
})

describe("planMutant: a command must pass before its mutant runs", () => {
  const command = ["pnpm", "exec", "vitest", "run", "a.test.ts"]
  test("a command that passed with nothing mutated runs the mutant", () => {
    expect(planMutant(command, { kind: "passed" })).toEqual({
      kind: "run",
      command,
    })
  })
  test("a command that failed with nothing mutated runs no mutant: BASELINE", () => {
    expect(
      planMutant(command, { kind: "failed", failing: ["× a > b"] }),
    ).toEqual({ kind: "baseline", failing: ["× a > b"] })
  })
  test("a command whose tests all skipped here runs no mutant here: NOT-HERE", () => {
    expect(
      planMutant(command, {
        kind: "skipped",
        requirements: ["btrfs-checkout"],
      }),
    ).toEqual({ kind: "not-here", requirements: ["btrfs-checkout"] })
  })
})

describe("a mutant whose tests skip here", () => {
  const report = (status: string) => ({
    testResults: [
      {
        name: "/r/packages/x/x.test.ts",
        assertionResults: [
          { fullName: "on btrfs a take", status, tags: ["btrfs-checkout"] },
          { fullName: "plain other", status: "passed", tags: [] },
        ],
      },
    ],
  })
  test("is told from the report: its expected tests all skipped, with their tags", () => {
    expect(skippedRequirements(report("skipped"), "/r", "a take")).toEqual([
      "btrfs-checkout",
    ])
    expect(skippedRequirements(report("passed"), "/r", "a take")).toBeNull()
    expect(skippedRequirements(report("skipped"), "/r", "nothing")).toBeNull()
  })
  test("runs in a lane where the place plans one, else reads why it runs nowhere", () => {
    const mac = planUnitRequirements({
      platform: "darwin",
      checkoutOnBtrfs: false,
      hasFlock: false,
      laneRuntime: null,
    })
    expect(notHerePlace(["btrfs-checkout"], mac)).toEqual({ kind: "lane" })
    const noLane = planUnitRequirements({
      platform: "darwin",
      checkoutOnBtrfs: false,
      hasFlock: false,
      laneRuntime: "Docker does not answer",
    })
    expect(notHerePlace(["btrfs-checkout"], noLane)).toEqual({
      kind: "nowhere",
      why: "needs the checkout on btrfs, and no lane can be made here: Docker does not answer",
    })
  })
})

describe("mutantEnv: a mutant names the check its suite stops at", () => {
  test("with an expectation, PINETRIE_STOP_AT is set and the rest kept", () => {
    const base = { PATH: "/bin", HOME: "/root" }
    expect(mutantEnv(base, { expect: "a check" })).toEqual({
      PATH: "/bin",
      HOME: "/root",
      PINETRIE_STOP_AT: "a check",
    })
  })
  test("a suite mutation runs only its scenario: PINETRIE_SCENARIO is set", () => {
    expect(
      mutantEnv({ PATH: "/bin" }, { expect: "a check", scenario: "boot" }),
    ).toEqual({
      PATH: "/bin",
      PINETRIE_STOP_AT: "a check",
      PINETRIE_SCENARIO: "boot",
    })
  })
  test("without either, the environment is the parent's", () => {
    const base = { PATH: "/bin" }
    expect(mutantEnv(base, {})).toBe(base)
  })
})

test("SUITES: each suite's scenario directory exists, and its command runs it", () => {
  for (const suite of Object.values(SUITES)) {
    expect(existsSync(path.join(import.meta.dirname, "..", suite.dir))).toBe(
      true,
    )
    expect(suite.command.slice(0, 2)).toEqual(["pnpm", "run"])
  }
  expect(
    mutationCommand({
      name: "x",
      file: "f",
      from: "a",
      to: "b",
      suite: "browser",
      scenario: "boot",
      expect: "c",
    }),
  ).toEqual(SUITES.browser.command)
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
