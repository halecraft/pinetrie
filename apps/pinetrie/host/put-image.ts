// host/put-image — `put_image`'s answer: gather the places and the cards'
// titles, plan where the image goes (`planImageAsk`), then carry it out as
// the thread's person, through the commands a person's put goes through, and
// title a column it made as the agent asked.

import { errorText, type ThreadId, type WriterId } from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { readCardTitles, readPlaces } from "@pinetrie/reads"
import {
  type PutImageAsk,
  planImageAsk,
  type ToolAnswer,
} from "@pinetrie/rules"
import { cardIdOfKind, type Intent } from "@pinetrie/threads"
import type { Basics } from "./basics.ts"

const answer = (text: string, isError: boolean): ToolAnswer => ({
  text,
  isError,
  details: null,
})

/** Why an outcome put nothing, as the agent reads it; null for one that did. */
function refusalText(outcome: Outcome): string | null {
  switch (outcome.kind) {
    case "refused":
    case "failed":
      return `Not put: ${outcome.message}`
    case "unmoved":
      return `Not put: ${outcome.code}`
    default:
      return null
  }
}

export function createPutImage(deps: {
  readonly basics: Pick<Basics, "places" | "session" | "newId">
  /** A command carried out as one off the socket is (`Commands.perform`). */
  readonly perform: (writer: WriterId, intent: Intent) => Promise<Outcome>
}): (lane: ThreadId, ask: PutImageAsk) => Promise<ToolAnswer> {
  const { places, session, newId } = deps.basics
  return async (lane, ask) => {
    // gather
    const cards = readPlaces(places)
    const writer = cards.find(c => c.id === lane)?.owner
    if (writer === undefined)
      return answer("This thread has no card to put an image from.", true)
    // plan
    const card = cardIdOfKind("image", newId())
    const plan = planImageAsk({
      ask,
      thread: lane,
      cards,
      titles: readCardTitles(session),
      card,
    })
    // execute
    try {
      switch (plan.kind) {
        case "refused":
          return answer(plan.text, true)
        case "version": {
          const done = await deps.perform(writer, plan.intent)
          const refused = refusalText(done)
          return refused !== null
            ? answer(refused, true)
            : answer(`Added a version of ${plan.intent.image}.`, false)
        }
        case "put": {
          const done = await deps.perform(writer, plan.intent)
          const refused = refusalText(done)
          if (refused !== null) return answer(refused, true)
          const put = readPlaces(places).find(c => c.id === card)
          const column = put?.place.kind === "image" ? put.place.column : null
          if (plan.columnTitle !== null && column !== null)
            await deps.perform(writer, {
              kind: "mark",
              of: { kind: "card", card: column },
              title: plan.columnTitle,
            })
          return answer(
            `The image ${card} is in the media column ${column ?? "made for it"}.`,
            false,
          )
        }
      }
    } catch (error) {
      return answer(`Not put: ${errorText(error)}`, true)
    }
  }
}
