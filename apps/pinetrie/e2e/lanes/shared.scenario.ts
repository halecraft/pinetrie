// e2e/lanes/shared — directories every lane and you see, never branched.

import {
  chmodSync,
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
import { atEntry, entryId, ROOT } from "@pinetrie/core"
import { readRevisions, readSharedLineages } from "@pinetrie/reads"
import type { Checks } from "../checks.ts"
import {
  BRANCH,
  heldRootRecords,
  readJjAccepted,
  START_AGENT,
  SUITE_CONFIG,
  suitePlaces,
  waitFor,
} from "../harness.ts"
import type { LaneHosts } from "../lane-hosts.ts"
import { lanesWriteAs } from "../lane-runtime.ts"
import type { Scenario } from "../scenario.ts"
import { jj, snapshotListing } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => sharedSection(check, lanes),
}

// ── shared: directories every lane and you see, never branched ──
async function sharedSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const logs: string[] = []
  const store = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-store-"))),
    "pinetrie.db",
  )
  const places = suitePlaces({
    user: { ...SUITE_CONFIG, lanes: { shared: [".plans", ".jj/x"] } },
  })
  let h = await lanes.sectionHost({
    files: {
      "shared.txt": "one\n",
      // A publish brings your commits into accepted work (section 3).
      "pinetrie.json": `${JSON.stringify({ publish: { catchUp: true } })}\n`,
    },
    store,
    places,
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
    await h.settle(await h.user.send("write a plan", ROOT, START_AGENT))
    const plan = path.join(dir, ".plans", "a.md")
    const owner = existsSync(plan) ? statSync(plan).uid : null
    check(
      "a plan a lane writes is in your working copy at once, and yours",
      existsSync(plan) &&
        readFileSync(plan, "utf8") === "the plan\n" &&
        owner === lanesWriteAs(),
      `owner ${owner}, expected ${lanesWriteAs()}`,
    )
    h.script.use([
      { tool: "bash", args: { command: "cat .plans/a.md" } },
      { text: "read" },
    ])
    await h.user.send("read the plan", ROOT, START_AGENT)
    check(
      "another lane reads it",
      (await h.results("read the plan")).at(-1)?.includes("the plan") === true,
    )

    // 1b. Two lanes write one shared file: the second reads it, waits for
    // the first to write, then writes on what it read. Its write is flagged
    // concurrent, the first's is not. Files in the shared directory order
    // them, whichever lane starts first.
    // Yours, as a file you make on the Mac is: lanes may write it.
    const race = path.join(dir, ".plans", "race.md")
    writeFileSync(race, "yours\n")
    chmodSync(race, 0o666)
    const wait = (file: string) =>
      `timeout 60 sh -c 'until [ -e .plans/${file} ]; do :; done'`
    h.script.use([
      {
        tool: "bash",
        args: {
          command: `${wait("b-read")} && echo a > .plans/race.md && touch .plans/a-wrote`,
        },
      },
      {
        tool: "bash",
        args: {
          command: `v=$(cat .plans/race.md) && touch .plans/b-read && ${wait("a-wrote")} && echo "$v b" > .plans/race.md`,
        },
      },
      { text: "raced" },
      { text: "raced" },
    ])
    await Promise.all([
      h.user.send("lane a: write the race", ROOT, START_AGENT),
      h.user.send("lane b: write the race", ROOT, START_AGENT),
    ])
    await h.idle()
    const raced = [...heldRootRecords(h.host, readRevisions).values()].flatMap(
      r =>
        (r.disk?.shared.wrote ?? []).filter(w => w.path === ".plans/race.md"),
    )
    check(
      "two lanes write one shared file: the write over the other's is flagged concurrent, the other is not",
      raced.length === 2 &&
        raced.filter(w => w.concurrent).length === 1 &&
        readFileSync(race, "utf8") === "yours b\n",
      JSON.stringify(raced),
    )

    // 1c. Your writes, seen by the host's watcher. A lane reads your file
    // with the read tool; you change it; in its next turn the lane writes
    // its version with the write tool, based on what it read: concurrent.
    const mine = path.join(dir, ".plans", "mine.md")
    const versionsOfMine = () =>
      readSharedLineages(h.host.session).get(".plans/mine.md")?.versions ?? []
    writeFileSync(mine, "yours, first\n")
    chmodSync(mine, 0o666)
    await waitFor(() => versionsOfMine().length === 1, 30_000)
    h.script.use([
      { tool: "read", args: { path: ".plans/mine.md" } },
      { text: "read it" },
    ])
    await h.settle(await h.user.send("read mine", ROOT, START_AGENT))
    writeFileSync(mine, "yours, changed\n")
    await waitFor(() => versionsOfMine().length === 2, 30_000)
    const reader = h.laneWith("read mine")
    h.script.use([
      {
        tool: "write",
        args: { path: ".plans/mine.md", content: "the lane's, on the first\n" },
      },
      { text: "wrote it" },
    ])
    await h.settle(
      await h.user.send("write mine", atEntry(entryId(reader?.tip ?? "")), {
        thread: reader?.name,
      }),
    )
    const versions = versionsOfMine()
    check(
      "your writes are versions as you make them, and a lane's write over one it never read is concurrent",
      versions.map(v => v.writer.kind).join(",") === "outside,outside,lane" &&
        versions.at(-1)?.concurrent === true &&
        versions.slice(0, 2).every(v => !v.concurrent),
      JSON.stringify(versions),
    )

    // 2. Never branched: not in the lane's commit, your repo, a snapshot or @.
    const writer = h.laneWith("write a plan")
    const files = (rev: string) =>
      jj(dir, "file", "list", "--ignore-working-copy", "-r", rev)
    const newest = [...heldRootRecords(h.host, readRevisions).values()]
      .filter(r => r.lane === writer?.name && r.snapshot !== null)
      .sort((a, b) => (a.entry < b.entry ? 1 : -1))[0]
    const inSnapshot =
      newest?.snapshot === null || newest === undefined
        ? ""
        : await snapshotListing(dir, newest.snapshot, ".plans")
    // A branch at that turn: its .plans is the live mount, not the snapshot's.
    writeFileSync(path.join(dir, ".plans", "later.md"), "after the fork\n")
    h.script.use([
      { tool: "bash", args: { command: "cat .plans/later.md" } },
      { text: "branched" },
    ])
    await h.user.send(
      "@agent look from a branch",
      atEntry(entryId(writer?.tip ?? "")),
      BRANCH,
    )
    check(
      "a shared directory is never in a lane's commit, your @ or a snapshot, and a branch sees it live",
      writer !== undefined &&
        newest !== undefined &&
        (await files(`tip@pinetrie-${writer.name}`)).includes("shared.txt") &&
        !(await files(`tip@pinetrie-${writer.name}`)).includes(".plans") &&
        !(await files("@")).includes(".plans") &&
        !inSnapshot.includes("a.md") &&
        (await h.results("@agent look from a branch"))
          .at(-1)
          ?.includes("after the fork") === true,
    )

    // 3. The project shares one more, published to accepted work: after a
    // restart, the existing lane has it, though its own copy predates it.
    await jj(
      dir,
      "bookmark",
      "create",
      "main",
      "-r",
      "roots(::pinetrie-accepted ~ root())",
    )
    writeFileSync(
      path.join(dir, "pinetrie.json"),
      JSON.stringify({
        lanes: { shared: ["notes"] },
        publish: { catchUp: true },
      }),
    )
    await jj(dir, "commit", "-m", "you share notes")
    // Published once accepted work's record has seen your commit.
    await waitFor(
      () =>
        (readJjAccepted(h.host.session)?.workingCopy.getLatest ?? null) !==
        null,
      30_000,
    )
    await h.user.actOnAccepted("publish")
    await h.idle()
    // A file read in a turn, then deleted while no host serves: the next
    // host's scan lets its lineage go.
    const lineagePaths = () => [...readSharedLineages(h.host.session).keys()]
    const hadLater = lineagePaths().includes(".plans/later.md")
    rmSync(path.join(dir, ".plans", "later.md"))
    await h.close(true)
    h = await lanes.sectionHost({ dir, store, places, logs })
    await waitFor(() => !lineagePaths().includes(".plans/later.md"), 30_000)
    check(
      "a host's start lets go of the lineage of a shared file deleted before it, and keeps the others",
      hadLater &&
        !lineagePaths().includes(".plans/later.md") &&
        lineagePaths().includes(".plans/mine.md"),
      lineagePaths().join(" "),
    )
    h.script.use([
      {
        tool: "bash",
        args: {
          command: "echo from-lane > notes/n.md && cat shared.txt && ls .plans",
        },
      },
      { text: "noted" },
    ])
    await h.user.send("take a note", atEntry(entryId(writer?.tip ?? "")), {
      thread: writer?.name,
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
