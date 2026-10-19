// host/commands/mark — a canvas's or a titled card's title: gather,
// `planMark`, execute.

import type { Intent, WriterId } from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readCanvases,
  readCardTitles,
  readMarks,
  readPlaces,
} from "@pinetrie/reads"
import { planMark, titledCards } from "@pinetrie/rules"
import type { Basics } from "../basics.ts"
import type { Records } from "../records.ts"

export interface MarkDeps {
  readonly basics: Pick<Basics, "session" | "places" | "now">
  readonly records: Pick<Records, "writeValues">
}

export async function handleMark(
  deps: MarkDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "mark" }>,
): Promise<Outcome> {
  const { records } = deps
  const { session, places, now } = deps.basics
  // plan (pure), over the session's canvases and titles, and the titled cards
  // not in a trash
  const planned = planMark({
    of: intent.of,
    title: intent.title,
    by: writer,
    now: now(),
    canvases: readCanvases(places),
    marks: readMarks(session),
    titled: titledCards(readPlaces(places)),
    cardTitles: readCardTitles(session),
  })
  // execute
  switch (planned.kind) {
    case "refused":
      return planned
    case "writes":
      await records.writeValues(planned.writes)
      break
    case "unchanged":
      break
  }
  return { kind: "marked" }
}
