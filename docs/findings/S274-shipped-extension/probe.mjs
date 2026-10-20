// S274 probe. Loads `pi-anthropic-auth` through an installed pine·trie's own
// `openLoader`, `openRuntime` and `registerProviders`, resolving the
// extension's folder from the install's `packages/pi/`, and prints what
// reached pi and what a request on `anthropic` carried, as JSON. Run by
// run.sh with ROOT (the installed package's folder) and TREE (a fake home).
import fs from "node:fs"
import { createRequire, findPackageJSON } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

// pnpm links a global package into place; Node runs a module from its real path.
const ROOT = fs.realpathSync(process.env.ROOT)
const TREE = process.env.TREE
const CONFIG = path.join(TREE, ".config", "pinetrie")
const DATA = path.join(TREE, ".local", "share", "pinetrie")
const PROJ = path.join(TREE, "proj")
const EXT_NAME = "@gotgenes/pi-anthropic-auth"

const put = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
fs.rmSync(TREE, { recursive: true, force: true })
put(path.join(CONFIG, "pinetrie.json"), "{}\n")
put(path.join(PROJ, "README.md"), "probe\n")
put(
  path.join(DATA, "auth.json"),
  JSON.stringify({
    anthropic: {
      type: "oauth",
      access: "sk-ant-oat01-PROBE",
      refresh: "sk-ant-ort01-PROBE",
      expires: 4_000_000_000_000,
    },
  }),
)

// ── the network, replaced ───────────────────────────────────────────────────
const requests = []
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url
  const headers = Object.fromEntries(
    new Headers(init.headers ?? input.headers ?? {}),
  )
  let body = null
  try {
    body = typeof init.body === "string" ? JSON.parse(init.body) : null
  } catch {}
  requests.push({
    url,
    authorization: (headers.authorization ?? "").slice(0, 32),
    userAgent: headers["user-agent"] ?? null,
    anthropicBeta: headers["anthropic-beta"] ?? null,
    system: Array.isArray(body?.system)
      ? body.system.map(b => String(b.text).slice(0, 120))
      : (body?.system ?? null),
  })
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "probe" },
    }),
    { status: 401, headers: { "content-type": "application/json" } },
  )
}

// ── the extension, resolved as `@pinetrie/pi` would ─────────────────────────
const piDir = path.join(ROOT, "packages", "pi")
const fromPi = createRequire(path.join(piDir, "deep.js"))
let extDir = null
let resolveError = null
try {
  extDir = path.dirname(fromPi.resolve(`${EXT_NAME}/package.json`))
} catch (e) {
  resolveError = String(e).slice(0, 200)
}
const extVersion =
  extDir === null
    ? null
    : JSON.parse(fs.readFileSync(path.join(extDir, "package.json"), "utf8"))
        .version
// pi exports no `package.json`, and only an `import` condition.
const PI = "@earendil-works/pi-coding-agent"
const piFolder = from =>
  fs.realpathSync(
    path.dirname(findPackageJSON(PI, pathToFileURL(from).href)),
  )
const piOfPinetrie = piFolder(path.join(piDir, "deep.js"))
let piOfExtension = null
try {
  piOfExtension = piFolder(path.join(extDir, "x.js"))
} catch (e) {
  piOfExtension = `unresolved: ${String(e).slice(0, 120)}`
}

// ── load through the install's own code ─────────────────────────────────────
const deep = await import(pathToFileURL(path.join(piDir, "deep.js")).href)
const config = await import(pathToFileURL(path.join(piDir, "config.js")).href)
const { getAgentDir } = await import(
  pathToFileURL(path.join(piOfPinetrie, "dist", "index.js")).href
)

const loader = await deep.openLoader({
  cwd: PROJ,
  agentDir: CONFIG,
  extensionPaths: extDir === null ? [] : [extDir],
  skillPaths: [],
  promptPaths: [],
  keepContextFile: () => false,
})
const paths = {
  authPath: path.join(DATA, "auth.json"),
  modelsPath: path.join(CONFIG, "models.json"),
}
const runtime = await deep.openRuntime(paths)
const control = await deep.openRuntime(paths)
config.registerProviders(runtime, loader)
const extensions = loader.getExtensions()

const ask = async models => {
  const all = models.getModels("anthropic")
  const model = all.find(m => m.id === "claude-opus-5-5") ?? all[0]
  const before = requests.length
  let error = null
  try {
    const reply = await models.completeSimple(model, {
      systemPrompt: "You are a probe.",
      messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
    })
    error = reply.errorMessage ?? null
  } catch (e) {
    error = String(e)
  }
  return {
    model: model.id,
    error: error?.slice(0, 160) ?? null,
    requests: requests.slice(before),
  }
}

const rel = p =>
  typeof p === "string" && p.startsWith(process.env.WORK)
    ? `$WORK${p.slice(process.env.WORK.length)}`
    : p
const result = {
  install: process.env.INSTALL,
  extension: { dir: rel(extDir), version: extVersion, resolveError },
  piOfPinetrie: rel(piOfPinetrie),
  piOfExtension: rel(piOfExtension),
  getAgentDir: rel(getAgentDir()),
  loaded: extensions.extensions.map(e => rel(e.path)),
  errors: extensions.errors.map(e => `${rel(e.path)}: ${e.error}`),
  providerRegistrations: extensions.runtime.pendingProviderRegistrations.map(
    r => r.name,
  ),
  anthropicAuth: await runtime.checkAuth("anthropic"),
  shaped: await ask(runtime),
  bare: await ask(control),
}
console.log(JSON.stringify(result, null, 1))
