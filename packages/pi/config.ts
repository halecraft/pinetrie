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
// `pi-anthropic-auth` registers.

import { stat } from "node:fs/promises"
import path from "node:path"
import {
  createModels,
  type ImageApi,
  type ImageModel,
  type Models as ImageModels,
} from "@earendil-works/pi-ai"
import { type ConfigLayer, isWithin, type NoModel } from "@pinetrie/core"
import type { GatheredCommand, ModelRef } from "@pinetrie/rules"
import type { AgentDirBinding } from "./agent-dir.ts"
import { gatherCommands, type Listing, pinetrieCommands } from "./commands.ts"
import {
  type buildSystemPromptSections,
  type LoaderOptions,
  openLoader,
  openRuntime,
} from "./deep.ts"
import {
  describeFaux,
  runFaux,
  type ScriptedModel,
  scriptedImages,
} from "./scripted.ts"

export type ModelChoice =
  /** The model the host's config settled; null when nothing names one. */
  | { readonly kind: "configured"; readonly model: ModelRef | null }
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

/** What `planModelSetup` decides: every path pi's code is given. */
interface ModelSetupPlan {
  readonly runtime: { readonly authPath: string; readonly modelsPath: string }
  /** Null when there is nothing to load: no package, skill or prompt listed. */
  readonly loader: LoaderOptions | null
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
 * Every path pi's code is given. A listed folder that does not exist is
 * left out (a package is also refused, with its path), and `configDir`'s
 * `skills/` and `prompts/` come after the listed ones, as the person's.
 */
export function planModelSetup(input: {
  readonly places: ModelPlaces
  readonly lists: ResourceLists
  readonly project: string
  /** pine·trie's own skills: after every other, so pi keeps a person's first. */
  readonly pinetrieSkills: string
  /** Whether `pinetrie.json`'s skills and prompts load at all: a suite's scripted model without lists loads nothing. */
  readonly loads: boolean
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
  const loads =
    input.loads || packages.length + skills.length + prompts.length > 0
  return {
    runtime: { authPath: places.credentials, modelsPath: places.models },
    loader: loads
      ? {
          cwd: project,
          agentDir: places.configDir,
          extensionPaths: packages,
          skillPaths: [...skills.map(f => f.path), input.pinetrieSkills],
          promptPaths: prompts.map(f => f.path),
          keepContextFile: file =>
            isOwnContextFile(file, project, places.configDir),
        }
      : null,
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
  // --- plan ---------------------------------------------------------------
  const plan = planModelSetup({
    places: where.places,
    lists: where.lists,
    project: where.cwd,
    pinetrieSkills: where.skillsDir,
    loads: choice.kind === "configured",
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
