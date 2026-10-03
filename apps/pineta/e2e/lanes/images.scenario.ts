// e2e/lanes/images — project images with no Node, and with no git, and the
// default image's browser.

import { ROOT } from "@pineta/core"
import { PINETA_MOUNT } from "@pineta/lanes"
import { readRevisions } from "@pineta/reads"
import type { Checks } from "../checks.ts"
import { containerProblem, rootRecordsOf } from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import { imageHost, START_AGENT, sectionHost } from "./support.ts"

export const scenario: Scenario = {
  needs: containerProblem,
  run: ({ check }) => imagesSection(check),
}

// ── 9. Any image with sh and git: Pineta brings Node and jj ──────────────
// Alpine has musl and no Node; the helper runs on the lane runtime's Node,
// through its own loader. An image with no git cannot host a lane.

async function imagesSection(check: Checks["check"]): Promise<void> {
  const alpine = await imageHost(
    "FROM docker.io/library/alpine:3.22\nRUN apk add --no-cache git\n",
  )
  try {
    alpine.script.use([
      { tool: "read", args: { path: "notes.txt" } },
      { tool: "write", args: { path: "made.txt", content: "made\n" } },
      {
        tool: "edit",
        args: {
          path: "made.txt",
          edits: [{ oldText: "made", newText: "edited" }],
        },
      },
      {
        tool: "bash",
        args: {
          command:
            "cat made.txt; command -v node || echo no node; ls /lib/ld-musl* >/dev/null && echo musl",
        },
      },
      { text: "done" },
    ])
    await alpine.user.chat("use every tool", ROOT, START_AGENT)
    const ran = await alpine.results("use every tool")
    check(
      "a lane on Alpine, with musl and no Node, runs pi's four tools",
      ran[0]?.includes("MANGO") === true &&
        ran.at(-1)?.includes("edited") === true &&
        ran.at(-1)?.includes("no node") === true &&
        ran.at(-1)?.includes("musl") === true,
      `${JSON.stringify(ran.at(-1))}`,
    )
    const recorded = [...rootRecordsOf(alpine.host, readRevisions).values()]
    check(
      "and its turn is committed and snapshotted",
      recorded.some(r => r.commit !== null && r.snapshot !== null),
    )
  } finally {
    await alpine.close()
  }

  const bare = await imageHost("FROM docker.io/library/alpine:3.22\n")
  try {
    bare.script.use([
      { tool: "bash", args: { command: "echo hello" } },
      { text: "done" },
    ])
    await bare.user.chat("say hello", ROOT, START_AGENT)
    const refused = (await bare.results("say hello")).join("\n")
    check(
      "an image with no git cannot host a lane, and says so",
      refused.includes("has no git") && !refused.includes("hello\n"),
      `${refused.slice(0, 90)}`,
    )
  } finally {
    await bare.close()
  }

  // Pineta's default image carries the browser its Playwright drives
  // (ADR-0041). The check is an agent's command, so it sees the image's
  // environment as an agent does.
  const pineta = await sectionHost({
    files: { "notes.txt": "the secret word is MANGO\n" },
  })
  try {
    pineta.script.use([
      {
        tool: "bash",
        args: {
          command: `node --input-type=module -e 'const { chromium } = await import("${PINETA_MOUNT}/apps/pineta/node_modules/@playwright/test/index.mjs"); const b = await chromium.launch(); const p = await b.newPage(); await p.setContent("<p>LAUNCHED</p>"); console.log(await p.textContent("p"), b.version()); await b.close()'`,
        },
      },
      { text: "done" },
    ])
    await pineta.user.chat("open a browser", ROOT, START_AGENT)
    const launched = (await pineta.results("open a browser")).join("\n")
    check(
      "on the default image, Pineta's Playwright launches Chromium",
      launched.includes("LAUNCHED"),
      `${launched.slice(0, 90)}`,
    )
  } finally {
    await pineta.close()
  }
}
