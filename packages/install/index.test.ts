import { existsSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import {
  inMount,
  PINETRIE_MOUNT,
  pageDir,
  SCRIPT_ENTRIES,
  scriptCommand,
  thisInstall,
} from "./index.ts"

test("every registered script is a file of the repo", () => {
  for (const entry of SCRIPT_ENTRIES)
    expect(existsSync(path.join(thisInstall.root, `${entry}.ts`)), entry).toBe(
      true,
    )
})

test("a script's command is the node it is given, then its path in the install's form", () => {
  const node = ["/run/node", "--flag"]
  expect(
    scriptCommand({ root: "/repo", form: "source" }, "lanehostServer", node),
  ).toEqual([...node, "/repo/packages/lanehost/server.ts"])
  expect(
    scriptCommand({ root: "/opt/pinetrie", form: "built" }, "hop", node),
  ).toEqual([...node, "/opt/pinetrie/packages/ssh/hop.js"])
})

test("inMount keeps the form and puts the root at the mount", () => {
  expect(inMount({ form: "built" })).toEqual({
    root: PINETRIE_MOUNT,
    form: "built",
  })
})

test("this install is the repo's root, in the source form, and holds the page's package", () => {
  expect(thisInstall.form).toBe("source")
  expect(existsSync(path.join(thisInstall.root, "pnpm-workspace.yaml"))).toBe(
    true,
  )
  expect(existsSync(path.join(pageDir(thisInstall), "vite.config.ts"))).toBe(
    true,
  )
})
