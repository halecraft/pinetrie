import { threadIdFor } from "@pinetrie/core"
import fc from "fast-check"
import { describe, expect, test } from "vitest"
import {
  commandProgram,
  counterRise,
  lanesChanged,
  lanesMeasured,
  treatmentChanges,
} from "./measurements.ts"

test("commandProgram skips cd, export, assignments, env and time to the program", () => {
  expect(
    [
      "cd packages/x && pnpm test",
      "export CI=1; FOO=bar env -i NODE_ENV=test time node scripts/x.ts --flag",
      "./node_modules/.bin/vitest run a.test.ts",
      "cd /tmp",
      "",
      "(cd a && make)",
      "env -u HOME -C /tmp nice -n 10 cargo build",
    ].map(commandProgram),
  ).toEqual(["pnpm", "node", "vitest", null, null, "make", "cargo"])
})

test("commandProgram never returns an argument", () => {
  const WORD = fc.stringMatching(/^[a-z][a-z0-9_.-]{0,8}$/)
  const NOISE = fc.oneof(
    WORD.map(w => `cd ${w}`),
    WORD.map(w => `export ${w.toUpperCase().replace(/[.-]/g, "_")}=1`),
  )
  fc.assert(
    fc.property(
      fc.array(NOISE, { maxLength: 3 }),
      fc.array(
        WORD.map(w => `${w.toUpperCase().replace(/[.-]/g, "_")}=x`),
        { maxLength: 2 },
      ),
      fc.subarray(["env", "env -u NAME", "time", "nice -n 5"]),
      WORD.filter(
        w =>
          ![
            "cd",
            "export",
            "env",
            "time",
            "exec",
            "nice",
            "nohup",
            "command",
            "pushd",
            "popd",
            "set",
          ].includes(w),
      ),
      fc.array(WORD, { maxLength: 4 }),
      (noise, assignments, prefixes, program, args) => {
        const statement = [...prefixes, ...assignments, program, ...args].join(
          " ",
        )
        const command = [...noise, statement].join(" && ")
        expect(commandProgram(command)).toBe(program)
      },
    ),
  )
})

describe("rows from a sample and a plan", () => {
  const lane = threadIdFor("t-1")
  const counters = {
    refaultAnon: 10,
    refaultFile: 100,
    stallSomeUs: 1000,
    stallFullUs: 500,
  }

  test("the counters' rise since the last sample, and none across a reset", () => {
    expect(
      counterRise(counters, {
        ...counters,
        refaultFile: 160,
        stallSomeUs: 1300,
      }),
    ).toEqual({
      refaultAnon: 0,
      refaultFile: 60,
      stallSomeUs: 300,
      stallFullUs: 0,
    })
    expect(counterRise(null, counters)).toBeNull()
    expect(counterRise(counters, { ...counters, refaultAnon: 1 })).toBeNull()
  })

  test("a lane is kept only when its memory moved by a MiB or its program changed", () => {
    const MiB = 1024 ** 2
    const sample = {
      lane,
      current: 600 * MiB,
      anon: 100 * MiB,
      file: 500 * MiB,
      limit: null,
      oomKills: 0,
      pressure: null,
    }
    const [kept] = lanesMeasured([sample], () => null)
    if (kept === undefined) throw new Error("no lane")
    const before = new Map([[lane, kept]])
    expect(
      lanesChanged(
        before,
        lanesMeasured([{ ...sample, anon: sample.anon + 1000 }], () => null),
      ),
    ).toEqual([])
    expect(
      lanesChanged(
        before,
        lanesMeasured([sample], () => "pnpm"),
      ).map(l => l.program),
    ).toEqual(["pnpm"])
  })

  test("a treatment changed is from and to, a lane not held being normal", () => {
    const b = threadIdFor("t-2")
    expect(
      treatmentChanges(
        [{ lane, treatment: { kind: "waiting-to-start" } }],
        [{ lane: b, treatment: { kind: "paused" } }],
      ),
    ).toEqual([
      { lane, from: "waiting-to-start", to: "normal" },
      { lane: b, from: "normal", to: "paused" },
    ])
  })
})
