// e2e/host/commands — your pi skills and prompts, /package:name.

import path from "node:path"
import { ROOT } from "@pinetrie/core"
import { readCommands } from "@pinetrie/reads"
import { rowMessage } from "@pinetrie/schema"
import type { Checks } from "../checks.ts"
import { entriesOf, START_CHAT, waitFor } from "../harness.ts"
import type { LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  // A fixture pi directory whose settings list two packages.
  {
    const fixtures = path.join(
      import.meta.dirname,
      "../../../../packages/pi/fixtures",
    )
    const {
      host: ch,
      user: cu,
      script,
      idle: cidle,
      close,
    } = await lanes.sectionHost({
      files: { "a.txt": "a\n" },
      agentDir: path.join(fixtures, "pi-agent"),
    })
    await cu.request({ kind: "name", name: "Uma" })
    await waitFor(() => readCommands(ch.session).length > 0, 10_000)
    check(
      "the host lists every command its pi loaded, each under its package",
      readCommands(ch.session)
        .map(c => c.name)
        .includes("fixture:skill:hello") &&
        readCommands(ch.session)
          .map(c => c.name)
          .includes("pi-other:skill:hello"),
    )

    // A skill: the model reads pi's block and the arguments; people see what
    // was typed.
    let told = ""
    script.use([
      {
        reply: context => {
          told = context.at(-1) ?? ""
          return "said hello"
        },
      },
    ])
    const sent = await cu.chat(
      "/fixture:skill:hello the world",
      ROOT,
      START_CHAT,
    )
    await cidle()
    // As the lane reads it, under /mnt/host.
    const hello = `/mnt/host${path.join(fixtures, "fixture-pkg", "skills", "hello")}`
    const typed = Object.values(entriesOf(ch))
      .map(
        r =>
          rowMessage(r) as {
            details?: { text?: string; command?: { name?: string } }
          },
      )
      .find(m => m.details?.command !== undefined)
    check(
      "a skill command gives the model pi's block and its arguments, and is stored as typed",
      sent.kind === "started" &&
        told.includes(
          `<skill name="hello" location="${hello}/SKILL.md">\nReferences are relative to ${hello}.`,
        ) &&
        told.includes("run `scripts/hello.sh`") &&
        told.trimEnd().endsWith("the world") &&
        typed?.details?.text === "/fixture:skill:hello the world" &&
        typed.details.command?.name === "fixture:skill:hello",
      `${told.slice(0, 60)}`,
    )

    // A prompt template, with its argument.
    script.use([
      {
        reply: context => {
          told = context.at(-1) ?? ""
          return "greeted"
        },
      },
    ])
    await cu.chat("/fixture:greet Ada", ROOT, START_CHAT)
    await cidle()
    check(
      "a prompt command gives the model its template, with its arguments",
      told.includes("Greet Ada warmly."),
      `${told}`,
    )

    await close()
  }
}
