// jj/file-at — a file at a site in your repo: accepted work, a lane's tip
// (its history's remote bookmark), or the start its base names there.

import type { RepoConfig } from "@pinetrie/core"
import type { FileAt, ReadSite, Runner } from "@pinetrie/lanes"
import { laneBase } from "./lane/base.ts"
import { laneTipName, revsetName } from "./lane/names.ts"
import { commitsOf, fileText } from "./lane/revisions.ts"

/** `path` at `site` in the repo `jj` reads. */
export async function fileAt(
  jj: Runner,
  repoConfig: RepoConfig,
  site: ReadSite,
  path: string,
): Promise<FileAt> {
  let at: string | undefined =
    `present(${revsetName(repoConfig.acceptedBookmark)})`
  if (site.kind !== "accepted") {
    const tip = laneTipName(site.lane)
    ;[at] = await commitsOf(jj, `present(${tip})`)
    if (at !== undefined && site.kind === "start")
      at = (await laneBase(jj, tip, repoConfig))?.start
  }
  return at === undefined
    ? { kind: "no-site" }
    : { kind: "read", at, text: await fileText(jj, at, path) }
}
