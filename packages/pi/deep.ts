// pi/deep — the few pi entry points that have no public export.
//
// `createAgentHarness`, `addUsage`/`emptyUsage` and `ModelRuntime` are real,
// stable parts of pi's surface but are not listed in either package's
// `exports` map, so a package specifier is refused. A file URL bypasses the
// map. Every such import is collected here, so a change in pi's files
// breaks this one file.
//
// Verified export maps at 0.87.1:
//   @earendil-works/pi-agent-core  -> ".", "./node", "./harness/context",
//        "./experimental/pico3", "./harness/env/nodejs",
//        "./harness/runtime/reducer", "./harness/session",
//        "./harness/session/testing"
//   @earendil-works/pi-coding-agent -> ".", "./rpc-entry", "./client",
//        "./experimental/plugin"
// `@earendil-works/pi-coding-agent`'s root ALSO cannot be imported here: it
// pulls in dist/experimental/server.js, which requires `@earendil-works/pi-server`,
// a package the install does not ship. So `ModelRuntime`, and the pieces that
// load skills, prompts, extensions and context files (`SettingsManager`,
// `DefaultResourceLoader`, `buildSystemPrompt`), come from their files.
// `openLoader` and `openRuntime` are the only ways out for the first three,
// so the options that keep pi out of its own directories cannot be varied
// elsewhere.
//
// TYPING NOTE: the runtime import is a URL, which carries no types — but the
// matching `.d.ts` files DO exist on disk. `typeof import(...)` recovers pi's
// real declarations, so the values below are fully typed even though they are
// loaded dynamically. If pi moves one of these files the type lookup fails at
// COMPILE time, instead of the value arriving as `undefined` at run time.
//
// The type paths are RELATIVE, not package specifiers, for the same reason the
// runtime import is a URL: the export map refuses these subpaths, and it
// refuses them to the type resolver too. `node_modules/@earendil-works/*` is a
// stable symlink, so this does not bake in a pnpm content hash.

type UsageModule =
  typeof import("./node_modules/@earendil-works/pi-agent-core/dist/harness/utils/usage.js")
type RuntimeModule =
  typeof import("./node_modules/@earendil-works/pi-agent-core/dist/harness/runtime/index.js")
type ModelRuntimeModule =
  typeof import("./node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js")
type SettingsModule =
  typeof import("./node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js")
type ResourceLoaderModule =
  typeof import("./node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js")
type SystemPromptModule =
  typeof import("./node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js")
type SkillsModule =
  typeof import("./node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js")
type PromptTemplatesModule =
  typeof import("./node_modules/@earendil-works/pi-coding-agent/dist/core/prompt-templates.js")
type MimeModule =
  typeof import("./node_modules/@earendil-works/pi-coding-agent/dist/utils/mime.js")
type ImageResizeModule =
  typeof import("./node_modules/@earendil-works/pi-coding-agent/dist/utils/image-resize.js")

const base = new URL("./node_modules/", import.meta.url)
const deep = (p: string): Promise<unknown> => import(new URL(p, base).href)

const usage = (await deep(
  "@earendil-works/pi-agent-core/dist/harness/utils/usage.js",
)) as UsageModule
const runtime = (await deep(
  "@earendil-works/pi-agent-core/dist/harness/runtime/index.js",
)) as RuntimeModule
const modelRuntime = (await deep(
  "@earendil-works/pi-coding-agent/dist/core/model-runtime.js",
)) as ModelRuntimeModule

const settings = (await deep(
  "@earendil-works/pi-coding-agent/dist/core/settings-manager.js",
)) as SettingsModule
const resourceLoader = (await deep(
  "@earendil-works/pi-coding-agent/dist/core/resource-loader.js",
)) as ResourceLoaderModule
const systemPrompt = (await deep(
  "@earendil-works/pi-coding-agent/dist/core/system-prompt.js",
)) as SystemPromptModule

const skills = (await deep(
  "@earendil-works/pi-coding-agent/dist/core/skills.js",
)) as SkillsModule
const promptTemplates = (await deep(
  "@earendil-works/pi-coding-agent/dist/core/prompt-templates.js",
)) as PromptTemplatesModule
const mime = (await deep(
  "@earendil-works/pi-coding-agent/dist/utils/mime.js",
)) as MimeModule
const imageResize = (await deep(
  "@earendil-works/pi-coding-agent/dist/utils/image-resize.js",
)) as ImageResizeModule

export const { addUsage, emptyUsage } = usage
export const { loadSkillsFromDir } = skills
export const {
  loadPromptTemplates,
  expandPromptTemplate,
  parseCommandArgs,
  substituteArgs,
} = promptTemplates
export const { detectSupportedImageMimeType } = mime
export const { resizeImage, formatDimensionNote } = imageResize
export const { buildSystemPrompt } = systemPrompt
export const { createAgentHarness } = runtime

/** What `openLoader` is given: every option it may vary, decided by `planModelSetup`. */
export interface LoaderOptions {
  readonly cwd: string
  /** pine·trie's config directory, standing in pi's agent directory. */
  readonly agentDir: string
  readonly extensionPaths: readonly string[]
  readonly skillPaths: readonly string[]
  readonly promptPaths: readonly string[]
  /** Whether a context file pi found is one the model is given. */
  readonly keepContextFile: (file: string) => boolean
}

/**
 * pi's resource loader, kept out of pi's directories:
 * settings in memory, the project untrusted (so its `.pi/` and `.agents/`
 * are neither listed nor read), pi's own discovery off, and only the paths
 * given. The classes stay here, so no module builds a loader otherwise.
 */
export async function openLoader(options: LoaderOptions) {
  const settingsManager = settings.SettingsManager.inMemory({})
  settingsManager.setProjectTrusted(false)
  const loader = new resourceLoader.DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalExtensionPaths: [...options.extensionPaths],
    additionalSkillPaths: [...options.skillPaths],
    additionalPromptTemplatePaths: [...options.promptPaths],
    agentsFilesOverride: base => ({
      agentsFiles: base.agentsFiles.filter(f =>
        options.keepContextFile(f.path),
      ),
    }),
  })
  await loader.reload()
  return loader
}

/** pi's model runtime over pine·trie's credentials and custom providers. */
export const openRuntime = (paths: {
  readonly authPath: string
  readonly modelsPath: string
}) =>
  modelRuntime.ModelRuntime.create({
    authPath: paths.authPath,
    modelsPath: paths.modelsPath,
  })
