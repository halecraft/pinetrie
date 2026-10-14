// S193/S194 probe. Builds a fake home and project with a sentinel in every
// place pi looks, loads pi's resource loader and model runtime as $VARIANT
// says, and prints what reached the host as JSON. Run by run.sh, under
// trace.mjs, from a directory whose node_modules holds pi 0.87.1 and
// @gotgenes/pi-anthropic-auth 3.4.2.
//
// VARIANT:
//   today     pine·trie's loading now: pi's settings and agent directory.
//   ours      ADR-0146's: in-memory settings, pine·trie's directory, no*
//             flags, pine·trie's own lists.
//   ours-env  as ours, with PI_CODING_AGENT_DIR set to pine·trie's directory
//             (run.sh sets it before pi loads).
//   ours-untrusted  as ours-env, with the project untrusted in pi's settings.
//   ours-installed  as ours-untrusted, with pi-anthropic-auth and pi-subagents
//             from an npm install of their own, without pi (--legacy-peer-deps).
//   ours-packages   as ours-untrusted, with two pi packages (pine·trie's
//             fixtures, copied into the home) listed as extension paths.
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const ROOT = process.env.TRACE_ROOT
const VARIANT = process.env.VARIANT
const HOME = path.join(ROOT, "home")
const PI = path.join(HOME, ".pi", "agent")
const OURS = path.join(HOME, ".config", "pinetrie")
const DATA = path.join(HOME, ".local", "share", "pinetrie")
const PROJ = path.join(HOME, "proj")
// ours-installed: the extension and pi-subagents from an install of their own,
// with no pi beside them (INSTALLED, see run.sh).
const INSTALLED = process.env.INSTALLED
const EXT =
  VARIANT === "ours-installed"
    ? path.join(INSTALLED, "node_modules", "@gotgenes", "pi-anthropic-auth")
    : path.dirname(
        createRequire(path.join(process.cwd(), "x.js")).resolve(
          "@gotgenes/pi-anthropic-auth/package.json",
        ),
      )

// ── the fake tree ───────────────────────────────────────────────────────────
const put = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
const skill = name =>
  `---\nname: ${name}\ndescription: sentinel ${name}\n---\nsentinel ${name}\n`
const marker = name =>
  `import fs from "node:fs"\nexport default function () { fs.writeFileSync(${JSON.stringify(path.join(ROOT, `${name}.loaded`))}, "") }\n`
const provider = (id, model) => ({
  providers: {
    [id]: {
      baseUrl: "http://127.0.0.1:9/v1",
      api: "openai-completions",
      apiKey: "sentinel",
      models: [{ id: model }],
    },
  },
})
fs.rmSync(ROOT, { recursive: true, force: true })
// pi's agent directory
put(
  path.join(PI, "settings.json"),
  JSON.stringify({
    defaultProvider: "pi-home-provider",
    defaultModel: "pi-home-model",
    extensions: [EXT],
    skills: [path.join(PI, "listed-skills")],
  }),
)
put(
  path.join(PI, "auth.json"),
  JSON.stringify({ anthropic: { type: "api_key", key: "PI-HOME-KEY" } }),
)
put(
  path.join(PI, "models.json"),
  JSON.stringify(provider("pi-home-provider", "pi-home-model")),
)
put(path.join(PI, "AGENTS.md"), "sentinel pi-home AGENTS\n")
put(path.join(PI, "SYSTEM.md"), "sentinel pi-home SYSTEM\n")
put(path.join(PI, "APPEND_SYSTEM.md"), "sentinel pi-home APPEND\n")
put(
  path.join(PI, "skills", "pi-home-skill", "SKILL.md"),
  skill("pi-home-skill"),
)
put(
  path.join(PI, "listed-skills", "pi-listed-skill", "SKILL.md"),
  skill("pi-listed-skill"),
)
put(path.join(PI, "prompts", "pi-home-prompt.md"), "sentinel pi-home prompt\n")
put(path.join(PI, "extensions", "pi-home-ext.mjs"), marker("pi-home-ext"))
put(
  path.join(PI, "extensions", "pi-anthropic-auth", "config.json"),
  JSON.stringify({ providers: ["pi-home-shaped"] }),
)
// the person's home, above the project
put(path.join(HOME, "AGENTS.md"), "sentinel home AGENTS\n")
put(
  path.join(HOME, ".agents", "skills", "home-agents-skill", "SKILL.md"),
  skill("home-agents-skill"),
)
// pine·trie's directories
put(path.join(OURS, "pinetrie.json"), "{}\n")
put(path.join(OURS, "AGENTS.md"), "sentinel ours AGENTS\n")
put(
  path.join(OURS, "models.json"),
  JSON.stringify(provider("our-provider", "our-model")),
)
put(path.join(OURS, "skills", "our-skill", "SKILL.md"), skill("our-skill"))
put(path.join(OURS, "prompts", "our-prompt.md"), "sentinel our prompt\n")
put(
  path.join(DATA, "auth.json"),
  JSON.stringify({
    anthropic: {
      type: "oauth",
      access: "sk-ant-oat01-OURS",
      refresh: "sk-ant-ort01-OURS",
      expires: 4_000_000_000_000,
    },
  }),
)
// the project
put(path.join(PROJ, "AGENTS.md"), "sentinel project AGENTS\n")
put(path.join(PROJ, "skills", "proj-skill", "SKILL.md"), skill("proj-skill"))
put(
  path.join(PROJ, ".pi", "settings.json"),
  JSON.stringify({
    defaultModel: "proj-pi-model",
    extensions: [".pi/extensions/proj-ext.mjs"],
  }),
)
put(path.join(PROJ, ".pi", "SYSTEM.md"), "sentinel project SYSTEM\n")
put(path.join(PROJ, ".pi", "APPEND_SYSTEM.md"), "sentinel project APPEND\n")
put(
  path.join(PROJ, ".pi", "skills", "proj-pi-skill", "SKILL.md"),
  skill("proj-pi-skill"),
)
put(
  path.join(PROJ, ".pi", "prompts", "proj-pi-prompt.md"),
  "sentinel project prompt\n",
)
put(path.join(PROJ, ".pi", "extensions", "proj-ext.mjs"), marker("proj-ext"))
put(
  path.join(PROJ, ".agents", "skills", "proj-agents-skill", "SKILL.md"),
  skill("proj-agents-skill"),
)

// two pi packages, pine·trie's own fixtures
for (const pkg of ["fixture-pkg", "other-pkg"])
  fs.cpSync(
    path.join(process.env.FIXTURES, pkg),
    path.join(HOME, "pkgs", pkg),
    {
      recursive: true,
    },
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
    headers,
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

// ── load ────────────────────────────────────────────────────────────────────
const pi = await import("@earendil-works/pi-coding-agent")
const { SettingsManager, DefaultResourceLoader, ModelRuntime, getAgentDir } = pi

let loader
let runtimePaths
if (VARIANT === "today") {
  const settingsManager = SettingsManager.create(PROJ, PI)
  loader = new DefaultResourceLoader({
    cwd: PROJ,
    agentDir: PI,
    settingsManager,
    additionalSkillPaths: [path.join(OURS, "skills")],
  })
  runtimePaths = {
    authPath: path.join(PI, "auth.json"),
    modelsPath: path.join(PI, "models.json"),
  }
} else {
  const settingsManager = SettingsManager.inMemory({})
  if (VARIANT !== "ours" && VARIANT !== "ours-env")
    settingsManager.setProjectTrusted(false)
  loader = new DefaultResourceLoader({
    cwd: PROJ,
    agentDir: OURS,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalExtensionPaths:
      VARIANT === "ours-packages"
        ? [
            EXT,
            path.join(HOME, "pkgs", "fixture-pkg"),
            path.join(HOME, "pkgs", "other-pkg"),
          ]
        : VARIANT === "ours-installed"
          ? [EXT, path.join(INSTALLED, "node_modules", "pi-subagents")]
          : [EXT],
    additionalSkillPaths: [
      path.join(OURS, "skills"),
      path.join(PROJ, "skills"),
    ],
    additionalPromptTemplatePaths: [path.join(OURS, "prompts")],
  })
  runtimePaths = {
    authPath: path.join(DATA, "auth.json"),
    modelsPath: path.join(OURS, "models.json"),
  }
}
await loader.reload()
const extensions = loader.getExtensions()
const runtime = await ModelRuntime.create(runtimePaths)
const control = await ModelRuntime.create(runtimePaths)
for (const { name, config } of extensions.runtime.pendingProviderRegistrations)
  runtime.registerProvider(name, config)
for (const { provider } of extensions.runtime
  .pendingNativeProviderRegistrations)
  runtime.registerNativeProvider(provider)

// ── a request on anthropic, with and without the extension ─────────────────
const ask = async models => {
  const model =
    models.getModels("anthropic").find(m => m.id.includes("sonnet")) ??
    models.getModels("anthropic")[0]
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
const shaped = await ask(runtime)
const bare = await ask(control)

const rel = p => (p.startsWith(ROOT) ? p.slice(ROOT.length) : p)
const result = {
  variant: VARIANT,
  getAgentDir: rel(getAgentDir()),
  markers: fs.readdirSync(ROOT).filter(f => f.endsWith(".loaded")),
  extensions: extensions.extensions.map(e => rel(e.path)),
  extensionErrors: extensions.errors.map(e => `${rel(e.path)}: ${e.error}`),
  providerRegistrations: extensions.runtime.pendingProviderRegistrations.map(
    r => r.name,
  ),
  skills: loader
    .getSkills()
    .skills.map(
      s =>
        `${s.name} ${rel(s.filePath)} (${s.sourceInfo?.source}/${s.sourceInfo?.scope}/${s.sourceInfo?.origin} ${rel(s.sourceInfo?.baseDir ?? "-")})`,
    ),
  prompts: loader
    .getPrompts()
    .prompts.map(
      p =>
        `${p.name} ${rel(p.filePath)} (${p.sourceInfo?.source}/${p.sourceInfo?.scope}/${p.sourceInfo?.origin} ${rel(p.sourceInfo?.baseDir ?? "-")})`,
    ),
  contextFiles: loader.getAgentsFiles().agentsFiles.map(f => rel(f.path)),
  systemPrompt: loader.getSystemPrompt() ?? null,
  appendSystemPrompt: loader.getAppendSystemPrompt(),
  providers: runtime
    .getProviders()
    .map(p => p.id)
    .filter(id => id.includes("provider")),
  anthropicAuth: await runtime.checkAuth("anthropic"),
  shaped,
  bare,
}
console.log(JSON.stringify(result, null, 1))
