// Disposable: a folder lane begun twice, as a fork run again after its first
// `begun` wrote its start state would leave it.
import { lineStateId, pointId, startStateId, type StateRecord, threadIdFor } from "@pinetrie/core"
import { laneNewest, stateGraph } from "@pinetrie/folder"

const lane = threadIdFor("01a14b40-71fd-777c-adc5-abe68c5fac06")
const line = lineStateId("0001")
const start = (uuid: string): StateRecord => ({
  id: startStateId(uuid),
  parents: [line],
  made: { kind: "start", lane },
  at: 1,
  by: null,
})
const lineRecord = { id: line, parents: [], made: { kind: "read" }, at: 0, by: null } as unknown as StateRecord
for (const states of [[lineRecord, start("a")], [lineRecord, start("a"), start("b")]]) {
  try {
    console.log(states.length - 1, "start state(s):", laneNewest(stateGraph(states), lane))
  } catch (error) {
    console.log(states.length - 1, "start state(s): throws", (error as Error).message)
  }
}
