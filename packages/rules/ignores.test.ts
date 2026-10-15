import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { ignoreDirs, ignoredPaths } from "./ignores.ts"

/** The hard cases git's ignore rules have, as files and their contents. */
const TREE: Readonly<Record<string, string>> = {
  ".gitignore": [
    "# comment",
    "*.log",
    "!keep.log",
    "/anchored.txt",
    "build/",
    "!build/keep.txt",
    "**/deep/**/gen",
    "dist",
    "docs/**/*.tmp",
    "\\#hash.txt",
    "trailing.txt   ",
    "spaced\\ name.txt",
    "*.[oa]",
    "/sub/only-root-sub.txt",
    "cache*/",
    "!cache-keep/",
    "node_modules",
    ".env*",
    "!.env.example",
    "gen-dir/",
    "!.plans/keep.md",
    "!kept.own",
    "",
  ].join("\n"),
  "sub/.gitignore": "!*.log\nlocal.txt\n/anchored-sub.txt\n",
  "sub/inner/.gitignore": "*\n!*.md\n!*/\n",
  // Inside an ignored directory: git never reads it.
  "build/.gitignore": "!x\n",
  ...Object.fromEntries(
    [
      "a.log",
      "keep.log",
      "sub/a.log",
      "sub/deeper/b.log",
      "anchored.txt",
      "sub/anchored.txt",
      "build/x",
      "build/keep.txt",
      "sub/build/y",
      "a/deep/b/c/gen",
      "a/deep/gen",
      "deep/x/gen/file",
      "dist",
      "x/dist/y",
      "docs/a/b/c.tmp",
      "docs/c.tmp",
      "#hash.txt",
      "trailing.txt",
      "spaced name.txt",
      "foo.o",
      "foo.a",
      "sub/only-root-sub.txt",
      "only-root-sub.txt",
      "cache1/x",
      "cache-keep/x",
      "node_modules/p/i.js",
      "sub/node_modules/q",
      ".env",
      ".env.local",
      ".env.example",
      "sub/local.txt",
      "sub/anchored-sub.txt",
      "sub/x/anchored-sub.txt",
      "sub/inner/a.txt",
      "sub/inner/a.md",
      "sub/inner/d/e.md",
      "sub/inner/d/e.txt",
      "normal.txt",
      "ünï.txt",
      "new\nline.txt",
      ".hidden/file",
      "a/gen-dir/f",
      "b/gen-dir",
      ".plans/keep.md",
      ".plans/a.md",
      ".pnpm-store/v10/x",
      "kept.own",
      "dropped.own",
    ].map(p => [p, "x\n"]),
  ),
}

/** pine·trie's own patterns, as a lane's excludes file holds them. */
const OWN = "/.pnpm-store/\n/.plans/\n*.own\n"

/** Paths asked about that are directories, beside the files. */
const DIRS = ["a/gen-dir", "build", "cache1", "sub/inner/d", ".plans"]

const root = mkdtempSync(path.join(tmpdir(), "pinetrie-ignores-"))
const tree = path.join(root, "tree")
for (const [p, text] of Object.entries(TREE)) {
  mkdirSync(path.dirname(path.join(tree, p)), { recursive: true })
  writeFileSync(path.join(tree, p), text)
}
symlinkSync("a.log", path.join(tree, "link-to-log"))
symlinkSync("normal.txt", path.join(tree, "link-to-normal"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const asked = [
  ...Object.keys(TREE),
  "link-to-log",
  "link-to-normal",
  ...DIRS,
].sort()

/**
 * What git says of `asked`: `check-ignore` with a git directory of its own
 * outside the tree, the person's and the machine's config off, and `OWN` as
 * its excludes file.
 */
function gitIgnored(): ReadonlySet<string> {
  const gitDir = path.join(root, "git")
  const own = path.join(root, "own")
  writeFileSync(own, OWN)
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  )
  const git = (args: string[], input?: string) =>
    spawnSync("git", args, {
      cwd: tree,
      input,
      encoding: "utf8",
      env: {
        ...env,
        GIT_DIR: gitDir,
        GIT_WORK_TREE: tree,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    })
  if (!existsSync(gitDir))
    spawnSync("git", ["init", "-q", "--bare", gitDir], {
      env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    })
  const ran = git(
    [
      "-c",
      `core.excludesFile=${own}`,
      "check-ignore",
      "--no-index",
      "-z",
      "--stdin",
    ],
    `${asked.join("\0")}\0`,
  )
  if (ran.status !== 0 && ran.status !== 1) throw new Error(ran.stderr)
  return new Set(ran.stdout.split("\0").filter(p => p !== ""))
}

const files = ignoreDirs(asked).flatMap(dir => {
  const file = path.join(tree, dir, ".gitignore")
  return existsSync(file) ? [{ dir, text: readFileSync(file, "utf8") }] : []
})
const ours = ignoredPaths({
  files,
  own: OWN,
  paths: asked,
  dirs: new Set(DIRS),
})

describe("ignoredPaths", () => {
  test("agrees with git on every path", () => {
    const theirs = gitIgnored()
    expect(asked.filter(p => ours.has(p) !== theirs.has(p))).toEqual([])
    // The fixture exercises both answers.
    expect(theirs.size).toBeGreaterThan(20)
    expect(asked.length - theirs.size).toBeGreaterThan(15)
  })
  test("a deeper negation does not re-include a path under an ignored directory", () => {
    expect(ours.has("build/x")).toBe(true)
    expect(ours.has("build/keep.txt")).toBe(true)
    expect(ours.has(".plans/keep.md")).toBe(true)
  })
  test("a pattern ending in / ignores a directory of that name, not a file", () => {
    expect(ours.has("a/gen-dir")).toBe(true)
    expect(ours.has("b/gen-dir")).toBe(false)
  })
  test("pine·trie's own patterns ignore what no .gitignore re-includes", () => {
    expect(ours.has(".pnpm-store/v10/x")).toBe(true)
    expect(ours.has(".plans/a.md")).toBe(true)
    expect(ours.has("dropped.own")).toBe(true)
    expect(ours.has("kept.own")).toBe(false)
  })
})

test("ignoreDirs: each path's ancestors, root first, once each", () => {
  expect(ignoreDirs(["a/b/c.txt", "a/d.txt", "e.txt"])).toEqual([
    "",
    "a",
    "a/b",
  ])
})
