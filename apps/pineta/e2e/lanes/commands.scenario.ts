// e2e/lanes/commands — your pi skills' files, readable in a lane at /mnt/host
// (ADR-0036).

import path from "node:path"
import { atEntry, entryId, ROOT } from "@pineta/core"
import { readNames } from "@pineta/reads"
import type { Checks } from "../checks.ts"
import { containerProblem } from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import { inLane, START_AGENT, sectionHost } from "./support.ts"

export const scenario: Scenario = {
  needs: containerProblem,
  run: ({ check }) => commandsSection(check),
}

// ── commands: skill files at /mnt/host in a lane (ADR-0036) ─────────────────
async function commandsSection(check: Checks["check"]): Promise<void> {
  const fixtures = path.join(
    import.meta.dirname,
    "../../../../packages/pi/fixtures",
  )
  const agentDir = path.join(fixtures, "pi-agent")
  const hello = path.join(fixtures, "fixture-pkg", "skills", "hello")
  const h = await sectionHost({ files: { "a.txt": "a\n" }, agentDir })
  try {
    let told = ""
    let system = ""
    h.script.use([
      {
        reply: context => {
          system = context[0] ?? ""
          told = context.at(-1) ?? ""
          return "read it"
        },
      },
    ])
    await h.user.chat("/fixture:skill:hello", ROOT, START_AGENT)
    await h.idle()
    const skillDir = `/mnt/host${hello}`
    check(
      "in a lane of its own, an expanded skill names its files at /mnt/host",
      told.includes(
        `<skill name="hello" location="${skillDir}/SKILL.md">\nReferences are relative to ${skillDir}.`,
      ),
      `${told.slice(0, 90)}`,
    )
    check(
      "the system prompt lists the skills the model may use at /mnt/host",
      system.includes(
        `/mnt/host${path.join(fixtures, "fixture-pkg", "skills", "explain")}/SKILL.md`,
      ),
    )
    // What the lane is told about itself (ADR-0046), in a real container.
    const lane = h.laneWith("read it")?.name
    const name =
      lane === undefined ? undefined : readNames(h.host.session).get(lane)
    check(
      "a lane of its own is told it is in a lane, its offer, and its browser",
      name !== undefined &&
        system.includes("- You work in a Pineta lane") &&
        system.includes(`\`pineta-offer/${name}\``) &&
        system.includes("Chromium's headless shell is installed"),
    )
    const note = /when you need it: (\S+)/.exec(system)?.[1] ?? ""
    check(
      "the note the prompt names is a file in the lane",
      note !== "" &&
        lane !== undefined &&
        inLane(lane, `test -f ${note} && echo present`).includes("present"),
      `${note}`,
    )
    h.script.use([
      {
        tool: "bash",
        args: {
          command: `cat ${skillDir}/references/note.md; sh ${skillDir}/scripts/hello.sh; ls /mnt/host${agentDir} 2>&1 | head -1`,
        },
      },
      { text: "ran it" },
    ])
    await h.user.chat(
      "@agent follow it",
      atEntry(entryId(h.laneWith("read it")?.tip ?? "")),
      {
        lane: h.laneWith("read it")?.name,
      },
    )
    const ran = (await h.results("ran it")).at(-1) ?? ""
    check(
      "the lane reads the skill's references and runs its scripts there",
      ran.includes("HELLO-NOTE") && ran.includes("HELLO-SCRIPT"),
    )
    check(
      "pi's agent directory is never mounted",
      ran.includes("No such file or directory"),
      `${ran.trim().split("\n").at(-1)}`,
    )
  } finally {
    await h.close()
  }
}
