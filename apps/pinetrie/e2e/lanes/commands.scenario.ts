// e2e/lanes/commands — your pi skills' files, readable in a lane at /mnt/host.

import path from "node:path"
import { atEntry, entryId, ROOT } from "@pinetrie/core"
import type { Checks } from "../checks.ts"
import {
  FIXTURE_PACKAGES,
  START_AGENT,
  SUITE_CONFIG,
  suitePlaces,
} from "../harness.ts"
import { inLane, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => commandsSection(check, lanes),
}

// ── commands: skill files at /mnt/host in a lane ────────────────────────────
async function commandsSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const fixtures = path.join(
    import.meta.dirname,
    "../../../../packages/pi/fixtures",
  )
  const hello = path.join(fixtures, "fixture-pkg", "skills", "hello")
  const h = await lanes.sectionHost({
    files: { "a.txt": "a\n" },
    places: suitePlaces({
      user: { ...SUITE_CONFIG, packages: FIXTURE_PACKAGES },
    }),
  })
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
    await h.user.send("/fixture:skill:hello", ROOT, START_AGENT)
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
    // What the lane is told about itself, in a real container.
    // It names no bookmark, which changes when the thread is named
    // (`packages/pi/lanes.test.ts`).
    const lane = h.laneWith("read it")?.name
    check(
      "a lane of its own is told it is in a lane, and of its browser",
      system.includes("- You work in a pine·trie lane") &&
        system.includes("Chromium's headless shell is installed"),
    )
    const note = /when you need it: (\S+)/.exec(system)?.[1] ?? ""
    check(
      "the note the prompt names is a file in the lane",
      note !== "" &&
        lane !== undefined &&
        (await inLane(lane, `test -f ${note} && echo present`)).includes(
          "present",
        ),
      `${note}`,
    )
    h.script.use([
      {
        tool: "bash",
        args: {
          command: `cat ${skillDir}/references/note.md; sh ${skillDir}/scripts/hello.sh`,
        },
      },
      { text: "ran it" },
    ])
    await h.user.send(
      "@agent follow it",
      atEntry(entryId(h.laneWith("read it")?.tip ?? "")),
      {
        thread: h.laneWith("read it")?.name,
      },
    )
    const ran = (await h.results("ran it")).at(-1) ?? ""
    check(
      "the lane reads the skill's references and runs its scripts there",
      ran.includes("HELLO-NOTE") && ran.includes("HELLO-SCRIPT"),
    )
  } finally {
    await h.close()
  }
}
