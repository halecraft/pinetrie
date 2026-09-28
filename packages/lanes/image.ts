// lanes/image — the image a lane runs (ADR-0034).
//
// Pineta's default image is built from `image/Containerfile`; a project's
// own `pineta.Containerfile` at its root replaces it for the project's lanes.
// Either is built once per change of its content (and of the host's jj
// version, which the default pins), and tagged by that hash. The builder
// holds 2 GiB while it runs (S42), so it is stopped after a build.

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { imageRefusal } from "./plan.ts"
import { describeFailure, run } from "./run.ts"

const DEFAULT_CONTAINERFILE = path.join(
  import.meta.dirname,
  "image",
  "Containerfile",
)
const PROJECT_CONTAINERFILE = "pineta.Containerfile"
/** The `PATH` of an image that names none. */
const STANDARD_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

interface ImagePlan {
  readonly file: string
  readonly tag: string
  readonly buildArgs: readonly string[]
}

/** The tag an image is built as: a hash of its Containerfile and build arguments. */
function planImage(input: {
  readonly file: string
  readonly content: string
  readonly jjVersion: string
}): ImagePlan {
  const buildArgs = [`JJ_VERSION=${input.jjVersion}`]
  const hash = createHash("sha256")
    .update(input.content)
    .update("\0")
    .update(buildArgs.join("\0"))
    .digest("hex")
    .slice(0, 12)
  return { file: input.file, tag: `pineta-lane:${hash}`, buildArgs }
}

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
 * `pineta.Containerfile`. Returns the tag lanes run.
 */
export async function prepareImages(
  root: string,
  log: (m: string) => void,
): Promise<{ readonly lane: string; readonly runtimeFrom: string }> {
  const jjVersion = await hostJjVersion()
  const pineta = planImage({
    file: DEFAULT_CONTAINERFILE,
    content: await readFile(DEFAULT_CONTAINERFILE, "utf8"),
    jjVersion,
  })
  await ensureImage(pineta, log)
  const own = path.join(root, PROJECT_CONTAINERFILE)
  const content = await readFile(own, "utf8").catch(() => null)
  if (content === null) return { lane: pineta.tag, runtimeFrom: pineta.tag }
  const project = planImage({ file: own, content, jjVersion })
  await ensureImage(project, log)
  return { lane: project.tag, runtimeFrom: pineta.tag }
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
