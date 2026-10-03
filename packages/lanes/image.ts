// lanes/image — the image a lane runs (ADR-0034, ADR-0041).
//
// Pineta's default image is built from `image/Containerfile`; a project's
// own `pineta.Containerfile` at its root replaces it for the project's lanes.
// Either is built once per change of its content and build arguments: the
// host's jj version for both, and the app's Playwright version for Pineta's
// (`planImages`). The builder holds 2 GiB while it runs (S42), so it is
// stopped after a build.

import { readFile } from "node:fs/promises"
import path from "node:path"
import { type ImagePlan, imageRefusal, planImages } from "./plan.ts"
import { describeFailure, run } from "./run.ts"

const DEFAULT_CONTAINERFILE = path.join(
  import.meta.dirname,
  "image",
  "Containerfile",
)
/**
 * A project's own image, when this file exists: its lanes then run it instead
 * of Pineta's default image, which carries the browser (ADR-0041) and
 * python3 (ADR-0064).
 */
export const projectContainerfile = (root: string): string =>
  path.join(root, "pineta.Containerfile")
/** The `PATH` of an image that names none. */
const STANDARD_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

/** The host's jj version, which the default image's jj is pinned to. */
async function hostJjVersion(): Promise<string> {
  const ran = await run("jj", ["--version"])
  const m = /jj (\d+\.\d+\.\d+)/.exec(ran.stdout)
  if (!ran.ok || m?.[1] === undefined)
    throw new Error(describeFailure("jj --version", ran))
  return m[1]
}

/** Build `plan`'s image unless its tag exists, then stop the builder. */
async function ensureImage(
  plan: ImagePlan,
  log: (m: string) => void,
): Promise<void> {
  if ((await run("container", ["image", "inspect", plan.tag])).ok) return
  log(`[host] building the lane image ${plan.tag} from ${plan.file}`)
  const built = await run("container", [
    "build",
    "-t",
    plan.tag,
    ...plan.buildArgs.flatMap(a => ["--build-arg", a]),
    "-f",
    plan.file,
    path.dirname(plan.file),
  ])
  await run("container", ["builder", "stop"])
  if (!built.ok) throw new Error(describeFailure("container build", built))
}

/** The image's own `PATH`, from its arm64 configuration; the standard one if it names none. */
export async function imagePath(tag: string): Promise<string> {
  const ran = await run("container", ["image", "inspect", tag])
  if (!ran.ok) throw new Error(describeFailure("container image inspect", ran))
  type Variant = {
    config?: { architecture?: string; config?: { Env?: string[] } }
  }
  const [image] = JSON.parse(ran.stdout) as { variants?: Variant[] }[]
  const variant = image?.variants?.find(v => v.config?.architecture === "arm64")
  const env = variant?.config?.config?.Env ?? []
  const found = env.find(e => e.startsWith("PATH="))
  return found === undefined ? STANDARD_PATH : found.slice("PATH=".length)
}

/**
 * The images a project's lanes need: Pineta's default, always, since the lane
 * runtime comes from it; and the project's own when it has a
 * `pineta.Containerfile`. `playwrightVersion` is the app's
 * `@playwright/test`, whose browser Pineta's image carries. Returns the tag
 * lanes run.
 */
export async function prepareImages(
  root: string,
  playwrightVersion: string,
  log: (m: string) => void,
): Promise<{ readonly lane: string; readonly runtimeFrom: string }> {
  const own = projectContainerfile(root)
  const [jjVersion, pineta, project] = await Promise.all([
    hostJjVersion(),
    readFile(DEFAULT_CONTAINERFILE, "utf8"),
    readFile(own, "utf8").catch(() => null),
  ])
  const plans = planImages({
    pineta: { file: DEFAULT_CONTAINERFILE, content: pineta },
    project: project === null ? null : { file: own, content: project },
    jjVersion,
    playwrightVersion,
  })
  await ensureImage(plans.pineta, log)
  if (plans.project !== null) await ensureImage(plans.project, log)
  return {
    lane: (plans.project ?? plans.pineta).tag,
    runtimeFrom: plans.pineta.tag,
  }
}

/**
 * Why `tag` cannot host a lane, or null. A project image needs only a POSIX
 * `sh` and git 2.41 or later: git launches its own helper programs, so it
 * cannot be carried in from outside the image as Node and jj are.
 */
export async function checkImage(tag: string): Promise<string | null> {
  const ran = await run("container", [
    "run",
    "--rm",
    tag,
    "sh",
    "-c",
    "git --version 2>/dev/null || true",
  ])
  if (!ran.ok)
    return `the lane's image cannot run \`sh\`: ${describeFailure("container run", ran)}`
  return imageRefusal(ran.stdout)
}
