// pi/pi-setup — the person's pi setup, loaded: the model and its
// one-off requests, the image model for banners, and the commands and skills
// pi found in the agent directory and the project. It reads no document, so
// the host loads it before lane work, and `createAgent` builds every harness
// from it.

import path from "node:path"
import {
  type BannerConfig,
  labelCommands,
  type ModelRef,
} from "@pinetrie/rules"
import { type Banners, banners } from "./banner.ts"
import { type CommandFiles, commandFiles } from "./commands.ts"
import {
  type Completed,
  complete,
  DEFAULT_AGENT_DIR,
  loadModelSetup,
  type ModelChoice,
  type ModelOrigin,
  type ModelSetup,
  titleModelOf,
} from "./config.ts"
import { sealed } from "./inside.ts"

/**
 * pinetrie's own skills, loaded after yours and the repo's: `resolve-conflicts`,
 * `commit-message`, `offer-stack`, `column-banner`, `ask-digest`,
 * `tab-title` and `agents-round`.
 */
const SKILLS_DIR = path.join(import.meta.dirname, "skills")

/** Every member is a string, our own shape, or a promise of one: no pi type crosses. */
export interface PiSetup extends CommandFiles, Banners {
  readonly modelLabel: string
  /** Where the model came from: an override or a settings file, per field. */
  readonly modelOrigin: ModelOrigin
  /** False when the user config names a title model pi does not have: titles use the run's. */
  readonly titleModelFound: boolean
  /** pi's agent directory: settings, packages, and `auth.json`. Never mounted into a lane. */
  agentDir(): string
  /**
   * One request outside every thread, with no tools and no session
   * (`complete` in `config.ts`), on the title model for `purpose` `title`,
   * else the describe model: its text, null when it fails, and the tokens
   * it spent.
   */
  complete(request: {
    readonly system: string
    readonly user: string
    readonly purpose?: "title"
  }): Promise<Completed>
}

export interface PiSetupOptions {
  readonly model: ModelChoice
  /**
   * The project: where pi's settings, `AGENTS.md` and skills load from, with
   * tools on or off, and where a call that names no lane works. Absent, the
   * process's working directory: no project, as in a suite.
   */
  readonly project?: string
  /**
   * pi's agent directory. With a scripted or named model, skills and prompts
   * load only when this is given: a suite's fixture, never the person's own.
   */
  readonly agentDir?: string
  /** The user config's `commands.names`: pi's `source` → a label. */
  readonly commandRenames?: Readonly<Record<string, string>>
  /** Column banners' image model, when the user config enables them; without it `drawBanner` draws nothing. */
  readonly banner?: BannerConfig
  /** The user config's title model; null or absent for the run's. */
  readonly titleModel?: ModelRef | null
}

/** What `createAgent` builds every harness from. */
interface SetupInside {
  readonly setup: ModelSetup
  /** The project's directory: where a call that names no lane works. */
  readonly project: string
}

export const setupInside = sealed<PiSetup, SetupInside>("loadPiSetup")

export async function loadPiSetup(options: PiSetupOptions): Promise<PiSetup> {
  const project = options.project ?? process.cwd()
  const setup = await loadModelSetup(options.model, {
    cwd: project,
    skillsDir: SKILLS_DIR,
    ...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
  })
  const titles = titleModelOf(
    setup,
    options.titleModel ?? null,
    options.model.kind === "scripted",
  )
  return setupInside.seal(
    {
      ...commandFiles(
        labelCommands(setup.commands, options.commandRenames ?? {}),
      ),
      ...banners(setup.images, options.banner),
      modelLabel: `${setup.model.provider}/${setup.model.id}`,
      modelOrigin: setup.origin,
      titleModelFound: titles.found,
      agentDir: () => options.agentDir ?? DEFAULT_AGENT_DIR,
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
