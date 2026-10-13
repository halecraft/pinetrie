// S180's probe: what git, git with a git directory of its own, rg, fd and
// npm `ignore` call ignored in a tree with no repo.
//   node probe.mjs <corpus-dir> <name>   (writes results-<name>.json beside itself)
//   node probe.mjs --synthetic <dir>     (builds the synthetic tree in <dir> first)
// Needs `ignore` installed at /tmp/s180 (npm i ignore@7). The corpus must hold
// no .git or .jj: the probe makes and removes its own.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const require = createRequire("/tmp/s180/")
const ignore = require("ignore")
const here = path.dirname(new URL(import.meta.url).pathname)

// A lane's own git variables (GIT_CONFIG_COUNT and its keys, GIT_CONFIG_SYSTEM)
// name an excludes file of pine·trie's: dropped, so only `.gitignore` counts.
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_CONFIG")),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: "/nonexistent",
  XDG_CONFIG_HOME: "/nonexistent",
}
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    env,
    maxBuffer: 1 << 30,
    ...opts,
  })
const split0 = buf =>
  buf
    .toString("utf8")
    .split("\0")
    .filter(s => s !== "")
    .map(s => s.replace(/^\.\//, ""))

function synthetic(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  const w = (p, c = "x\n") => {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), c)
  }
  w(
    ".gitignore",
    [
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
      "",
    ].join("\n"),
  )
  w("sub/.gitignore", "!*.log\nlocal.txt\n/anchored-sub.txt\n")
  w("sub/inner/.gitignore", "*\n!*.md\n!*/\n")
  for (const p of [
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
  ])
    w(p)
  fs.symlinkSync("a.log", path.join(dir, "link-to-log"))
  fs.symlinkSync("normal.txt", path.join(dir, "link-to-normal"))
}

/** Every file and symlink under `root`, never following a link. */
function allFiles(root) {
  const out = []
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(root, rel), {
      withFileTypes: true,
    })) {
      const p = rel === "" ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) {
        if (p !== ".git" && p !== ".jj") walk(p)
      } else out.push(p)
    }
  }
  walk("")
  return out
}

/** npm `ignore`, one matcher per `.gitignore`, deepest last; an ignored directory hides all under it. */
function tsIgnored(root, files) {
  const matchers = new Map()
  const matcherFor = dir => {
    if (!matchers.has(dir)) {
      const f = path.join(root, dir, ".gitignore")
      matchers.set(
        dir,
        fs.existsSync(f) ? ignore().add(fs.readFileSync(f, "utf8")) : null,
      )
    }
    return matchers.get(dir)
  }
  const decide = (p, isDir) => {
    const parts = p.split("/")
    let state = false
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/")
      const m = matcherFor(dir)
      if (m === null) continue
      const rel = parts.slice(i).join("/") + (isDir ? "/" : "")
      const r = m.test(rel)
      if (r.ignored) state = true
      else if (r.unignored) state = false
    }
    return state
  }
  const dirCache = new Map()
  const dirIgnored = d => {
    if (d === "") return false
    if (!dirCache.has(d)) {
      const parent = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : ""
      dirCache.set(d, dirIgnored(parent) || decide(d, true))
    }
    return dirCache.get(d)
  }
  return files.filter(p => {
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""
    return dirIgnored(parent) || decide(p, false)
  })
}

function probe(rootArg, name) {
  const root = path.resolve(rootArg)
  const files = allFiles(root).sort()
  const all = new Set(files)
  const timed = (label, f) => {
    const t = performance.now()
    const v = f()
    return { label, ms: Math.round(performance.now() - t), v }
  }

  // The reference: a real repo, empty index, nobody's config.
  run("git", ["init", "-q", root])
  const ref = timed("git in a real repo", () =>
    split0(
      run("git", ["-C", root, "ls-files", "-z", "-o", "--exclude-standard"]),
    ),
  )
  fs.rmSync(path.join(root, ".git"), { recursive: true, force: true })
  const source = new Set(ref.v)
  const refIgnored = files.filter(f => !source.has(f))

  const gd = fs.mkdtempSync(path.join(os.tmpdir(), "s180-gd-"))
  run("git", ["init", "-q", "--bare", gd])
  const gitEnv = { ...env, GIT_DIR: gd, GIT_WORK_TREE: root }
  const ci = timed("check-ignore --no-index, own GIT_DIR", () =>
    split0(
      run("git", ["check-ignore", "--no-index", "-z", "--stdin"], {
        cwd: root,
        env: gitEnv,
        input: `${files.join("\0")}\0`,
      }),
    ),
  )
  const lsOwn = timed("ls-files -o, own GIT_DIR", () => {
    const keep = new Set(
      split0(
        run("git", ["ls-files", "-z", "-o", "--exclude-standard"], {
          cwd: root,
          env: gitEnv,
        }),
      ),
    )
    return files.filter(f => !keep.has(f))
  })
  fs.rmSync(gd, { recursive: true, force: true })

  const listed = (label, cmd, args) =>
    timed(label, () => {
      const keep = new Set(split0(run(cmd, args, { cwd: root })))
      return files.filter(f => !keep.has(f))
    })
  const rgBase = ["--files", "--hidden", "--no-config", "--null"]
  const rgToday = listed("rg as search.ts runs it", "rg", rgBase)
  const rgNoRequire = listed("rg --no-require-git", "rg", [
    ...rgBase,
    "--no-require-git",
  ])
  const rgStrict = listed(
    "rg --no-require-git, no global/exclude/parent/dot",
    "rg",
    [
      ...rgBase,
      "--no-require-git",
      "--no-ignore-global",
      "--no-ignore-exclude",
      "--no-ignore-parent",
      "--no-ignore-dot",
    ],
  )
  const fdBase = ["-H", "-0", "--color=never", "-t", "f", "-t", "l"]
  const fdToday = listed("fd as search.ts runs it", "fd", fdBase)
  const fdNoRequire = listed("fd --no-require-git", "fd", [
    ...fdBase,
    "--no-require-git",
    "--no-global-ignore-file",
    "--no-ignore-parent",
  ])
  const ts = timed("npm ignore, walked", () => tsIgnored(root, files))

  const against = r => {
    const s = new Set(r.v)
    const extra = r.v.filter(f => !refIgnored.includes(f))
    const missed = refIgnored.filter(f => !s.has(f))
    return {
      method: r.label,
      ms: r.ms,
      ignored: r.v.length,
      agrees: extra.length === 0 && missed.length === 0,
      ignoredButSource: extra.slice(0, 20),
      ignoredButSourceCount: extra.length,
      sourceButNotIgnored: missed.slice(0, 20),
      sourceButNotIgnoredCount: missed.length,
    }
  }
  const result = {
    corpus: name,
    files: files.length,
    referenceIgnored: refIgnored.length,
    referenceMs: ref.ms,
    referenceIgnoredSample: name === "synthetic" ? refIgnored : undefined,
    methods: [
      ci,
      lsOwn,
      rgToday,
      rgNoRequire,
      rgStrict,
      fdToday,
      fdNoRequire,
      ts,
    ].map(against),
  }
  void all
  fs.writeFileSync(
    path.join(here, `results-${name}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  )
  for (const m of result.methods)
    console.log(
      `${name}\t${m.agrees ? "AGREES" : "differs"}\t${m.method}\t${m.ms} ms\t+${m.ignoredButSourceCount} -${m.sourceButNotIgnoredCount}`,
    )
  console.log(
    `${name}\t${files.length} files, ${refIgnored.length} ignored, reference ${ref.ms} ms`,
  )
}

const [a, b] = process.argv.slice(2)
if (a === "--synthetic") {
  synthetic(b)
  probe(b, "synthetic")
} else probe(a, b)
