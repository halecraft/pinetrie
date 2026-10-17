import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { laneIgnores } from "@pinetrie/lanes"
import { afterEach, expect, test } from "vitest"
import { scanFolder } from "./scan.ts"

let root = ""
afterEach(async () => {
  if (root !== "") await rm(root, { recursive: true, force: true })
})

/** A folder of `files`: a value null is a directory, a `->` a symlink. */
async function folder(files: Record<string, string | null>) {
  root = await mkdtemp(path.join(tmpdir(), "pinetrie-scan-"))
  for (const [p, v] of Object.entries(files)) {
    const at = path.join(root, p)
    await mkdir(path.dirname(at), { recursive: true })
    if (v === null) await mkdir(at, { recursive: true })
    else if (v.startsWith("->")) await symlink(v.slice(2), at)
    else await writeFile(at, v)
  }
  return root
}

test("scanFolder stamps every source path, a .gitignore's ignored ones and pine·trie's own left out", async () => {
  const at = await folder({
    ".gitignore": "node_modules/\n*.log\n",
    "a.txt": "a",
    "debug.log": "x",
    "node_modules/dep/index.js": "x",
    "src/.gitignore": "gen/\n",
    "src/b.ts": "b",
    "src/gen/out.js": "x",
    ".jj/repo": "x",
    ".pnpm-store/x": "x",
    "shared/notes.md": "x",
    empty: null,
  })
  const scanned = await scanFolder({
    root: at,
    own: laneIgnores(["shared"]),
  })
  expect([...scanned.keys()].sort()).toEqual([
    ".gitignore",
    "a.txt",
    "src/.gitignore",
    "src/b.ts",
  ])
  expect(scanned.get("a.txt")).toMatchObject({ kind: "file", size: 1 })
})

test("scanFolder stamps a symlink by its target, never following it", async () => {
  const at = await folder({ "real/x.txt": "x", link: "->real" })
  const scanned = await scanFolder({ root: at, own: "" })
  expect(scanned.get("link")).toMatchObject({
    kind: "symlink",
    target: "real",
  })
  expect([...scanned.keys()].sort()).toEqual(["link", "real/x.txt"])
})

test("scanFolder never enters an accept's reserved names at the root, and stamps them deeper down", async () => {
  const at = await folder({
    ".pinetrie-accept-1/a.txt": "x",
    ".pinetrie-aside-1/a.txt": "x",
    "d/.pinetrie-aside-1": "x",
  })
  const scanned = await scanFolder({ root: at, own: "" })
  expect([...scanned.keys()]).toEqual(["d/.pinetrie-aside-1"])
})
