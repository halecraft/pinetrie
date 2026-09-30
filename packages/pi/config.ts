// pi/config — which model answers, and what its system prompt knows.
//
// A person's pi setup is loaded as pi loads it (S23): `SettingsManager` and
// `DefaultResourceLoader` over `~/.pi/agent`, then the extensions' provider
// registrations applied to a `ModelRuntime`. Only providers: an extension's
// tools, commands, handlers and UI hooks belong to pi's coding agent, and
// Pineta emits none of its events. A Claude subscription token, for one, works
// only through the provider `pi-anthropic-auth` registers.

import { homedir } from "node:os"
import path from "node:path"
import {
  createImagesModels,
  createModels,
  type ImagesApi,
  type ImagesModel,
  type ImagesModels,
} from "@earendil-works/pi-ai"
import { openrouterImagesProvider } from "@earendil-works/pi-ai/providers/openrouter-images"
import type { GatheredCommand } from "@pineta/marginalia"
import { gatherCommands, pinetaCommands } from "./commands.ts"
import {
  type buildSystemPrompt,
  DefaultResourceLoader,
  ModelRuntime,
  SettingsManager,
} from "./deep.ts"
import {
  describeFauxOf,
  fauxOf,
  type ScriptedModel,
  scriptedImages,
} from "./scripted.ts"

export type ModelChoice =
  /** The person's pi setup: settings' default model and the extensions' providers. */
  | {
      readonly kind: "configured"
      readonly provider?: string
      readonly model?: string
    }
  /** models.json and auth.json only; no extensions. For suites that call a real model. */
  | {
      readonly kind: "named"
      readonly provider: string
      readonly model: string
    }
  /** pi's faux provider, scripted by a suite. */
  | { readonly kind: "scripted"; readonly script: ScriptedModel }

/**
 * The model to use: an override's fields win over the settings' defaults. Pure;
 * undefined when neither names both a provider and a model.
 */
export function pickModel(
  settings: { readonly provider?: string; readonly model?: string },
  override: { readonly provider?: string; readonly model?: string },
): { readonly provider: string; readonly model: string } | undefined {
  const provider = override.provider ?? settings.provider
  const model = override.model ?? settings.model
  return provider === undefined || model === undefined
    ? undefined
    : { provider, model }
}

export const DEFAULT_AGENT_DIR = path.join(homedir(), ".pi", "agent")

/** A `ModelRuntime` over the person's `auth.json` and `models.json`. */
const openRuntime = (agentDir: string) =>
  ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  })

type Runtime = Awaited<ReturnType<typeof openRuntime>>
type Models = Runtime | ReturnType<typeof createModels>
type Model = NonNullable<ReturnType<Models["getModel"]>>

type PromptInput = Parameters<typeof buildSystemPrompt>[0]

/** Where banners are drawn: pi-ai's image registry, and a key for it. */
export interface ImagesSetup {
  readonly models: ImagesModels
  /** The model a banner is drawn with: the one named, or a scripted model's own. */
  model(provider: string, id: string): ImagesModel<ImagesApi> | undefined
  /**
   * The request's key for `provider`: from pi's `auth.json`, or its
   * environment variable. Undefined with none; the image registry does not
   * read `auth.json` itself.
   */
  apiKey(provider: string): Promise<string | undefined>
}

/** OpenRouter's image models, keyed as the person's pi keys OpenRouter. */
function openRouterImages(models: Runtime): ImagesSetup {
  const images = createImagesModels()
  images.setProvider(openrouterImagesProvider())
  return {
    models: images,
    model: (provider, id) => images.getModel(provider, id),
    apiKey: provider =>
      models
        .getAuth(provider)
        .then(r => r?.auth.apiKey)
        .catch(() => undefined),
  }
}

/** What `createAgent` needs from the choice. */
export interface ModelSetup {
  readonly models: Models
  readonly model: Model
  /**
   * The model a commit message is asked of (ADR-0038): the run's, except for
   * a scripted model, whose describe requests have a provider of their own so
   * they never take a reply from the run's script (S48 item 22).
   */
  readonly describeModel: Model
  /** Context files for the system prompt, such as the repo's `AGENTS.md`. */
  readonly contextFiles: PromptInput["contextFiles"]
  readonly skills: PromptInput["skills"]
  /** Every skill and prompt template pi loaded, as commands (ADR-0036). */
  readonly commands: readonly GatheredCommand[]
  readonly images: ImagesSetup
}

export async function setUpModel(
  choice: ModelChoice,
  where: {
    readonly cwd: string
    /**
     * pi's agent directory. A scripted or named model loads skills and
     * prompts from it only when it is given: a suite points it at a fixture,
     * and never reads the person's own.
     */
    readonly agentDir?: string
    /**
     * Pineta's own skills. pi keeps one skill per name for the model, and
     * these come after yours and the repo's; as commands, each is reachable
     * under its own package (ADR-0036).
     */
    readonly skillsDir?: string
  },
): Promise<ModelSetup> {
  const agentDir = where.agentDir ?? DEFAULT_AGENT_DIR
  const load = async () => {
    const settingsManager = SettingsManager.create(where.cwd, agentDir)
    const loader = new DefaultResourceLoader({
      cwd: where.cwd,
      agentDir,
      settingsManager,
      ...(where.skillsDir === undefined
        ? {}
        : { additionalSkillPaths: [where.skillsDir] }),
    })
    await loader.reload()
    const resources = {
      contextFiles: loader.getAgentsFiles().agentsFiles,
      skills: loader.getSkills().skills,
      commands: await gatherCommands(
        loader,
        { cwd: where.cwd, agentDir },
        where.skillsDir ?? "",
      ),
    }
    return { settingsManager, loader, resources }
  }
  // Loading nothing of pi's still leaves Pineta's own skills as commands.
  const none = {
    contextFiles: [],
    skills: [],
    commands:
      where.skillsDir === undefined ? [] : pinetaCommands(where.skillsDir),
  }
  switch (choice.kind) {
    case "scripted": {
      const faux = fauxOf(choice.script)
      const describe = describeFauxOf(choice.script)
      const models = createModels()
      models.setProvider(faux.provider)
      models.setProvider(describe.provider)
      const resources =
        where.agentDir === undefined ? none : (await load()).resources
      const drawn = scriptedImages()
      const images = createImagesModels()
      images.setProvider(drawn.provider)
      return {
        models,
        model: faux.getModel(),
        describeModel: describe.getModel(),
        images: {
          models: images,
          model: () => drawn.model,
          apiKey: async () => "scripted",
        },
        ...resources,
      }
    }
    case "named": {
      const models = await openRuntime(agentDir)
      const resources =
        where.agentDir === undefined ? none : (await load()).resources
      const model = found(models, choice)
      return {
        models,
        model,
        describeModel: model,
        images: openRouterImages(models),
        ...resources,
      }
    }
    case "configured": {
      const { settingsManager, loader, resources } = await load()
      const models = await openRuntime(agentDir)
      const { runtime } = loader.getExtensions()
      for (const { name, config } of runtime.pendingProviderRegistrations)
        models.registerProvider(name, config)
      for (const { provider } of runtime.pendingNativeProviderRegistrations)
        models.registerNativeProvider(provider)
      const picked = pickModel(
        {
          provider: settingsManager.getDefaultProvider(),
          model: settingsManager.getDefaultModel(),
        },
        choice,
      )
      if (picked === undefined)
        throw new Error(
          "no model: set defaultProvider and defaultModel in pi's settings, or PINETA_PROVIDER and PINETA_MODEL",
        )
      const model = found(models, picked)
      return {
        models,
        model,
        describeModel: model,
        images: openRouterImages(models),
        ...resources,
      }
    }
  }
}

function found(
  models: Runtime,
  named: { readonly provider: string; readonly model: string },
): Model {
  const model = models.getModel(named.provider, named.model)
  if (model === undefined)
    throw new Error(`model not found: ${named.provider}/${named.model}`)
  return model
}
