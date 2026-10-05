// e2e/host/presence — who is here, per open column, decaying (ADR-0024).

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { batch } from "@kyneta/schema"
import { scriptedModel } from "@pineta/pi"
import { readReading, readTyping } from "@pineta/reads"
import { openStore } from "../../host/store.ts"
import type { Checks } from "../checks.ts"
import { join, refusedWrite, startSuiteHost, waitFor } from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import { sleep } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  // Its own host, with a short decay, and a store whose records it reads.
  {
    const decay = { presenceMs: 300, typingMs: 300 }
    const dbFile = path.join(
      mkdtempSync(path.join(tmpdir(), "pineta-presence-")),
      "pineta.db",
    )
    const phStore = openStore(dbFile).store
    const ph = await startSuiteHost({
      model: { kind: "scripted", script: scriptedModel() },
      store: phStore,
      presenceDecay: decay,
      log: () => {},
    })
    const joinHere = (name: string) =>
      join(ph, name, "presence", { presenceDecay: decay })
    const ada = await joinHere("ada")
    const bea = await joinHere("bea")
    ada.setReading("c1", "e-one", null)
    ada.setReading("c2", "e-two", null)
    ada.setTyping("e-two", null)
    const seen = await waitFor(
      () => readReading(bea.presence).length === 2,
      5_000,
    )
    const reading = readReading(bea.presence)
    check(
      "each open column is reported, and another client sees them",
      seen >= 0 &&
        reading.every(([w]) => w === ada.writer) &&
        reading
          .map(([, e]) => e)
          .sort()
          .join() === "e-one,e-two" &&
        readTyping(bea.presence).some(
          ([w, e]) => w === ada.writer && e === "e-two",
        ),
      `${reading.length} columns`,
    )
    // A closed column's key is deleted, not left to decay: decay keeps the key
    // holding null, so only a deletion removes it. c1 stays refreshed meanwhile. As
    // the app does, the column stops being refreshed before it is deleted: a
    // write and a deletion of one key in the same millisecond diverge across
    // peers in Kyneta today (docs/pineta.md, open items).
    await sleep(20)
    ada.clearReading("c2")
    const closed = await waitFor(() => {
      ada.setReading("c1", "e-one", null)
      return (
        !Object.keys(bea.presence.reading()).some(
          k => k.startsWith(`${ada.writer}:`) && k.endsWith(":c2"),
        ) && readReading(bea.presence).length === 1
      )
    }, 5_000)
    check("a closed column's entry is deleted from others' view", closed >= 0)
    await ada.close()
    // Clients may not write the session (`writersPolicy`, on every peer): the
    // write throws before it is made.
    const refused = refusedWrite(() =>
      batch(bea.session, d =>
        d.values.set("forged", { value: "bea is the host" }),
      ),
    )
    await sleep(500)
    check(
      "a client cannot write the session: its write is refused before it is made, and the host's copy is unchanged",
      refused && ph.session.values.get("forged") === undefined,
      `refused ${refused}`,
    )
    await bea.close()
    await sleep(100)
    await ph.shutdown()
  }
}
