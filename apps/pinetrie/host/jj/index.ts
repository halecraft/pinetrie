// host/jj — jj's adapter: a project whose folder is a jj workspace, its
// accepted work a bookmark in your repo and each lane's history a jj repo of
// its own. `startJjProject` takes only a jj project's folder
// (`JjProjectDir`), and gives lane work its `Destination` and each lane's
// `LaneHistory` (`@pinetrie/jj`'s `historyOf`). What only a jj project has
// stays here: publish and setup (`accepted.ts`), WIPs, splits and stacks
// (`split.ts`, `offers/stack.ts`), and each lane's fetch into your repo
// (`fetch.ts`), which `LaneHistory`'s moves hand back as `follow`.
//
// Your repo has one writer, its owner: every read here is pinned to the head
// it last observed, and waits on no write.

import { PRODUCT_NAME } from "@pinetrie/core"
import {
  beginFacts,
  commitsOf,
  fileAt,
  historyOf,
  type JjProjectDir,
  jjIn,
  planBaseCheckout,
  prepareShared,
  readWipState,
  renameAccepted,
  revsetName,
  startRepoOwner,
} from "@pinetrie/jj"
import { baseCheckout } from "@pinetrie/lanes"
import { readRunning } from "@pinetrie/reads"
import { planBegin } from "@pinetrie/rules"
import { failed, slow } from "../basics.ts"
import type { ProjectAdapter } from "../work/adapter.ts"
import type { Destination } from "../work/destination.ts"
import { createAcceptedWork } from "./accepted.ts"
import { createFetches } from "./fetch.ts"
import { startOffers } from "./offers/index.ts"
import { createSplits } from "./split.ts"

export function startJjProject(dir: JjProjectDir): ProjectAdapter {
  const { root } = dir
  return {
    async open({ names, basics }) {
      const { log } = basics
      // Made here, from the project root and accepted work's names, before
      // anything else reads your repo: the reads below, lane work's and the
      // offers'.
      const owner = startRepoOwner({
        root,
        repoConfig: names,
        onError: failed(basics, "your repo"),
        onSlow: slow(basics, "your repo"),
      })
      // pre-accepted: the owner's first command, before its first
      // observation. Delete with `renameAccepted`.
      await owner
        .command(ops => renameAccepted(ops, names.acceptedBookmark))
        .then(
          lines => {
            for (const line of lines) log(`[host] ${line}`)
          },
          failed(basics, "renaming accepted work's bookmark"),
        )
      const acceptedRev = `present(${revsetName(names.acceptedBookmark)})`

      const fileAtNow: Destination["fileAt"] = (point, path) =>
        owner.read(({ jj }) => fileAt(jj, names, point, path))

      return {
        fileAt: fileAtNow,
        prepareShared: entries => prepareShared(root, entries),
        async identity() {
          // Your jj config, not your repo: asked from its root, as startup asks.
          const config = async (key: string, fallback: string) => {
            const ran = await jjIn(root, ["config", "get", key])
            return ran.ok && ran.stdout.trim() !== ""
              ? ran.stdout.trim()
              : fallback
          }
          return {
            name: await config("user.name", `${PRODUCT_NAME} agent`),
            email: await config("user.email", "agent@pinetrie.invalid"),
          }
        },
        acceptedNow: () => owner.read(({ jj }) => commitsOf(jj, acceptedRev)),
        baseSteps: input => baseCheckout(planBaseCheckout(input)),

        start(parts) {
          const { registry, keeper, piSetup } = parts
          const accepted = createAcceptedWork({
            owner,
            basics,
            repoConfig: names,
            writeValues: writes => parts.records.writeValues(writes),
          })
          // The base snapshot follows accepted work, however it moved: setup,
          // an accept, a publish, or jj outside pine·trie.
          owner.onMoved(moved => {
            if (moved.acceptedMoved) parts.acceptedMoved()
          })
          const offers = startOffers({
            owner,
            repoConfig: names,
            basics,
            records: parts.records,
            piSetup,
            running: lane => readRunning(basics.live, lane),
            baseChanged: parts.baseChanged,
            acceptedWork: accepted,
          })
          const fetches = createFetches({
            basics,
            owner,
            registry,
            keeper,
            startContainer: parts.startContainer,
          })
          const splits = createSplits({
            basics,
            owner,
            registry,
            offers,
            piSetup,
            beforeRun: parts.beforeRun,
            fetchLane: fetches.fetchLane,
          })
          const destination: Destination = {
            fileAt: fileAtNow,
            // Where agent work begins for `base`, read at the head the owner
            // last observed.
            async begin(base) {
              return planBegin({
                base,
                wipPrefix: names.wipPrefix,
                facts: await owner.read(({ jj }) =>
                  beginFacts(jj, names, base),
                ),
              })
            },
            async baseNow(base) {
              const { state, begin } = await owner.read(async ({ jj }) => ({
                state: await readWipState(jj, names, base),
                begin: await beginFacts(
                  jj,
                  names,
                  base?.base.kind === "wip" ? base.base.bookmark : null,
                ),
              }))
              return {
                state,
                acceptedCommit: begin.acceptedCommit,
                wipNow: begin.wip,
              }
            },
            lanesMoved: refs => offers.moveLanes(refs),
            offers,
            accepted,
            quiet: () => owner.idle(),
            close: () => owner.close(),
          }
          return {
            destination,
            history: (lane, runners) =>
              historyOf({
                lane,
                runners,
                repoConfig: names,
                fetch: have => void fetches.fetchLane(lane, have),
              }),
            splits,
          }
        },
      }
    },
  }
}
