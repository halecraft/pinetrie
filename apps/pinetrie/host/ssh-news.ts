// host/ssh-news — a lane is told each change to its use of its owner's ssh
// (`AccessNews`, from lane work's `onSshNews`): a request, a refusal and a
// revoke as facts, steered into its run or appended; an approval as its
// owner's carry-on, which wakes it (`planSshNews`). Each is a late step on
// the lane's thread, so a thread out of reach is skipped by its gate, and
// is placed by the delivery an answer uses.
//
// Made after the agent, as base news is: lane work, which hears the news,
// is made before it.

import type { ThreadId } from "@pinetrie/core"
import { readParticipantNames, readThreadName } from "@pinetrie/reads"
import { type AccessNews, displayName, planSshNews } from "@pinetrie/rules"
import { type Basics, failed } from "./basics.ts"
import type { Deliver } from "./delivery.ts"
import type { Later } from "./later.ts"

export function createSshNews(deps: {
  readonly basics: Pick<Basics, "session" | "now" | "log">
  readonly later: Later
  readonly deliver: Deliver
}): { readonly told: (lane: ThreadId, news: AccessNews) => void } {
  const { basics } = deps
  return {
    told(lane, news) {
      void deps.later
        .step({ kind: "thread", thread: lane }, "a lane's ssh news", () => {
          const names = readParticipantNames(basics.session)
          const delivered = planSshNews(
            news,
            lane,
            displayName(news.owner, names.get(news.owner)),
            basics.now(),
          )
          return {
            after: async roots => {
              // Every ssh news steers a running lane, so none waits for its
              // run's end; one that would is dropped, and said.
              const placed = await deps.deliver(roots, lane, delivered, true)
              if (placed === "busy")
                basics.log(
                  `[host] ${readThreadName(basics.session, lane)}: its ssh news (${news.kind}) was not told: the lane was busy`,
                )
            },
          }
        })
        .catch(failed(basics, "telling a lane its ssh news", lane))
    },
  }
}
