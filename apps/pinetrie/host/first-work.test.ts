import { threadIdFor, workflowStateIdFor } from "@pinetrie/core"
import { readCardHistories, readPlaces } from "@pinetrie/reads"
import { setRecord, WORKFLOW } from "@pinetrie/rules"
import { testWorkflow } from "@pinetrie/rules/fixtures"
import { expect, test } from "vitest"
import { basics, CANVAS_ID, placesFor, putCanvas, putValue } from "./fakes.ts"
import { moveCanvasToActive } from "./first-work.ts"

const THREAD = threadIdFor("0123456789abcdef")
const [TOPICS, ACTIVE] = [workflowStateIdFor("t"), workflowStateIdFor("a")]

test("a run's start moves its canvas as the host's own write, with no one's name", async () => {
  const b = basics()
  putValue(
    b,
    setRecord(
      WORKFLOW,
      testWorkflow(
        [
          { id: TOPICS, name: "Topics" },
          { id: ACTIVE, name: "Active" },
        ],
        { id: workflowStateIdFor("x"), name: "Archive" },
      ),
    ),
  )
  putCanvas(b, THREAD, CANVAS_ID, undefined, TOPICS)
  const deps = { basics: b, places: placesFor(b).placesWriter }
  await moveCanvasToActive(deps, THREAD)
  const canvas = () => readPlaces(b.places).find(c => c.id === CANVAS_ID)
  expect(canvas()).toMatchObject({
    place: { kind: "board", state: ACTIVE },
    content: { stateChanged: true },
  })
  expect(
    readCardHistories(b.session).get(CANVAS_ID)?.events.at(-1),
  ).toMatchObject({ by: null, to: { kind: "board", state: ACTIVE } })
  const rev = b.places.rev()
  await moveCanvasToActive(deps, THREAD)
  expect(b.places.rev()).toBe(rev)
})
