// e2e/host/archive — archiving a root (ADR-0029) and titling one (ADR-0045),
// through the command Line. What either decides is unit-tested
// (`@pineta/marginalia`'s `archive.test.ts` and `mark.test.ts`, the host's
// `commands/*.test.ts`); this proves the dispatcher routes each command to it
// and the record reaches another client.

import { entryId, ROOT } from "@pineta/core"
import { scriptedModel } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import { readArchive, readMarks } from "@pineta/reads"
import type { Checks } from "../checks.ts"
import { join, waitFor, withHost } from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import { START_CHAT } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

const appended = (o: Outcome) => (o.kind === "appended" ? o.id : "")

async function run(check: Checks["check"]): Promise<void> {
  await withHost(
    { model: { kind: "scripted", script: scriptedModel() }, log: () => {} },
    async host => {
      const ada = await join(host, "ada", "archive")
      const bea = await join(host, "bea", "archive")
      const r1 = appended(await ada.chat("first root", ROOT, START_CHAT))
      const r2 = appended(await ada.chat("second root", ROOT, START_CHAT))

      const archived = await ada.archive("archive", entryId(r1))
      const seen = await waitFor(
        () => readArchive(bea.doc).get(r1)?.state === "archived",
        10_000,
      )
      const record = readArchive(host.doc).get(r1)
      check(
        "a root is archived, by its archiver, and another client sees it",
        archived.kind === "archived" &&
          record?.state === "archived" &&
          record.by === ada.writer &&
          seen >= 0,
        archived.kind,
      )

      const titled = await bea.mark(entryId(r2), "Tab names")
      const mark = readMarks(host.doc).get(r2)
      check(
        "a root is titled, by its writer",
        titled.kind === "marked" &&
          mark?.title === "Tab names" &&
          mark.by === bea.writer,
        titled.kind,
      )
      await Promise.all([ada.close(), bea.close()])
    },
  )
}
