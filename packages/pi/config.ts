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
import { createModels } from "@earendil-works/pi-ai"
import {
  type buildSystemPrompt,
  DefaultResourceLoader,
  ModelRuntime,
  SettingsManager,
} from "./deep.ts"
import { fauxOf, type ScriptedModel } from "./scripted.ts"

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

const DEFAULT_AGENT_DIR = path.join(homedir(), ".pi", "agent")

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

/** What `createAgent` needs from the choice. */
export interface ModelSetup {
  readonly models: Models
  readonly model: Model
  /** Context files for the system prompt, such as the repo's `AGENTS.md`. */
  readonly contextFiles: PromptInput["contextFiles"]
  readonly skills: PromptInput["skills"]
}

export async function setUpModel(
  choice: ModelChoice,
  where: { readonly cwd: string; readonly agentDir?: string },
): Promise<ModelSetup> {
  const agentDir = where.agentDir ?? DEFAULT_AGENT_DIR
  switch (choice.kind) {
    case "scripted": {
      const faux = fauxOf(choice.script)
      const models = createModels()
      models.setProvider(faux.provider)
      return { models, model: faux.getModel(), contextFiles: [], skills: [] }
    }
    case "named": {
      const models = await openRuntime(agentDir)
      return {
        models,
        model: found(models, choice),
        contextFiles: [],
        skills: [],
      }
    }
    case "configured": {
      const settingsManager = SettingsManager.create(where.cwd, agentDir)
      const loader = new DefaultResourceLoader({
        cwd: where.cwd,
        agentDir,
        settingsManager,
      })
      await loader.reload()
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
      return {
        models,
        model: found(models, picked),
        contextFiles: loader.getAgentsFiles().agentsFiles,
        skills: loader.getSkills().skills,
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
