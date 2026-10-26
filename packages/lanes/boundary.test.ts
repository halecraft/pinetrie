// `@pinetrie/lanes` runs no jj: a lane's history is its project's adapter's
// (`history-port.ts`), and jj's adapter is `@pinetrie/jj`. Read from the
// source text: a jj command is a string, which no import shows.

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"

const DIR = import.meta.dirname

/** Each source file of the package, tests aside. */
const sources = (): string[] =>
  readdirSync(DIR, { recursive: true, encoding: "utf8" })
    .filter(
      f =>
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        !f.split(path.sep).includes("node_modules"),
    )
    .sort()

/**
 * Where a file names jj as a command: the first word of an argument list
 * (`["jj", …]`, `run("jj", …)`, `inLane("jj", …)`) or of a shell command.
 */
const JJ_COMMAND = /(?:[[(]\s*"jj"\s*,)|(?:(?:^|[;&|{`'"]\s*)jj\s+-)/m

/**
 * The one exemption: the image check asks the host's jj its version, which
 * the lane's jj is pinned to when the host has one. It runs jj on no repo.
 */
const EXEMPT = new Map([["image.ts", ['run("jj", ["--version"])']]])

test("@pinetrie/lanes names jj as a command nowhere but its image check", () => {
  const naming = sources().flatMap(file => {
    let text = readFileSync(path.join(DIR, file), "utf8")
    const exempt = EXEMPT.get(file)
    if (exempt !== undefined) {
      // The scan sees the exemption, so it sees jj where it is.
      expect(JJ_COMMAND.test(text)).toBe(true)
      for (const words of exempt) text = text.replace(words, "")
    }
    return JJ_COMMAND.test(text) ? [file] : []
  })
  expect(naming).toEqual([])
})

test("@pinetrie/lanes exports none of jj's names", async () => {
  const moved = [
    "bookmarkName",
    "readLaneBookmark",
    "commitTurn",
    "conflictsIn",
    "copyFacts",
    "DEFAULT_REPO",
    "fetchById",
    "forkConfig",
    "jjIn",
    "JJ_FLAGS",
    "laneBase",
    "laneJj",
    "laneTipName",
    "mergeUpdate",
    "proposedBookmark",
    "oldNamesOnDisk",
    "planBaseCheckout",
    "planBundle",
    "planForkSetup",
    "planJoins",
    "planMerge",
    "planOldNamesOnDisk",
    "planTurnCommit",
    "prepareProjectDir",
    "prepareShared",
    "repoConfig",
    "stackBookmark",
  ]
  // Every module's exports, since the index holds only what is imported
  // through it.
  const modules = sources().filter(f => !f.includes(path.sep))
  const exported = new Set(
    (await Promise.all(modules.map(f => import(path.join(DIR, f))))).flatMap(
      m => Object.keys(m),
    ),
  )
  expect(moved.filter(name => exported.has(name))).toEqual([])
})
