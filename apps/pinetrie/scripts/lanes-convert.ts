// pnpm lanes:convert [folder] [--dry-run] — pre-docker: move every lane made
// under Apple's `container` to Docker now, rather than at its first start
// (`host/work/convert.ts`). Archived threads' lanes too, which would otherwise
// never start again to convert. Run on the Mac, with the host stopped (the
// store has one owner) and `container` running. `--dry-run` lists the lanes
// with no Docker disk yet and converts nothing. Delete with convert.ts.

import path from "node:path"
import { Exchange } from "@kyneta/exchange"
import { errorText, type LaneName, rootDocId } from "@pinetrie/core"
import {
  configJson,
  decodeLaneConfig,
  prepareProjectDir,
  readConfigFile,
  userConfigFile,
} from "@pinetrie/lanes"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import {
  readLaneRecords,
  readLaneSnapshots,
  readThreadName,
} from "@pinetrie/reads"
import { RootDoc, SessionDoc } from "@pinetrie/schema"
import { planInvocation, refusalText, storeChoice } from "../host/invocation.ts"
import {
  planStoredOpen,
  readStored,
  refusalLine,
} from "../host/migrations/index.ts"
import { openStore } from "../host/store.ts"
import {
  type Conversion,
  conversionLine,
  conversionSummary,
  planConversions,
} from "../host/work/convert.ts"
import { findProject, RuntimeRefused } from "../host/work/runtime.ts"

const say = (line: string) => console.log(`[lanes:convert] ${line}`)
const fail = (line: string, code = 1): never => {
  console.error(`[lanes:convert] ${line}`)
  process.exit(code)
}

const args = process.argv.slice(2)
const dry = args.includes("--dry-run")
const invocation = planInvocation(
  args.filter(a => a !== "--dry-run"),
  process.env.INIT_CWD ?? process.cwd(),
  path.resolve(import.meta.dirname, "../../.."),
)
if (invocation.kind === "refused") fail(refusalText(invocation.refusal), 2)
else {
  const prepared = await prepareProjectDir(invocation.folder)
  if (prepared.kind === "refused")
    fail(refusalText({ kind: "project", refusal: prepared.refusal }), 2)
  else await main(prepared.root)
}

async function main(root: string): Promise<never> {
  // The store first: it refuses while a host holds it.
  const { store } = openStore(storeChoice(root, process.env).file)
  const openPlan = planStoredOpen(await readStored(store))
  if (openPlan.kind === "refuse") return fail(refusalLine(openPlan))
  if (openPlan.run.length > 0)
    return fail(
      "the store has migrations to run: start the host once, then stop it",
    )
  const exchange = new Exchange({
    principal: "pinetrie-lanes-convert",
    type: "service",
    transports: [],
    store,
  })
  const session = exchange.get(SESSION_DOC_ID, SessionDoc)
  await exchange.whenHydrated(SESSION_DOC_ID)

  const userJson = configJson(await readConfigFile(userConfigFile()))
  const found = await findProject({
    dir: root,
    defaultDirect: false,
    containers: true,
    runtimeRefused: "stop",
    machine: decodeLaneConfig(userJson, root, false).machine,
    log: line => console.log(line),
  }).catch(error =>
    fail(
      error instanceof RuntimeRefused
        ? `lanes cannot start: ${error.message}`
        : errorText(error),
    ),
  )
  const runtime = found?.runtime ?? null
  const convert = found?.convert ?? null
  if (runtime === null || convert === null)
    return fail(
      "nothing to convert from: this runs on the Mac, on Docker in the lane VM, with Apple's `container` running (`container system start`)",
    )

  const records = readLaneRecords(session)
  /** The lane's snapshots, newest first, its root loaded only for them. */
  const snapshotsOf = async (lane: LaneName) => {
    const at = records.get(lane)?.root
    if (at === undefined) return []
    const id = rootDocId(at)
    const doc = exchange.get(id, RootDoc)
    await exchange.whenHydrated(id)
    const snapshots = readLaneSnapshots(doc, lane)
    exchange.unload(id)
    return snapshots
  }
  const outcomes: Conversion[] = []
  for (const lane of planConversions(records.values())) {
    const outcome: Conversion = (await runtime.diskExists(lane))
      ? { kind: "on-docker" }
      : dry
        ? { kind: "would-convert" }
        : await convert(lane, await snapshotsOf(lane)).then(
            (moved): Conversion => ({ kind: moved ? "converted" : "nothing" }),
            (error): Conversion => ({
              kind: "failed",
              error: errorText(error),
            }),
          )
    const line = conversionLine(readThreadName(session, lane), outcome)
    if (line !== null) say(line)
    outcomes.push(outcome)
  }
  say(conversionSummary(outcomes))

  await found?.close()
  await exchange.flush()
  await exchange.shutdown()
  process.exit(outcomes.some(o => o.kind === "failed") ? 1 : 0)
}
