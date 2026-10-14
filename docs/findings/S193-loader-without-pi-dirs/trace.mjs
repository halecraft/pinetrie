// Preload: records every file-system call that names a path under $TRACE_ROOT,
// and writes the list to $TRACE_OUT at exit. Patches node:fs and its promises,
// then syncs the ESM named exports so `import { readFileSync } from "node:fs"`
// sees the patch too.
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import { fileURLToPath } from "node:url"

const root = process.env.TRACE_ROOT
const out = process.env.TRACE_OUT
const seen = []
const asPath = p =>
  typeof p === "string"
    ? p
    : p instanceof URL
      ? fileURLToPath(p)
      : Buffer.isBuffer(p)
        ? p.toString()
        : null
const note = (call, p) => {
  const s = asPath(p)
  if (s?.startsWith(root)) seen.push(`${call} ${s.slice(root.length)}`)
}
const SYNC = [
  "readFileSync",
  "existsSync",
  "statSync",
  "lstatSync",
  "readdirSync",
  "openSync",
  "accessSync",
  "realpathSync",
  "opendirSync",
]
const CALLBACK = [
  "readFile",
  "readdir",
  "stat",
  "lstat",
  "access",
  "open",
  "realpath",
  "opendir",
  "exists",
]
const PROMISES = [
  "readFile",
  "readdir",
  "stat",
  "lstat",
  "access",
  "open",
  "realpath",
  "opendir",
]
for (const name of SYNC) {
  const orig = fs[name]
  fs[name] = function (p, ...rest) {
    note(name, p)
    return orig.call(this, p, ...rest)
  }
}
const nativeRealpath = fs.realpathSync.native
fs.realpathSync.native = (p, ...rest) => {
  note("realpathSync", p)
  return nativeRealpath(p, ...rest)
}
for (const name of CALLBACK) {
  const orig = fs[name]
  if (typeof orig === "function")
    fs[name] = function (p, ...rest) {
      note(name, p)
      return orig.call(this, p, ...rest)
    }
}
for (const name of PROMISES) {
  const orig = fs.promises[name]
  fs.promises[name] = function (p, ...rest) {
    note(`promises.${name}`, p)
    return orig.call(this, p, ...rest)
  }
}
syncBuiltinESMExports()
process.on("exit", () => {
  if (out)
    fs.writeFileSync(
      out,
      `${JSON.stringify([...new Set(seen)].sort(), null, 1)}\n`,
    )
})
