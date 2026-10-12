// lanes/image — the image a lane runs.
//
// pine·trie's default image is built from `image/Containerfile`; a project's
// own `pinetrie.Containerfile` at its root replaces it for the project's lanes.
// Either is built once per change of its content and build arguments: the
// host's jj version for both, and the app's Playwright version for pine·trie's
// (`planImages`). The runtime builds and runs them.

import { readFile } from "node:fs/promises"
import path from "node:path"
import { type ImagePlan, imageRefusal, planImages } from "./plan.ts"
import { describeFailure, run } from "./run.ts"
import type { LaneRuntime } from "./runtime-port.ts"

const DEFAULT_CONTAINERFILE = path.join(
  import.meta.dirname,
  "image",
  "Containerfile",
)
/** What the default image's build stage compiles: the supervisor. */
const SUPERVISE_SOURCE = path.join(import.meta.dirname, "image", "supervise.c")
/**
 * A project's own image, when this file exists: its lanes then run it instead
 * of pine·trie's default image, which carries the browser and
 * python3.
 */
export const projectContainerfile = (root: string): string =>
  path.join(root, "pinetrie.Containerfile")

/** The host's jj version, which the default image's jj is pinned to. */
async function hostJjVersion(): Promise<string> {
  const ran = await run("jj", ["--version"])
  const m = /jj (\d+\.\d+\.\d+)/.exec(ran.stdout)
  if (!ran.ok || m?.[1] === undefined)
    throw new Error(describeFailure("jj --version", ran))
  return m[1]
}

/** Build `plan`'s image unless its tag exists. */
async function ensureImage(
  runtime: LaneRuntime,
  plan: ImagePlan,
  log: (m: string) => void,
): Promise<void> {
  if (await runtime.imageExists(plan.tag)) return
  log(`[host] building the lane image ${plan.tag} from ${plan.file}`)
  await runtime.buildImage(plan)
}

/**
 * The images a project's lanes need: pine·trie's default, always, since the lane
 * runtime comes from it; and the project's own when it has a
 * `pinetrie.Containerfile`. `playwrightVersion` is the app's
 * `@playwright/test`, whose browser pine·trie's image carries. Returns the tag
 * lanes run.
 */
export async function prepareImages(
  runtime: LaneRuntime,
  root: string,
  playwrightVersion: string,
  log: (m: string) => void,
): Promise<{ readonly lane: string; readonly runtimeFrom: string }> {
  const own = projectContainerfile(root)
  const [jjVersion, pinetrie, supervise, project] = await Promise.all([
    hostJjVersion(),
    readFile(DEFAULT_CONTAINERFILE, "utf8"),
    readFile(SUPERVISE_SOURCE, "utf8"),
    readFile(own, "utf8").catch(() => null),
  ])
  const plans = planImages({
    pinetrie: {
      file: DEFAULT_CONTAINERFILE,
      content: pinetrie,
      sources: [supervise],
    },
    project:
      project === null ? null : { file: own, content: project, sources: [] },
    jjVersion,
    playwrightVersion,
  })
  await ensureImage(runtime, plans.pinetrie, log)
  if (plans.project !== null) await ensureImage(runtime, plans.project, log)
  return {
    lane: (plans.project ?? plans.pinetrie).tag,
    runtimeFrom: plans.pinetrie.tag,
  }
}

/**
 * Why `tag` cannot host a lane, or null. A project image needs only a POSIX
 * `sh` and git 2.41 or later: git launches its own helper programs, so it
 * cannot be carried in from outside the image as Node and jj are.
 */
export async function checkImage(
  runtime: LaneRuntime,
  tag: string,
): Promise<string | null> {
  const ran = await runtime.runInImage(tag, [
    "sh",
    "-c",
    "git --version 2>/dev/null || true",
  ])
  if (!ran.ok)
    return `the lane's image cannot run \`sh\`: ${describeFailure(`running ${tag}`, ran)}`
  return imageRefusal(new TextDecoder().decode(ran.stdout))
}
