// pi/pi-setup — the model setup, loaded from what the host's config settled:
// the model and its one-off requests, the image model for banners, and the
// commands and skills the config lists. It reads no document, so the host
// loads it before lane work, and `createAgent` builds every harness from it.

import path from "node:path"
import type { ModelLine } from "@pinetrie/core"
import { labelCommands, type ModelRef } from "@pinetrie/rules"
import type { AgentDirBinding } from "./agent-dir.ts"
import { type Banners, banners } from "./banner.ts"
import { type CommandFiles, commandFiles } from "./commands.ts"
import {
  type Completed,
  complete,
  loadModelSetup,
  type ModelChoice,
  type ModelPlaces,
  type ModelSetup,
  NO_RESOURCES,
  type ResourceLists,
  titleModel,
} from "./config.ts"
import { sealed } from "./inside.ts"

/**
 * pinetrie's own skills, loaded after yours and the repo's:
 * `resolve-conflicts`, `commit-message`, `proposed-changes-stack`,
 * `column-banner`, `ask-digest`, `tab-title`, `thread-focus` and
 * `agents-round`.
 */
const SKILLS_DIR = path.join(import.meta.dirname, "skills")

/** Every member is a string, our own shape, or a promise of one: no pi type crosses. */
export interface PiSetup extends CommandFiles, Banners {
  readonly model: ModelLine
  /** False when the config names a title model pi does not have: titles use the run's. */
  readonly titleModelFound: boolean
  /** Listed packages that are not folders: pi was never given them. */
  readonly refusedPackages: readonly string[]
  /** Each provider with a credential, and where pi found it; never the credential. */
  readonly credentials: readonly {
    readonly provider: string
    readonly source: string
  }[]
  /** The context files the model is given. */
  readonly contextFiles: readonly string[]
  /**
   * One request outside every thread, with no tools and no session
   * (`complete` in `config.ts`), on the title model for `purpose` `title`,
   * else the describe model: its text, null when it fails or there is no
   * model, and the tokens it spent.
   */
  complete(request: {
    readonly system: string
    readonly user: string
    readonly purpose?: "title"
  }): Promise<Completed>
}

export interface PiSetupOptions {
  readonly model: ModelChoice
  /** Where pine·trie keeps what pi's code reads. */
  readonly places: ModelPlaces
  /** pi's agent directory, bound to pine·trie's for this process. */
  readonly binding: AgentDirBinding
  /** The packages, skills and prompts the config lists. */
  readonly lists?: ResourceLists
  /**
   * The project: where `AGENTS.md` loads from, with tools on or off, and
   * where a call that names no lane works. Absent, the process's working
   * directory: no project, as in a suite.
   */
  readonly project?: string
  /** `commands.names`: a listed package's path → a label. */
  readonly commandRenames?: Readonly<Record<string, string>>
  /** The image model banners are drawn with, when icons are `drawn`; without it `drawBanner` draws nothing. */
  readonly banner?: ModelRef
  /** The config's title model; null or absent for the run's. */
  readonly titleModel?: ModelRef | null
}

/** What `createAgent` builds every harness from. */
interface SetupInside {
  readonly setup: ModelSetup
  /** The project's directory: where a call that names no lane works. */
  readonly project: string
}

export const setupInside = sealed<PiSetup, SetupInside>("loadPiSetup")

const refLabel = (ref: ModelRef): string => `${ref.provider}/${ref.model}`

export async function loadPiSetup(options: PiSetupOptions): Promise<PiSetup> {
  const project = options.project ?? process.cwd()
  const setup = await loadModelSetup(options.model, {
    cwd: project,
    places: options.places,
    binding: options.binding,
    lists: options.lists ?? NO_RESOURCES,
    skillsDir: SKILLS_DIR,
  })
  const titles = titleModel(
    setup,
    options.titleModel ?? null,
    options.model.kind === "scripted",
  )
  const state = setup.model
  return setupInside.seal(
    {
      ...commandFiles(
        labelCommands(setup.commands, options.commandRenames ?? {}),
        options.project ?? null,
      ),
      ...banners(setup.images, options.banner),
      model:
        state.kind === "model"
          ? {
              kind: "model",
              label: `${state.model.provider}/${state.model.id}`,
            }
          : {
              kind: "none",
              why: state.why,
              named: state.named === null ? null : refLabel(state.named),
            },
      titleModelFound: titles.found,
      refusedPackages: setup.refusedPackages,
      credentials: setup.credentials,
      contextFiles: (setup.contextFiles ?? []).map(f => f.path),
      complete: ({ purpose, ...request }) =>
        complete(
          setup,
          purpose === "title" ? titles.model : setup.describeModel,
          request,
        ),
    },
    { setup, project },
  )
}
