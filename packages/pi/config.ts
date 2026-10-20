// pi/config — which model answers, and what its system prompt knows.
//
// Everything is pine·trie's: the model the host's config settled, credentials
// in its `auth.json`, custom providers in its `models.json`, and the skills,
// prompts and packages its config lists. pi's code loads them, kept out of
// pi's own directories: `planModelSetup` decides every option as a
// value, and `openLoader` and `openRuntime` (`deep.ts`) carry it out. Only an
// extension's provider registrations are applied: its tools, commands,
// handlers and UI hooks belong to pi's coding agent, and pine·trie emits none
// of its events. A Claude subscription works only through the provider
// `pi-anthropic-auth` registers, which pine·trie ships and loads unless a
// listed copy replaces it or `anthropic.subscription` turns it off.

import { stat } from "node:fs/promises"
import path from "node:path"
import {
  createModels,
  type ImageApi,
  type ImageModel,
  type Models as ImageModels,
} from "@earendil-works/pi-ai"
import { type ConfigLayer, isWithin } from "@pinetrie/core"
import type {
  GatheredCommand,
  ModelRef,
  NoModel,
  SetupSubscription,
  Shaping,
} from "@pinetrie/rules"
import type { AgentDirBinding } from "./agent-dir.ts"
import { gatherCommands, type Listing, pinetrieCommands } from "./commands.ts"
import {
  type buildSystemPromptSections,
  type LoaderOptions,
  openLoader,
  openRuntime,
} from "./deep.ts"
import { type Manifest, readManifest } from "./manifest.ts"
import {
  describeFaux,
  runFaux,
  type ScriptedModel,
  scriptedImages,
} from "./scripted.ts"
import { ANTHROPIC_AUTH, packageFolder } from "./unimported-packages.ts"

export type ModelChoice =
  /** The model the host's config settled; null when nothing names one. */
  | {
      readonly kind: "configured"
      readonly model: ModelRef | null
      /** `anthropic.subscription`: whether the pi-anthropic-auth pine·trie ships loads. */
      readonly subscriptionShaping: boolean
    }
  /** A model named outright, with no packages' providers. For suites that call a real model. */
  | {
      readonly kind: "named"
      readonly provider: string
      readonly model: string
    }
  /** pi's faux provider, scripted by a suite. */
  | { readonly kind: "scripted"; readonly script: ScriptedModel }

/** Where pine·trie keeps what pi's code reads. */
export interface ModelPlaces {
  /** pine·trie's config directory: `AGENTS.md`, `skills/`, `prompts/`, an extension's own config. */
  readonly configDir: string
  /** `auth.json`, written only by pine·trie's sign-in. */
  readonly credentials: string
  /** Custom providers, in pi's `models.json` format. */
  readonly models: string
}

/** A folder of skills or prompts the config lists, and the layer that listed it. */
export interface ListedFolder {
  readonly path: string
  readonly layer: ConfigLayer
}

/** What the host's config lists for pi's loader. */
export interface ResourceLists {
  /** pi packages, by folder: absolute. */
  readonly packages: readonly string[]
  readonly skills: readonly ListedFolder[]
  readonly prompts: readonly ListedFolder[]
}

export const NO_RESOURCES: ResourceLists = {
  packages: [],
  skills: [],
  prompts: [],
}

export type ModelState<M> =
  | { readonly kind: "model"; readonly model: M }
  | {
      readonly kind: "none"
      readonly why: NoModel
      readonly named: ModelRef | null
    }

/**
 * Whether the named model answers: unset, not found, or found with no
 * credential for its provider.
 */
export function modelState<M>(input: {
  readonly named: ModelRef | null
  readonly found: M | undefined
  readonly credential: boolean
}): ModelState<M> {
  const { named, found, credential } = input
  if (named === null) return { kind: "none", why: "unset", named }
  if (found === undefined) return { kind: "none", why: "not-found", named }
  if (!credential) return { kind: "none", why: "no-credential", named }
  return { kind: "model", model: found }
}

/** What the shipped pi-anthropic-auth may be, decided from the model choice. */
export type ShippedChoice =
  /** A named or scripted model: the config's shaping does not apply. */
  | { readonly kind: "unloaded" }
  /** `anthropic.subscription` is false. */
  | { readonly kind: "off" }
  | {
      readonly kind: "on"
      readonly dir: string
      readonly version: string | null
    }

/** The shaping as planned: the shipped copy's folder stays on pi's side. */
type PlannedShaping =
  | (Extract<Shaping, { readonly kind: "shipped" }> & { readonly dir: string })
  | Exclude<Shaping, { readonly kind: "shipped" }>

/**
 * Who shapes the subscription's requests: a listed copy of the extension
 * (by its manifest's name) before the shipped one, which `off` turns off.
 * Null for a named or scripted model.
 */
function planShaping(
  shipped: ShippedChoice,
  packages: readonly string[],
  manifests: ReadonlyMap<string, Manifest>,
): PlannedShaping | null {
  if (shipped.kind === "unloaded") return null
  for (const p of packages) {
    const manifest = manifests.get(p)
    if (manifest?.name === ANTHROPIC_AUTH.package)
      return { kind: "listed", path: p, version: manifest.version }
  }
  return shipped.kind === "off"
    ? { kind: "off" }
    : { kind: "shipped", dir: shipped.dir, version: shipped.version }
}

/** The extension folders the shaping adds before the listed packages. */
const shippedPaths = (shaping: PlannedShaping | null): readonly string[] =>
  shaping?.kind === "shipped" ? [shaping.dir] : []

/** Whether a subscription is signed in for the provider and no loaded package registered it. */
export function isUnshaped(facts: {
  readonly provider: string
  readonly subscription: boolean
  readonly registered: readonly string[]
}): boolean {
  return facts.subscription && !facts.registered.includes(facts.provider)
}

/** What `planModelSetup` decides: every path pi's code is given. */
interface ModelSetupPlan {
  readonly runtime: { readonly authPath: string; readonly modelsPath: string }
  /** Null when there is nothing to load: a named or scripted model with nothing listed. */
  readonly loader: LoaderOptions | null
  /** Who shapes the subscription's requests; the loader's extension paths follow from it. */
  readonly shaping: PlannedShaping | null
  readonly listing: Listing
  /** Listed packages that are not folders: never given to pi, which would install them. */
  readonly refused: readonly string[]
}

/** A context file the model is given: pine·trie's own, or one inside the project. */
export const isOwnContextFile = (
  file: string,
  project: string,
  configDir: string,
): boolean =>
  path.dirname(file) === configDir || isWithin(path.dirname(file), project)

/**
 * Who shapes a subscription's requests, then every path pi's code is
 * given: the shipped extension's folder, when it shapes them, before the
 * listed packages. A listed folder that does not exist is left out (a
 * package is also refused, with its path), and `configDir`'s `skills/` and
 * `prompts/` come after the listed ones, as the person's.
 */
export function planModelSetup(input: {
  readonly places: ModelPlaces
  readonly lists: ResourceLists
  readonly project: string
  /** pine·trie's own skills: after every other, so pi keeps a person's first. */
  readonly pinetrieSkills: string
  /**
   * The shipped extension, decided from the model choice. `unloaded` (a
   * suite's named or scripted model) also loads nothing of pi's unless
   * something is listed.
   */
  readonly shipped: ShippedChoice
  /** Each existing listed package's `package.json`. */
  readonly manifests: ReadonlyMap<string, Manifest>
  readonly exists: (p: string) => boolean
}): ModelSetupPlan {
  const { places, lists, project, exists } = input
  const own = (dir: string): ListedFolder[] => {
    const p = path.join(places.configDir, dir)
    return exists(p) ? [{ path: p, layer: "user" }] : []
  }
  const skills = [...lists.skills.filter(f => exists(f.path)), ...own("skills")]
  const prompts = [
    ...lists.prompts.filter(f => exists(f.path)),
    ...own("prompts"),
  ]
  const packages = lists.packages.filter(exists)
  const shaping = planShaping(input.shipped, packages, input.manifests)
  const loads =
    input.shipped.kind !== "unloaded" ||
    packages.length + skills.length + prompts.length > 0
  return {
    runtime: { authPath: places.credentials, modelsPath: places.models },
    loader: loads
      ? {
          cwd: project,
          agentDir: places.configDir,
          extensionPaths: [...shippedPaths(shaping), ...packages],
          skillPaths: [...skills.map(f => f.path), input.pinetrieSkills],
          promptPaths: prompts.map(f => f.path),
          keepContextFile: file =>
            isOwnContextFile(file, project, places.configDir),
        }
      : null,
    shaping,
    listing: { packages, loose: [...skills, ...prompts] },
    refused: lists.packages.filter(p => !exists(p)),
  }
}

type Runtime = Awaited<ReturnType<typeof openRuntime>>

/**
 * The listed packages' provider registrations, applied to `models`. Only
 * providers: an extension's tools, commands, handlers and UI hooks belong to
 * pi's coding agent, and pine·trie emits none of its events.
 */
export function registerProviders(
  models: Runtime,
  loader: Awaited<ReturnType<typeof openLoader>>,
): void {
  const { runtime } = loader.getExtensions()
  for (const { name, config } of runtime.pendingProviderRegistrations)
    models.registerProvider(name, config)
  for (const { provider } of runtime.pendingNativeProviderRegistrations)
    models.registerNativeProvider(provider)
}
type Models = Runtime | ReturnType<typeof createModels>
export type Model = NonNullable<ReturnType<Models["getModel"]>>

type PromptInput = Parameters<typeof buildSystemPromptSections>[0]

/**
 * What a harness holds on a host with no model. Never asked: every run is
 * refused before it reaches pi.
 */
export const NO_MODEL_STAND_IN = {
  id: "none",
  name: "none",
  api: "openai-completions",
  provider: "none",
  baseUrl: "http://127.0.0.1:9",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1,
  maxTokens: 1,
} as Model

/** Where banners are drawn: pi-ai's models, whose image models draw them, and a key for it. */
export interface ImagesSetup {
  readonly models: ImageModels
  /** The model a banner is drawn with: the one named, or a scripted model's own. */
  model(provider: string, id: string): ImageModel<ImageApi> | undefined
  /**
   * The request's key for `provider`: from pi's `auth.json`, or its
   * environment variable. Undefined with none.
   */
  apiKey(provider: string): Promise<string | undefined>
}

/**
 * The image model `provider/id` names: pi-ai's entry when it lists one, or,
 * for an OpenRouter id it does not, one described here. OpenRouter adds
 * models faster than pi-ai's list follows, and pi-ai's `generateImages`
 * takes the model as given, without looking it up. An unlisted model is
 * taken to draw from text alone; an id OpenRouter does not have fails at the
 * draw.
 */
export function imageModelFor(
  listed: ImageModel<ImageApi> | undefined,
  provider: string,
  id: string,
): ImageModel<ImageApi> | undefined {
  if (listed !== undefined || provider !== "openrouter") return listed
  return {
    type: "image",
    id,
    name: id,
    api: "openrouter-images",
    provider,
    baseUrl: "https://openrouter.ai/api/v1",
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
}

/** The runtime's image models, OpenRouter's among them, keyed by pine·trie's credentials. */
function runtimeImages(models: Runtime): ImagesSetup {
  return {
    models,
    model: (provider, id) =>
      imageModelFor(models.getModelOfType("image", provider, id), provider, id),
    apiKey: provider =>
      models
        .getAuth(provider)
        .then(r => r?.auth.apiKey)
        .catch(() => undefined),
  }
}

/**
 * What pi loads for the choice: the model, and the context files, skills,
 * commands and image models beside it. `loadPiSetup` wraps it, and
 * `createAgent` builds every harness from it.
 */
export interface ModelSetup {
  readonly models: Models
  /** The run's model, or why there is none: every run is then refused. */
  readonly model: ModelState<Model>
  /**
   * The model a commit message is asked of: the run's, except for a scripted
   * model, whose describe requests have a provider of their own so they never
   * take a reply from the run's script. Null with no model.
   */
  readonly describeModel: Model | null
  /** Context files for the system prompt, such as the repo's `AGENTS.md`. */
  readonly contextFiles: PromptInput["contextFiles"]
  readonly skills: PromptInput["skills"]
  /** Every skill and prompt template pi loaded, as commands. */
  readonly commands: readonly GatheredCommand[]
  readonly images: ImagesSetup
  /** Listed packages that are not folders, refused before pi saw them. */
  readonly refusedPackages: readonly string[]
  /** Each provider with a credential, and where pi found it; never the credential. */
  readonly credentials: readonly {
    readonly provider: string
    readonly source: string
  }[]
  /** Who shapes a subscription's requests; null for a named or scripted model. */
  readonly subscription: SetupSubscription | null
}

/**
 * Each provider whose credential pi has, from its snapshot: no key is
 * resolved and no key command runs.
 */
const credentialsIn = (models: Runtime): ModelSetup["credentials"] =>
  models.getProviders().flatMap(p => {
    const status = models.getProviderAuthStatus(p.id)
    return status.configured
      ? [{ provider: p.id, source: status.source ?? "configured" }]
      : []
  })

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

/** The shipped extension for `choice`: its folder and version when the configured choice loads it. */
async function shippedChoice(choice: ModelChoice): Promise<ShippedChoice> {
  if (choice.kind !== "configured") return { kind: "unloaded" }
  if (!choice.subscriptionShaping) return { kind: "off" }
  const dir = packageFolder(ANTHROPIC_AUTH.package)
  const { version } = await readManifest(path.join(dir, "package.json"))
  return { kind: "on", dir, version }
}

/** The shaping as the setup record stores it: without the shipped copy's folder. */
const storedShaping = (shaping: PlannedShaping): Shaping =>
  shaping.kind === "shipped"
    ? { kind: "shipped", version: shaping.version }
    : shaping

/** Every provider the loaded packages registered, by name. */
const registeredProviders = (
  loader: Awaited<ReturnType<typeof openLoader>>,
): readonly string[] => {
  const { runtime } = loader.getExtensions()
  return [
    ...runtime.pendingProviderRegistrations.map(r => r.name),
    ...runtime.pendingNativeProviderRegistrations.map(r => r.provider.id),
  ]
}

export async function loadModelSetup(
  choice: ModelChoice,
  where: {
    readonly cwd: string
    readonly places: ModelPlaces
    /** pi's agent directory is pine·trie's for this process. */
    readonly binding: AgentDirBinding
    readonly lists: ResourceLists
    /**
     * pinetrie's own skills. pi keeps one skill per name for the model, and
     * these come after yours and the repo's; as commands, each is reachable
     * under its own package.
     */
    readonly skillsDir: string
  },
): Promise<ModelSetup> {
  // --- gather -------------------------------------------------------------
  const listed = [
    ...where.lists.packages,
    ...where.lists.skills.map(f => f.path),
    ...where.lists.prompts.map(f => f.path),
    path.join(where.places.configDir, "skills"),
    path.join(where.places.configDir, "prompts"),
  ]
  const found = new Set<string>()
  for (const p of listed) if (await exists(p)) found.add(p)
  const manifests = new Map<string, Manifest>()
  for (const p of where.lists.packages)
    if (found.has(p))
      manifests.set(p, await readManifest(path.join(p, "package.json")))
  const shipped = await shippedChoice(choice)
  // --- plan ---------------------------------------------------------------
  const plan = planModelSetup({
    places: where.places,
    lists: where.lists,
    project: where.cwd,
    pinetrieSkills: where.skillsDir,
    shipped,
    manifests,
    exists: p => found.has(p),
  })
  // --- execute ------------------------------------------------------------
  const loader = plan.loader === null ? null : await openLoader(plan.loader)
  const resources =
    loader === null
      ? {
          contextFiles: [],
          skills: [],
          commands: pinetrieCommands(where.skillsDir),
        }
      : {
          contextFiles: loader.getAgentsFiles().agentsFiles,
          skills: loader.getSkills().skills,
          commands: await gatherCommands(
            loader,
            { cwd: where.cwd, configDir: where.places.configDir },
            plan.listing,
            where.skillsDir,
          ),
        }
  const refusedPackages = plan.refused
  switch (choice.kind) {
    case "scripted": {
      const faux = runFaux(choice.script)
      const describe = describeFaux(choice.script)
      const models = createModels()
      models.setProvider(faux.provider)
      models.setProvider(describe.provider)
      const drawn = scriptedImages()
      const images = createModels()
      images.setProvider(drawn.provider)
      return {
        models,
        model: { kind: "model", model: faux.getModel() },
        describeModel: describe.getModel(),
        images: {
          models: images,
          model: () => drawn.model,
          apiKey: async () => "scripted",
        },
        refusedPackages,
        credentials: [],
        subscription: null,
        ...resources,
      }
    }
    case "named": {
      const models = await openRuntime(plan.runtime)
      const model = models.getModel(choice.provider, choice.model)
      if (model === undefined)
        throw new Error(`model not found: ${choice.provider}/${choice.model}`)
      return {
        models,
        model: { kind: "model", model },
        describeModel: model,
        images: runtimeImages(models),
        refusedPackages,
        credentials: credentialsIn(models),
        subscription: null,
        ...resources,
      }
    }
    case "configured": {
      const models = await openRuntime(plan.runtime)
      if (loader !== null) registerProviders(models, loader)
      const named = choice.model
      const state = modelState({
        named,
        found:
          named === null
            ? undefined
            : models.getModel(named.provider, named.model),
        credential:
          named !== null &&
          models.getProviderAuthStatus(named.provider).configured,
      })
      return {
        models,
        model: state,
        describeModel: state.kind === "model" ? state.model : null,
        images: runtimeImages(models),
        refusedPackages,
        credentials: credentialsIn(models),
        subscription:
          plan.shaping === null
            ? null
            : {
                package: ANTHROPIC_AUTH.package,
                provider: ANTHROPIC_AUTH.provider,
                shaping: storedShaping(plan.shaping),
                unshaped: isUnshaped({
                  provider: ANTHROPIC_AUTH.provider,
                  subscription: models.isUsingOAuth(ANTHROPIC_AUTH.provider),
                  registered:
                    loader === null ? [] : registeredProviders(loader),
                }),
              },
        ...resources,
      }
    }
  }
}

/**
 * The model a root's title is asked of: `named`, unless it is null, the
 * model is scripted (whose describe provider answers every request outside a
 * thread), or pi has no such model. `found` is false only for the last,
 * which the host logs. Null with no model at all.
 */
export function titleModel(
  setup: Pick<ModelSetup, "models" | "describeModel">,
  named: { readonly provider: string; readonly model: string } | null,
  scripted: boolean,
): { readonly model: Model | null; readonly found: boolean } {
  if (named === null || scripted)
    return { model: setup.describeModel, found: true }
  const model = setup.models.getModel(named.provider, named.model)
  return model === undefined
    ? { model: setup.describeModel, found: false }
    : { model, found: true }
}

/**
 * A request outside every thread, answered: its text, null when it failed,
 * and the tokens it spent, which a budget for agents talking counts; 0 when
 * nothing came back.
 */
export interface Completed {
  readonly text: string | null
  readonly tokens: number
}

/**
 * One request outside every thread, on `model`: proposed changes' commit
 * message, an ask's digest or a root's title. No tools, no session, so nothing
 * enters the tree or a lane's context.
 */
export async function complete(
  setup: Pick<ModelSetup, "models">,
  model: Model | null,
  request: { readonly system: string; readonly user: string },
): Promise<Completed> {
  // With no model there is nothing to ask: as a request that failed.
  if (model === null) return { text: null, tokens: 0 }
  try {
    const reply = await setup.models.completeSimple(model, {
      systemPrompt: request.system,
      messages: [
        { role: "user", content: request.user, timestamp: Date.now() },
      ],
    })
    const text = reply.content
      .flatMap(p => (p.type === "text" ? [p.text] : []))
      .join("")
      .trim()
    const tokens = reply.usage?.totalTokens ?? 0
    return {
      text: reply.stopReason === "error" || text === "" ? null : text,
      tokens,
    }
  } catch {
    return { text: null, tokens: 0 }
  }
}
