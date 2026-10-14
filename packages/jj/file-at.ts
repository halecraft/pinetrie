// jj/file-at — a file at a point of your repo: accepted work, a lane's tip
// (its history's remote bookmark), or the start its base names there.

import type { RepoConfig } from "@pinetrie/core"
import type { FileAt, Point, Runner } from "@pinetrie/lanes"
import { laneBase } from "./lane/base.ts"
import { laneTipName, revsetName } from "./lane/names.ts"
import { commitsOf, fileText } from "./lane/revisions.ts"

/** `path` at `point` of the repo `jj` reads. */
export async function fileAt(
  jj: Runner,
  repoConfig: RepoConfig,
  point: Point,
  path: string,
): Promise<FileAt> {
  let at: string | undefined =
    `present(${revsetName(repoConfig.acceptedBookmark)})`
  if (point.kind !== "accepted") {
    const tip = laneTipName(point.lane)
    ;[at] = await commitsOf(jj, `present(${tip})`)
    if (at !== undefined && point.kind === "start")
      at = (await laneBase(jj, tip, repoConfig))?.start
  }
  return at === undefined
    ? { kind: "no-point" }
    : { kind: "read", at, text: await fileText(jj, at, path) }
}
