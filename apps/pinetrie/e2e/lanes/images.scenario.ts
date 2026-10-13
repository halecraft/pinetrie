// e2e/lanes/images — project images with no Node, and with no git, and the
// default image's browser and python3.

import { ROOT } from "@pinetrie/core"
import { PINETRIE_MOUNT } from "@pinetrie/lanes"
import { readRevisions } from "@pinetrie/reads"
import type { Checks } from "../checks.ts"
import { rootRecordsOf, START_AGENT } from "../harness.ts"
import type { LaneHosts, SectionHost } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"
import { cli, imageHost } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => imagesSection(check, lanes),
}

// ── 9. Any image with sh and git: pinetrie brings Node and its programs ────
// Alpine has musl, no Node and no rg, fd or sd; the helper runs on the lane
// runtime's Node, through its own loader, the search tools on the
// runtime's static rg and fd, and every command is a run, attributed.
// An image with no git cannot host a lane.

async function imagesSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const alpine = await imageHost(
    lanes,
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
      { tool: "write", args: { path: "sub/deep/x.txt", content: "deep\n" } },
      {
        tool: "grep",
        args: { pattern: "secret", glob: "*.txt", context: 1 },
      },
      { tool: "find", args: { pattern: "sub/**/*.txt" } },
      {
        tool: "bash",
        args: {
          command:
            "rg --version | head -1; fd --version; sd --version; cat made.txt; command -v node || echo no node; ls /lib/ld-musl* >/dev/null && echo musl; mkdir -p built && cat notes.txt > built/copy.txt",
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
    check(
      "on Alpine, pinetrie's rg, fd and sd run, and grep and find find the files",
      ran.some(r => r.startsWith("notes.txt:1:the secret word")) &&
        ran.some(r => r.trim() === "sub/deep/x.txt") &&
        /ripgrep \d[\s\S]*fd \d[\s\S]*sd \d/.test(ran.at(-1) ?? ""),
      `${JSON.stringify(ran.slice(-3))}`.slice(0, 200),
    )
    const recorded = [...rootRecordsOf(alpine.host, readRevisions).values()]
    check(
      "on Alpine, under Docker's default seccomp profile, a tool call's run is attributed: what it made from source is in its turn's record",
      recorded.some(r => r.disk?.unignored.includes("built") === true),
      JSON.stringify(recorded.map(r => r.disk?.unignored ?? null)),
    )
    check(
      "and its turn is committed and snapshotted",
      recorded.some(r => r.commit !== null && r.snapshot !== null),
    )
  } finally {
    await alpine.close()
  }

  const bare = await imageHost(lanes, "FROM docker.io/library/alpine:3.22\n")
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

  // pinetrie's default image carries the browser its Playwright drives.
  // The check is an agent's command, so it sees the image's
  // environment as an agent does.
  const pinetrie = await lanes.sectionHost({
    files: { "notes.txt": "the secret word is MANGO\n" },
  })
  try {
    pinetrie.script.use([
      { tool: "bash", args: { command: `python3 -c 'print("PY" + "THON")'` } },
      {
        tool: "bash",
        args: {
          command: `node --input-type=module -e 'const { chromium } = await import("${PINETRIE_MOUNT}/apps/pinetrie/node_modules/@playwright/test/index.mjs"); const b = await chromium.launch(); const p = await b.newPage(); await p.setContent("<p>LAUNCHED</p>"); console.log(await p.textContent("p"), b.version()); await b.close()'`,
        },
      },
      { text: "done" },
    ])
    await pinetrie.user.chat("open a browser", ROOT, START_AGENT)
    const launched = (await pinetrie.results("open a browser")).join("\n")
    check(
      "on the default image, pinetrie's Playwright launches Chromium",
      launched.includes("LAUNCHED"),
      `${launched.slice(0, 90)}`,
    )
    check(
      "the default image has python3",
      launched.includes("PYTHON"),
      `${launched.slice(0, 90)}`,
    )
    // A second project's host, its lane running while the first's does:
    // one observer, the machine's, serves both. Under a lane's rootless
    // Docker there is none here: both are observed through the lane's helper.
    const other = await lanes.sectionHost({ files: { "other.txt": "o\n" } })
    try {
      const made = (host: SectionHost, dir: string) => {
        host.script.use([
          {
            tool: "bash",
            args: { command: `mkdir -p ${dir} && cat *.txt > ${dir}/a` },
          },
          { text: "done" },
        ])
        return host.user.chat(`make ${dir}`, ROOT, START_AGENT)
      }
      await Promise.all([made(pinetrie, "first"), made(other, "second")])
      const observers = cli(["ps", "--format", "{{.Names}}"])
        .split("\n")
        .filter(n => n.startsWith("pinetrie-observer-"))
      const attributed = (host: SectionHost, dir: string) =>
        [...rootRecordsOf(host.host, readRevisions).values()].some(
          r => r.disk?.unignored.includes(dir) === true,
        )
      check(
        "two projects' lanes are observed by at most one observer, the machine's, each run attributed",
        observers.length <= 1 &&
          attributed(pinetrie, "first") &&
          attributed(other, "second"),
        JSON.stringify({
          observers,
          first: attributed(pinetrie, "first"),
          second: attributed(other, "second"),
        }),
      )
    } finally {
      await other.close()
    }
  } finally {
    await pinetrie.close()
  }
}
