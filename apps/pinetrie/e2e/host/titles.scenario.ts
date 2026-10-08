// e2e/host/titles — a root titled by a model (ADR-0074): unasked as its first
// lane starts, and again when a person asks (Auto-update title).

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ROOT } from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { readRoots } from "@pinetrie/reads"
import { TITLE_REQUEST_HEAD } from "@pinetrie/rules"
import type { Checks } from "../checks.ts"
import { at, START_AGENT, waitFor } from "../harness.ts"
import type { LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"
import { idOfIn } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  // An empty config: titles are on by default.
  const userConfig = path.join(
    mkdtempSync(path.join(tmpdir(), "pinetrie-titles-config-")),
    "config.json",
  )
  writeFileSync(userConfig, "{}")
  // A title names the newest subject its request shows; anything else asked
  // outside a thread is a commit message.
  const script = scriptedModel({
    answer: { text: "noted" },
    describe: {
      reply: context => {
        const asked = context.at(-1) ?? ""
        if (!asked.startsWith(TITLE_REQUEST_HEAD)) return "offer: scripted"
        return asked.includes("lexer") ? "Lexer work" : "Parser plan"
      },
    },
  })
  const {
    host: th,
    user: tu,
    idle,
    close,
  } = await lanes.sectionHost({
    files: { "a.txt": "a\n" },
    model: { kind: "scripted", script },
    userConfig,
  })
  const record = () => [...readRoots(th.session).values()][0]
  const title = () => record()?.title ?? null

  // 1. The first message to the agent titles its root while the run goes.
  const planning = script.pause("plan the parser")
  await tu.chat("@agent plan the parser", ROOT, START_AGENT)
  await waitFor(() => planning.reached, 10_000)
  const early = (await waitFor(() => title() === "Parser plan", 10_000)) >= 0
  planning.resume()
  await idle()
  check(
    "a new root's first lane titles it from its first message, before its run ends",
    early,
    `${title()}`,
  )

  // 2. A person's title, then Auto-update title: from the messages since.
  const entry = record()?.entry ?? null
  if (entry === null) throw new Error("the root has no entry")
  await tu.mark(entry, "Mine")
  await waitFor(() => title() === "Mine", 10_000)
  await tu.chat("@agent now the lexer", at(idOfIn(th, "noted")), {
    mode: "reply",
  })
  await idle()
  const answer = await tu.retitle(entry)
  const replaced = (await waitFor(() => title() === "Lexer work", 10_000)) >= 0
  check(
    "Auto-update title replaces a person's title with one from the thread's messages",
    answer.kind === "retitling" && replaced,
    `${answer.kind}; ${title()}`,
  )
  await close()
}
