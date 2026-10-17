import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  exportedFunctionNames,
  isLeaningName,
  readExportedFunctions,
} from "./function-names.ts"

const ROOT = path.join(import.meta.dirname, "..")

describe("exportedFunctionNames", () => {
  test("exported declarations, arrows and function expressions, each once; no value, no local", () => {
    expect(
      exportedFunctionNames(
        "a.ts",
        [
          "export function planA(x: number): number",
          "export function planA(x: number) { return x }",
          "export async function readB() {}",
          "export const c = (x: number) => x",
          "export const d = function () {}",
          "export const LIMIT = 3",
          "function local() {}",
          "const alsoLocal = () => 1",
        ].join("\n"),
      ),
    ).toEqual(["planA", "readB", "c", "d"])
  })
})

describe("isLeaningName", () => {
  test("a bare Of, To or At at the end leans; one inside a word does not", () => {
    expect(
      [
        "laneOf",
        "moveTo",
        "fileAt",
        "threadLane",
        "isAtTop",
        "Of",
        "photo",
      ].map(isLeaningName),
    ).toEqual([true, true, true, false, false, false, false])
  })
})

test("no exported function's name ends in a bare Of, To or At", () => {
  expect(
    readExportedFunctions(ROOT).filter(f => isLeaningName(f.name)),
  ).toEqual([])
})
