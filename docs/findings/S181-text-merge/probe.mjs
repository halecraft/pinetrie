// S181's probe: `git merge-file` against npm `node-diff3` on the paths both
// sides changed in every two-parent merge of a git repo; and what counts as
// text, by NUL against UTF-8, over the files of a tree.
//   node probe.mjs merges <bare repo>     (writes results-merges.json)
//   node probe.mjs text <dir>...          (writes results-text.json)
// Needs `node-diff3` installed at /tmp/s180 (npm i node-diff3@3).
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const require = createRequire("/tmp/s180/")
const { diff3Merge } = require("node-diff3")
const here = path.dirname(new URL(import.meta.url).pathname)
const git = (repo, args, input) =>
  execFileSync("git", ["--git-dir", repo, ...args], {
    maxBuffer: 1 << 30,
    input,
  })

/** Blobs by id, read through one `cat-file --batch`. */
function blobs(repo, ids) {
  const out = new Map()
  const unique = [...new Set(ids)]
  for (let i = 0; i < unique.length; i += 2000) {
    const chunk = unique.slice(i, i + 2000)
    const buf = git(repo, ["cat-file", "--batch"], `${chunk.join("\n")}\n`)
    let at = 0
    for (const id of chunk) {
      const nl = buf.indexOf(10, at)
      const size = Number(buf.subarray(at, nl).toString().split(" ")[2])
      out.set(id, buf.subarray(nl + 1, nl + 1 + size))
      at = nl + 1 + size + 1
    }
  }
  return out
}

const hasNul = b => b.includes(0)
const utf8 = new TextDecoder("utf-8", { fatal: true })
const isUtf8 = b => {
  try {
    utf8.decode(b)
    return true
  } catch {
    return false
  }
}

/** node-diff3, line by line, false conflicts (both sides alike) taken. */
function jsMerge(o, a, b) {
  const split = s => s.toString("utf8").split("\n")
  const blocks = diff3Merge(split(a), split(o), split(b), {
    excludeFalseConflicts: true,
  })
  const conflicts = blocks.filter(x => x.conflict).length
  if (conflicts > 0) return { clean: false, conflicts }
  return {
    clean: true,
    result: Buffer.from(blocks.flatMap(x => x.ok).join("\n"), "utf8"),
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "s181-"))
function gitMerge(o, a, b) {
  const [fo, fa, fb] = ["o", "a", "b"].map(n => path.join(tmp, n))
  fs.writeFileSync(fo, o)
  fs.writeFileSync(fa, a)
  fs.writeFileSync(fb, b)
  const r = spawnSync("git", ["merge-file", "-p", fa, fo, fb], {
    maxBuffer: 1 << 30,
  })
  if (r.status < 0 || r.status === null || r.status > 127)
    throw new Error(`merge-file: ${r.stderr}`)
  return r.status === 0
    ? { clean: true, result: r.stdout }
    : { clean: false, conflicts: r.status }
}

function changed(repo, from, to) {
  const out = new Map()
  const raw = git(repo, ["diff-tree", "-r", "-z", "--no-renames", from, to])
    .toString("utf8")
    .split("\0")
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const [, , , dst] = raw[i].split(" ")
    out.set(raw[i + 1], dst)
  }
  return out
}

function merges(repo) {
  const rows = git(repo, [
    "rev-list",
    "--all",
    "--min-parents=2",
    "--max-parents=2",
    "--parents",
  ])
    .toString()
    .trim()
    .split("\n")
  const cases = []
  let multiBase = 0
  for (const row of rows) {
    const [, p1, p2] = row.split(" ")
    const bases = git(repo, ["merge-base", "--all", p1, p2])
      .toString()
      .trim()
      .split("\n")
    if (bases.length !== 1) {
      multiBase++
      continue
    }
    const [base] = bases
    const ours = changed(repo, base, p1)
    const theirs = changed(repo, base, p2)
    for (const [p, a] of ours) {
      const b = theirs.get(p)
      if (b === undefined || a === b) continue
      const zero = /^0+$/
      if (zero.test(a) || zero.test(b)) continue // a deletion: no text merge
      cases.push({ merge: row.slice(0, 12), path: p, a, b, base, o: null })
    }
  }
  return { rows: rows.length, multiBase, cases }
}

function blobAt(repo, base, p) {
  const r = spawnSync("git", ["--git-dir", repo, "rev-parse", `${base}:${p}`])
  return r.status === 0 ? r.stdout.toString().trim() : null
}

if (process.argv[2] === "merges") {
  const repo = process.argv[3]
  const { rows, multiBase, cases } = merges(repo)
  for (const c of cases) c.o = blobAt(repo, c.base, c.path)
  const data = blobs(
    repo,
    cases.flatMap(c => [c.a, c.b, c.o].filter(Boolean)),
  )
  const empty = Buffer.alloc(0)
  let gitMs = 0
  let jsMs = 0
  const tally = {
    paths: 0,
    binary: 0,
    bothClean: 0,
    bothConflict: 0,
    cleanSameBytes: 0,
    cleanDifferentBytes: 0,
    onlyGitClean: 0,
    onlyJsClean: 0,
  }
  const disagreements = []
  for (const c of cases) {
    const o = c.o === null ? empty : data.get(c.o)
    const a = data.get(c.a)
    const b = data.get(c.b)
    tally.paths++
    if ([o, a, b].some(hasNul)) {
      tally.binary++
      continue
    }
    let t = performance.now()
    const g = gitMerge(o, a, b)
    gitMs += performance.now() - t
    t = performance.now()
    const j = jsMerge(o, a, b)
    jsMs += performance.now() - t
    if (g.clean && j.clean) {
      tally.bothClean++
      if (Buffer.compare(g.result, j.result) === 0) tally.cleanSameBytes++
      else {
        tally.cleanDifferentBytes++
        disagreements.push({ ...c, kind: "clean, different bytes" })
      }
    } else if (!g.clean && !j.clean) tally.bothConflict++
    else if (g.clean) {
      tally.onlyGitClean++
      disagreements.push({ ...c, kind: "git clean, js conflict" })
    } else {
      tally.onlyJsClean++
      disagreements.push({ ...c, kind: "js clean, git conflict" })
    }
  }
  const merged = tally.paths - tally.binary
  const result = {
    merges: rows,
    skippedWithSeveralBases: multiBase,
    tally,
    msPerPath: {
      gitMergeFile: +(gitMs / merged).toFixed(2),
      nodeDiff3: +(jsMs / merged).toFixed(2),
    },
    disagreements: disagreements.map(
      ({ merge, path: p, kind, base, a, b, o }) => ({
        merge,
        path: p,
        kind,
        base,
        o,
        a,
        b,
      }),
    ),
  }
  fs.writeFileSync(
    path.join(here, "results-merges.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  )
  console.log(
    JSON.stringify({ ...result, disagreements: disagreements.length }, null, 2),
  )
} else if (process.argv[2] === "text") {
  const byExt = new Map()
  const differ = []
  let files = 0
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== ".git" && e.name !== ".jj") walk(p)
      } else if (e.isFile()) {
        files++
        const b = fs.readFileSync(p)
        const nul = hasNul(b)
        const u = isUtf8(b)
        const ext = path.extname(e.name).toLowerCase() || "(none)"
        const row = byExt.get(ext) ?? {
          files: 0,
          nul: 0,
          notUtf8: 0,
          differ: 0,
        }
        row.files++
        if (nul) row.nul++
        if (!u) row.notUtf8++
        if (nul === u) {
          // NUL-free but not UTF-8, or UTF-8 holding a NUL: the rules differ.
          row.differ++
          differ.push({ path: p, size: b.length, nul, utf8: u })
        }
        byExt.set(ext, row)
      }
    }
  }
  for (const d of process.argv.slice(3)) walk(d)
  const result = {
    files,
    differ: differ.length,
    differByExtension: Object.fromEntries(
      [...byExt]
        .filter(([, r]) => r.differ > 0)
        .sort((x, y) => y[1].differ - x[1].differ),
    ),
    differSample: differ.slice(0, 60),
  }
  fs.writeFileSync(
    path.join(here, "results-text.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  )
  console.log(
    JSON.stringify({ ...result, differSample: differ.slice(0, 15) }, null, 2),
  )
}
