import { expect, test } from "vitest"
import { planCommand } from "./command.ts"

test("a command is run with the arguments after it", () => {
  expect(planCommand(["serve", "../app"])).toEqual({
    kind: "run",
    command: "serve",
    args: ["../app"],
  })
  expect(planCommand(["sign-in", "anthropic"])).toEqual({
    kind: "run",
    command: "sign-in",
    args: ["anthropic"],
  })
  expect(planCommand(["tidy", "--dry-run"])).toMatchObject({ command: "tidy" })
})

test("no command, or help, is the help; --version the version", () => {
  expect(planCommand([])).toEqual({ kind: "help" })
  expect(planCommand(["--help"])).toEqual({ kind: "help" })
  expect(planCommand(["--version"])).toEqual({ kind: "version" })
})

test("an unknown command is refused, by its name", () => {
  expect(planCommand(["dev"])).toEqual({ kind: "refused", named: "dev" })
})
