// e2e/lanes/shared — directories every lane and you see, never branched
// (ADR-0035).

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { atEntry, entryId, ROOT } from "@pineta/core"
import { readRevisions } from "@pineta/reads"
import type { Checks } from "../checks.ts"
import { containerProblem, rootRecordsOf, SUITE_CONFIG } from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import {
  BRANCH,
  ensureFsckImage,
  FSCK_IMAGE,
  jj,
  START_AGENT,
  sectionHost,
  sh,
} from "./support.ts"

export const scenario: Scenario = {
  needs: containerProblem,
  run: ({ check }) => sharedSection(check),
}

// ── shared: directories every lane and you see, never branched (ADR-0035) ──
async function sharedSection(check: Checks["check"]): Promise<void> {
  const logs: string[] = []
  const store = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "pineta-store-"))),
    "pineta.db",
  )
  const userConfig = path.join(path.dirname(store), "config.json")
  writeFileSync(
    userConfig,
    JSON.stringify({ ...SUITE_CONFIG, lanes: { shared: [".plans", ".jj/x"] } }),
  )
  let h = await sectionHost({
    files: { "shared.txt": "one\n" },
    store,
    userConfig,
    logs,
  })
  const { dir } = h
  try {
    check(
      "the user's shared directories apply, and a refused one is logged with its reason",
      logs.some(l => l.includes(".plans/ is shared read-write")) &&
        logs.some(l => l.includes(".jj/x is not shared: it is inside .jj")),
    )

    // 1. One lane writes a plan; you see it at once, as yours; another reads it.
    h.script.use([
      { tool: "write", args: { path: ".plans/a.md", content: "the plan\n" } },
      { tool: "bash", args: { command: "echo lane > shared.txt" } },
      { text: "planned" },
    ])
    await h.user.chat("write a plan", ROOT, START_AGENT)
    await h.idle()
    const plan = path.join(dir, ".plans", "a.md")
    check(
      "a plan a lane writes is in your working copy at once, and yours",
      existsSync(plan) &&
        readFileSync(plan, "utf8") === "the plan\n" &&
        statSync(plan).uid === process.getuid?.(),
    )
    h.script.use([
      { tool: "bash", args: { command: "cat .plans/a.md" } },
      { text: "read" },
    ])
    await h.user.chat("read the plan", ROOT, START_AGENT)
    check(
      "another lane reads it",
      (await h.results("read the plan")).at(-1)?.includes("the plan") === true,
    )

    // 2. Never branched: not in the lane's commit, your repo, a snapshot or @.
    const writer = h.laneWith("write a plan")
    const files = (rev: string) =>
      jj(dir, "file", "list", "--ignore-working-copy", "-r", rev)
    const newest = [...rootRecordsOf(h.host, readRevisions).values()]
      .filter(r => r.lane === writer?.name && r.snapshot !== null)
      .sort((a, b) => (a.entry < b.entry ? 1 : -1))[0]
    const snapshots = path.join(dir, ".pineta", "snapshots")
    ensureFsckImage()
    const inSnapshot = sh(
      `container run --rm --mount type=bind,source=${snapshots},target=/s,readonly ${FSCK_IMAGE} debugfs -R "ls /.plans" /s/${newest?.snapshot}.img 2>/dev/null || true`,
    )
    // A branch at that turn: its .plans is the live mount, not the snapshot's.
    writeFileSync(path.join(dir, ".plans", "later.md"), "after the fork\n")
    h.script.use([
      { tool: "bash", args: { command: "cat .plans/later.md" } },
      { text: "branched" },
    ])
    await h.user.chat(
      "@agent look from a branch",
      atEntry(entryId(writer?.tip ?? "")),
      BRANCH,
    )
    check(
      "a shared directory is never in a lane's commit, your @ or a snapshot, and a branch sees it live",
      writer !== undefined &&
        newest !== undefined &&
        files(`tip@pineta-${writer.name}`).includes("shared.txt") &&
        !files(`tip@pineta-${writer.name}`).includes(".plans") &&
        !files("@").includes(".plans") &&
        !inSnapshot.includes("a.md") &&
        (await h.results("@agent look from a branch"))
          .at(-1)
          ?.includes("after the fork") === true,
    )

    // 3. The project shares one more; after a restart, the existing lane has it.
    writeFileSync(
      path.join(dir, "pineta.json"),
      JSON.stringify({ lanes: { shared: ["notes"] } }),
    )
    await h.close(true)
    h = await sectionHost({ dir, store, userConfig, logs })
    h.script.use([
      {
        tool: "bash",
        args: {
          command: "echo from-lane > notes/n.md && cat shared.txt && ls .plans",
        },
      },
      { text: "noted" },
    ])
    await h.user.chat("take a note", atEntry(entryId(writer?.tip ?? "")), {
      lane: writer?.name,
    })
    const noted = (await h.results("take a note")).at(-1) ?? ""
    check(
      "after a restart, an existing lane has the newly shared directory, with its disk as it was",
      existsSync(path.join(dir, "notes", "n.md")) &&
        noted.includes("lane") &&
        noted.includes("a.md"),
      `${noted.replaceAll("\n", " ")}`,
    )
  } finally {
    await h.close()
    rmSync(path.dirname(store), { recursive: true, force: true })
  }
}
