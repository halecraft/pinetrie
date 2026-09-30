// host/startup — what a starting host does before it accepts a command.

import type { LaneName } from "@pineta/core"
import {
  encodeWorkRecord,
  planStartup,
  recordChanged,
  type WorkRecord,
} from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readNotes, readOutbox, readThreadName } from "@pineta/reads"
import { clearStreams, readValues } from "@pineta/schema"
import type { Basics } from "./basics.ts"
import type { NoteTexts } from "./notes.ts"
import type { Serial } from "./queue.ts"
import type { Runs } from "./runs.ts"
import type { LaneWork } from "./work.ts"

export interface StartupDeps {
  readonly basics: Pick<Basics, "doc" | "log">
  readonly agent: Pick<
    Agent,
    "commands" | "interrupted" | "refusedCommands" | "setWorkRecord"
  >
  readonly work: Pick<LaneWork, "ensureNames" | "project">
  readonly serial: Serial
  readonly start: Runs["start"]
  readonly settle: (lanes: readonly LaneName[]) => Promise<void>
  readonly notes: Pick<NoteTexts, "hold">
}

/**
 * In order: no stream survives a process, so clear them; name every lane
 * that has none (ADR-0039); resume each lane a crash interrupted, in its own
 * directory, and settle the others with messages held for them
 * (`planStartup`); write what the host found and the commands its pi loaded,
 * each only when it changed, after the startup compaction; and hold every
 * recorded note's text, so edits to it are attributed and reach the store.
 * Nothing else runs yet, so clearing the streams needs no serial step.
 */
export async function recover(deps: StartupDeps): Promise<void> {
  const { agent, work, serial, notes, settle } = deps
  const { doc, log } = deps.basics
  clearStreams(doc)
  await work.ensureNames()
  const planned = planStartup({
    held: readOutbox(doc),
    interrupted: await agent.interrupted(),
  })
  for (const lane of planned.resume) {
    log(
      `[host] resuming ${readThreadName(doc, lane)}, which a crash interrupted`,
    )
    deps.start(lane, { kind: "resume" })
  }
  void settle(planned.drain)
  const writeIfChanged = (record: WorkRecord) => {
    const { namespace } = encodeWorkRecord(record)
    if (recordChanged(record, readValues(doc, namespace)[0]?.value))
      void serial.run(() => agent.setWorkRecord(record))
  }
  if (work.project !== null)
    writeIfChanged({ kind: "project", record: work.project })
  writeIfChanged({
    kind: "commands",
    record: {
      commands: agent.commands().map(c => ({
        name: c.name,
        kind: c.kind,
        description: c.description,
        argumentHint: c.argumentHint,
      })),
    },
  })
  for (const r of agent.refusedCommands())
    log(`[host] command ${r.name} is refused: ${r.reason}`)
  for (const n of readNotes(doc)) await notes.hold(n.id, null)
}
