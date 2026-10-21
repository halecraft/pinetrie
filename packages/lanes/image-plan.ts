// lanes/image-plan — the lane images a host needs, each tagged by what it is
// built from, and why an image cannot host a lane.

import { createHash } from "node:crypto"

/** The oldest git a lane's image may have: jj's fetch needs 2.41. */
const MIN_GIT: readonly [number, number] = [2, 41]

/**
 * Why an image cannot host a lane, from `git --version`'s output (empty when
 * git is missing), or null when it can.
 */
export function imageRefusal(gitVersion: string): string | null {
  const m = /git version (\d+)\.(\d+)/.exec(gitVersion)
  if (m === null)
    return "the lane's image has no git; a project image needs git 2.41 or later"
  const [major, minor] = [Number(m[1]), Number(m[2])]
  const ok = major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1])
  return ok
    ? null
    : `the lane's image has git ${major}.${minor}; it needs 2.41 or later`
}

/** An image to build: its Containerfile, and the tag its content decides. */
export interface ImagePlan {
  readonly file: string
  readonly tag: string
  readonly buildArgs: readonly string[]
}

/**
 * A Containerfile as read: its path, its text, and the text of each file it
 * copies in from beside it, which decide the image as much as it does.
 */
interface Containerfile {
  readonly file: string
  readonly content: string
  readonly sources: readonly string[]
}

/**
 * The paths, from the build context, that a Containerfile's `COPY` and `ADD`
 * lines copy in: every word but the last on each, options aside. A copy from
 * another stage (`--from=`) copies nothing in. One line per instruction: a
 * line continued with `\` is not read on.
 */
export function filesContainerfileCopies(content: string): readonly string[] {
  return content.split("\n").flatMap(line => {
    const found = /^\s*(?:COPY|ADD)\s+(.+)$/i.exec(line)
    if (found?.[1] === undefined) return []
    const words = found[1].trim().split(/\s+/)
    if (words.some(w => w.startsWith("--from="))) return []
    return words.filter(w => !w.startsWith("--")).slice(0, -1)
  })
}

/**
 * The images a project's lanes need. pine·trie's is built
 * with the host's jj version and the app's Playwright version, so its jj and
 * its browser match what drives them. A project's own image gets the jj
 * version only. Each is tagged by a hash of its Containerfile and build
 * arguments, so a change of either builds it again.
 */
export function planImages(input: {
  readonly pinetrie: Containerfile
  /** The project's `pinetrie.Containerfile`, or null when it has none. */
  readonly project: Containerfile | null
  readonly jjVersion: string
  readonly playwrightVersion: string
}): { readonly pinetrie: ImagePlan; readonly project: ImagePlan | null } {
  const jj = `JJ_VERSION=${input.jjVersion}`
  return {
    pinetrie: imagePlan(input.pinetrie, [
      jj,
      `PLAYWRIGHT_VERSION=${input.playwrightVersion}`,
    ]),
    project: input.project === null ? null : imagePlan(input.project, [jj]),
  }
}

function imagePlan(
  containerfile: Containerfile,
  buildArgs: readonly string[],
): ImagePlan {
  const hash = createHash("sha256")
    .update(containerfile.content)
    .update("\0")
    .update(buildArgs.join("\0"))
    .update("\0")
    .update(containerfile.sources.join("\0"))
    .digest("hex")
    .slice(0, 12)
  return { file: containerfile.file, tag: `pinetrie-lane:${hash}`, buildArgs }
}
