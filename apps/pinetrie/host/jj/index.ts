// host/jj — jj's adapter: a project whose folder is a jj workspace, its
// accepted work a bookmark in your repo and each lane's history a jj repo of
// its own. `startJjProject` takes only a jj project's folder
// (`JjProjectDir`), and gives lane work its `Destination` and each lane's
// `LaneHistory` (`@pinetrie/jj`'s `historyOf`). What only a jj project has
// stays here: publish and setup (`accepted.ts`), WIPs, splits and stacks
// (`split.ts`, `proposed/stack.ts`), and each lane's fetch into your repo
// (`fetch.ts`), which `LaneHistory`'s moves hand back as `follow`.
//
// Your repo has one writer, its owner: every read here is pinned to the head
// it last observed, and waits on no write.

import {
  type CommitId,
  PRODUCT_NAME,
  pointFromCommit,
  type ThreadId,
} from "@pinetrie/core"
import {
  baseInCommits,
  beginFacts,
  commitFromPoint,
  commitsOf,
  fileAt,
  historyOf,
  type JjProjectDir,
  jjIn,
  planBaseCheckout,
  planTidyHint,
  prepareShared,
  proveJjLane,
  readOpLog,
  readWipState,
  renameProposed,
  revsetName,
  startRepoOwner,
  TIDY_DAYS,
  type TimedCommand,
} from "@pinetrie/jj"
import { baseCheckout } from "@pinetrie/lanes"
import { readLaneRecords, readRunning } from "@pinetrie/reads"
import { planBegin } from "@pinetrie/rules"
import { type Basics, failed, slow } from "../basics.ts"
import { tidyWords } from "../tidy.ts"
import type { ProjectAdapter } from "../work/adapter.ts"
import type { Destination } from "../work/destination.ts"
import { createAcceptedWork } from "./accepted.ts"
import { createFetches } from "./fetch.ts"
import { startProposedChanges } from "./proposed/index.ts"
import { recordedJjLane, requireJjLane } from "./proven.ts"
import { createSplits } from "./split.ts"

/** A slow command's words: its arguments cut to a line, as a template or revset can run long. */
const commandWords = (c: TimedCommand): string => {
  const words = `${c.program} ${c.args.join(" ")}`.replace(/\s+/g, " ")
  return words.length > 120 ? `${words.slice(0, 119)}…` : words
}

/**
 * An `onSlowCommand` handler that logs `[host] <where>: <command> ran <n> ms`:
 * one command, where `slow` names only the step it ran in.
 */
function slowCommand(
  basics: Pick<Basics, "log">,
  where: string,
): (command: TimedCommand) => void {
  return c =>
    basics.log(`[host] ${where}: ${commandWords(c)} ran ${Math.round(c.ms)} ms`)
}

export function startJjProject(dir: JjProjectDir): ProjectAdapter {
  const { root } = dir
  return {
    kind: "jj",
    async open({ names, basics }) {
      const { log } = basics
      // Made here, from the project root and accepted work's names, before
      // anything else reads your repo: the reads below, lane work's and the
      // proposed changes'.
      const owner = startRepoOwner({
        root,
        repoConfig: names,
        onError: failed(basics, "your repo"),
        onSlow: slow(basics, "your repo"),
        onSlowCommand: slowCommand(basics, "your repo"),
      })
      // pre-proposed: the owner's first command, before its first
      // observation, so its renames mark no refresh. Delete with
      // `renameProposed`.
      await owner
        .command(ops => renameProposed(ops))
        .then(
          lines => {
            for (const line of lines) log(`[host] ${line}`)
          },
          failed(basics, "renaming the proposed changes' bookmarks"),
        )
      // Read beside the start, never awaited: the whole op log, once, to say
      // when `pnpm tidy` would cut it.
      void owner.track(
        owner
          .read(({ jj }) => readOpLog(jj))
          .then(
            facts => {
              const hint = planTidyHint(facts, {
                days: TIDY_DAYS,
                now: Math.floor(basics.now() / 1000),
              })
              if (hint !== null)
                log(
                  `[host] ${tidyWords({ kind: "hint", ...hint, keep: TIDY_DAYS })}`,
                )
            },
            () => {},
          ),
      )
      const acceptedRev = `present(${revsetName(names.acceptedBookmark)})`

      const fileAtNow: Destination["fileAt"] = (site, path) =>
        owner.read(({ jj }) => fileAt(jj, names, site, path))

      return {
        kind: "jj",
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
        async acceptedNow() {
          const yours = await owner.read(({ jj }) => commitsOf(jj, acceptedRev))
          return {
            points: yours.map(pointFromCommit),
            checkout: (fresh: boolean) =>
              baseCheckout(planBaseCheckout({ yours, fresh })),
          }
        },

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
          const proposed = startProposedChanges({
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
            proposed,
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
            async baseNow(record, base) {
              const lane = requireJjLane(record)
              const commits = base === null ? null : baseInCommits(lane, base)
              const { state, begin } = await owner.read(async ({ jj }) => ({
                state: await readWipState(jj, names, commits),
                begin: await beginFacts(
                  jj,
                  names,
                  base?.base.kind === "wip" ? base.base.bookmark : null,
                ),
              }))
              return {
                state,
                acceptedPoint:
                  begin.acceptedCommit === null
                    ? null
                    : pointFromCommit(begin.acceptedCommit),
                wipNow: begin.wip,
              }
            },
            // A lane jj cannot read has no ref in your repo to move: left.
            lanesMoved(refs) {
              const records = readLaneRecords(basics.session)
              return proposed.moveLanes(
                refs.flatMap<{
                  readonly lane: ThreadId
                  readonly commit: CommitId | null
                }>(({ lane, point }) => {
                  if (point === null) return [{ lane, commit: null }]
                  const proved = recordedJjLane(records, lane)
                  return proved === null
                    ? []
                    : [{ lane, commit: commitFromPoint(proved, point) }]
                }),
              )
            },
            proposed,
            accepted,
            quiet: () => owner.idle(),
            close: () => owner.close(),
          }
          return {
            destination,
            history(record, runners) {
              const proved = proveJjLane(record)
              if (proved.kind !== "jj") return proved
              const { lane } = proved
              return {
                kind: "history",
                history: historyOf({
                  lane,
                  runners,
                  repoConfig: names,
                  fetch: have => void fetches.fetchLane(lane.lane, have),
                }),
              }
            },
            splits,
          }
        },
      }
    },
  }
}
