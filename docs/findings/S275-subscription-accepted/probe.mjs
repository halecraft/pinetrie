// S275 probe, run on the host's machine with a Claude subscription signed in
// (`pinetrie sign-in anthropic`):
//
//   npm install --prefix /tmp/s275 --legacy-peer-deps @gotgenes/pi-anthropic-auth@3.4.3
//   node probe.mjs <pine·trie clone, after pnpm install> /tmp/s275 [model id]
//
// Makes two small requests on `anthropic/<model>` (claude-opus-5-5 by
// default) through the clone's own `openLoader`, `openRuntime` and
// `registerProviders`: one with the extension's registrations applied, one
// through a runtime without them. Prints each one's outcome, never the token.
//
// It uses pine·trie's own auth.json, not a copy: a refresh rotates the
// refresh token, and a copy refreshed would leave the real file's stale.
import fs from "node:fs"
import { findPackageJSON } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const [repo, installed, modelId = "claude-opus-5-5"] = process.argv.slice(2)
if (repo === undefined || installed === undefined) {
  console.error("usage: node probe.mjs <pinetrie clone> <extension install> [model id]")
  process.exit(2)
}
const env = (name, fallback) => process.env[name] || fallback
const config = path.join(env("XDG_CONFIG_HOME", path.join(os.homedir(), ".config")), "pinetrie")
const data = path.join(env("XDG_DATA_HOME", path.join(os.homedir(), ".local", "share")), "pinetrie")
const authPath = path.join(data, "auth.json")
if (!fs.existsSync(authPath)) {
  console.error(`no ${authPath}: run pinetrie sign-in anthropic first`)
  process.exit(2)
}
// pi reads it at each call; the extension finds its own config through it.
process.env.PI_CODING_AGENT_DIR = config

const ext = path.join(installed, "node_modules", "@gotgenes", "pi-anthropic-auth")
const version = file => JSON.parse(fs.readFileSync(file, "utf8")).version
const piDir = path.join(repo, "packages", "pi")
const deep = await import(pathToFileURL(path.join(piDir, "deep.ts")).href)
const setup = await import(pathToFileURL(path.join(piDir, "config.ts")).href)

const loader = await deep.openLoader({
  cwd: repo,
  agentDir: config,
  extensionPaths: [ext],
  skillPaths: [],
  promptPaths: [],
  keepContextFile: () => false,
})
const paths = { authPath, modelsPath: path.join(config, "models.json") }
const shapedRuntime = await deep.openRuntime(paths)
const bareRuntime = await deep.openRuntime(paths)
setup.registerProviders(shapedRuntime, loader)
const extensions = loader.getExtensions()

const ask = async models => {
  const model = models.getModels("anthropic").find(m => m.id === modelId)
  if (model === undefined) return { error: `no anthropic/${modelId}` }
  const reply = await models.completeSimple(
    model,
    {
      systemPrompt: "Answer with the single word OK.",
      messages: [{ role: "user", content: "Say OK.", timestamp: Date.now() }],
    },
    { maxTokens: 32 },
  )
  return {
    stopReason: reply.stopReason,
    error: reply.errorMessage?.slice(0, 300) ?? null,
    text: reply.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("")
      .slice(0, 80),
  }
}

const piPkg = findPackageJSON(
  "@earendil-works/pi-coding-agent",
  pathToFileURL(path.join(piDir, "deep.ts")).href,
)
const result = {
  at: new Date().toISOString().slice(0, 10),
  platform: `${process.platform} ${process.arch}, node ${process.version}`,
  pi: version(piPkg),
  extension: version(path.join(ext, "package.json")),
  model: `anthropic/${modelId}`,
  loadErrors: extensions.errors.map(e => e.error),
  providerRegistrations: extensions.runtime.pendingProviderRegistrations.map(r => r.name),
  auth: await shapedRuntime.checkAuth("anthropic"),
  shaped: await ask(shapedRuntime),
  bare: await ask(bareRuntime),
}
console.log(JSON.stringify(result, null, 1))
