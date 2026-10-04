// e2e/host/commands — your pi skills and prompts, /package:name (ADR-0036).

import path from "node:path"
import { ROOT } from "@pineta/core"
import { scriptedModel } from "@pineta/pi"
import { readCommands } from "@pineta/reads"
import { rowMessage } from "@pineta/schema"
import type { Checks } from "../checks.ts"
import {
  committedProject,
  entriesOf,
  idleNow,
  join,
  startSuiteHost,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import { START_CHAT } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  // A fixture pi directory whose settings list two packages; no containers.
  {
    const fixtures = path.join(
      import.meta.dirname,
      "../../../../packages/pi/fixtures",
    )
    const project = committedProject("pineta-commands-", { "a.txt": "a\n" })
    const script = scriptedModel()
    const ch = await startSuiteHost({
      model: { kind: "scripted", script },
      tools: { project },
      containers: false,
      agentDir: path.join(fixtures, "pi-agent"),
      log: () => {},
    })
    const cu = await join(ch, "uma", "containers")
    await cu.request({ kind: "name", name: "Uma" })
    const cidle = () => waitFor(() => idleNow(ch), 60_000)
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
    const hello = path.join(fixtures, "fixture-pkg", "skills", "hello")
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

    await cu.close()
    await ch.shutdown()
  }
}
