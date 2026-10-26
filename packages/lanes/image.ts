// lanes/image — the image a lane runs.
//
// pine·trie's default image is built from `image/Containerfile`; a project's
// own `pinetrie.Containerfile` at its root replaces it for the project's lanes.
// Either is built once per change of its content and build arguments: the
// lanes' jj version for both (`laneJjVersion`), and the Playwright version the host names for
// pine·trie's (`planImages`). pine·trie's also changes with each file it copies in from
// beside it (`daemon.json`). The runtime builds and runs them.

import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  filesContainerfileCopies,
  imageRefusal,
  planImages,
} from "./image-plan.ts"
import { parsedJjVersion } from "./project-dir.ts"
import { describeFailure, run } from "./run.ts"
import type { LaneRuntime } from "./runtime-port.ts"

const DEFAULT_CONTAINERFILE = path.join(
  import.meta.dirname,
  "image",
  "Containerfile",
)
/**
 * A project's own image, when this file exists: its lanes then run it instead
 * of pine·trie's default image, which carries the browser and
 * python3.
 */
export const projectContainerfile = (root: string): string =>
  path.join(root, "pinetrie.Containerfile")

/** The host's jj version, or null when jj does not run. */
export const hostJjVersion = async (): Promise<string | null> =>
  parsedJjVersion(await run("jj", ["--version"]))

/**
 * The jj the images carry when the host has none: a folder project needs
 * no jj on the host, and its lanes still keep their history with jj.
 */
export const DEFAULT_LANE_JJ_VERSION = "0.45.1"

/**
 * The jj the images carry: the host's, so a lane's repo is one the host's jj
 * reads, else `DEFAULT_LANE_JJ_VERSION`.
 */
export const laneJjVersion = (host: string | null): string =>
  host ?? DEFAULT_LANE_JJ_VERSION

/**
 * The images a project's lanes need: pine·trie's default, always, since the lane
 * runtime comes from it; and the project's own when it has a
 * `pinetrie.Containerfile`. `playwrightVersion` is the Playwright whose
 * browser pine·trie's image carries. Returns the tag lanes run.
 */
export async function prepareImages(
  runtime: Pick<LaneRuntime, "ensureLaneImages">,
  root: string,
  playwrightVersion: string,
): Promise<{ readonly lane: string; readonly runtimeFrom: string }> {
  const own = projectContainerfile(root)
  const [hostJj, pinetrie, project] = await Promise.all([
    hostJjVersion(),
    readFile(DEFAULT_CONTAINERFILE, "utf8"),
    readFile(own, "utf8").catch(() => null),
  ])
  const sources = await Promise.all(
    filesContainerfileCopies(pinetrie).map(f =>
      readFile(path.join(path.dirname(DEFAULT_CONTAINERFILE), f), "utf8"),
    ),
  )
  const plans = planImages({
    pinetrie: {
      file: DEFAULT_CONTAINERFILE,
      content: pinetrie,
      sources,
    },
    project:
      project === null ? null : { file: own, content: project, sources: [] },
    jjVersion: laneJjVersion(hostJj),
    playwrightVersion,
  })
  // Both in one call: a build removes the images the runtime has not been
  // given yet, and the project's own would go while the default one built.
  await runtime.ensureLaneImages(
    plans.project === null ? [plans.pinetrie] : [plans.pinetrie, plans.project],
  )
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
