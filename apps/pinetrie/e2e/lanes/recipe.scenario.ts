// e2e/lanes/recipe — derived state is rebuilt from its key, never carried
// (ADR-0131): a package deleted from accepted work, or in a lane, leaves no
// output of its own behind, and a turn's record names the ignored files it
// wrote. The project's recipe is offline: it writes `out-<p>/marker` for
// each package `pkgs.txt` lists.

import { rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  ancestry,
  type EntryId,
  entryId,
  messageText,
  projectTranscript,
  type RevisionRecord,
  ROOT,
  type ThreadId,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { readPlaces, readRevisions } from "@pinetrie/reads"
import { rowMessage } from "@pinetrie/schema"
import type { Checks } from "../checks.ts"
import {
  at,
  BRANCH,
  committedProject,
  entriesOf,
  idleNow,
  join,
  lanesOf,
  rootRecordsOf,
  START_AGENT,
  setUpAccepted,
  treeOf,
  waitFor,
} from "../harness.ts"
import { cleanUp, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"
import { jj } from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => recipeSection(check, lanes),
}

const GONE =
  'for p in a b c; do test -e "out-$p" && echo "out-$p"; done; echo checked'

async function recipeSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const project = committedProject("pinetrie-recipe-", {
    "pkgs.txt": "a\nb\nc\n",
    "c.txt": "c's source\n",
    "build.sh":
      'for p in $(cat pkgs.txt); do mkdir -p "out-$p" && echo built > "out-$p/marker"; done\n',
    ".gitignore": "out-*/\n.env\n",
    "pinetrie.json": `${JSON.stringify({
      publish: { catchUp: true },
      lanes: { install: "sh build.sh", installWhen: "pkgs.txt" },
    })}\n`,
  })
  const script = scriptedModel()
  const wh = await lanes.startHost({
    model: { kind: "scripted", script },
    project: { dir: project, tools: true },
    log: m => {
      if (process.env.PINETRIE_E2E_LOG === "1") console.log(m)
    },
  })
  const wu = await join(wh, "uma", "recipe")
  await wu.request({ kind: "name", name: "Uma" })
  const tree = () => treeOf(wh)
  const idle = async () => {
    await waitFor(() => idleNow(wh), 180_000)
    await wh.quiet()
  }
  const laneTip = (lane: ThreadId) =>
    lanesOf(wh, tree(), readPlaces(wh.places)).find(l => l.name === lane)
      ?.tip ?? null
  /** The lane whose thread holds `text`. */
  const laneWith = (text: string) => {
    const index = tree()
    const id =
      Object.values(index.entries).find(
        e => projectTranscript(index, e.id).at(-1)?.text === text,
      )?.id ?? null
    return lanesOf(wh, index, readPlaces(wh.places)).find(
      l => id !== null && ancestry(index, l.tip).path.includes(id),
    )?.name
  }
  /** The last tool result's text in a lane's thread. */
  const lastResult = (lane: ThreadId | undefined): string => {
    if (lane === undefined) return ""
    const onPath = new Set(ancestry(tree(), laneTip(lane)).path)
    return (
      Object.values(entriesOf(wh))
        .filter(r => onPath.has(entryId(r.id)))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map(r => rowMessage(r) as { role?: string })
        .filter(m => m.role === "toolResult")
        .map(m => messageText(m as never))
        .at(-1) ?? ""
    )
  }
  /** The revision records of a lane's thread, oldest first. */
  const recordsOf = (lane: ThreadId): RevisionRecord[] => {
    const records = rootRecordsOf(wh, readRevisions)
    return ancestry(tree(), laneTip(lane))
      .path.map(id => records.get(id as EntryId))
      .filter((r): r is RevisionRecord => r !== undefined && r.lane === lane)
      .sort((a, b) => (a.entry < b.entry ? -1 : 1))
  }
  const ask = async (
    text: string,
    command: string,
    where = ROOT,
    how: Parameters<typeof wu.chat>[2] = START_AGENT,
  ) => {
    script.use([{ tool: "bash", args: { command } }, { text: "done" }])
    await wu.chat(text, where, how)
    await idle()
    return laneWith(text)
  }

  try {
    await setUpAccepted(wh.session, wu)
    // A fork waits for the base at accepted work: one with all three outputs.
    const before = await ask("@agent which outputs are there first?", GONE)

    // Accepted work deletes package c: the next base is made from it alone.
    jj(project, "bookmark", "create", "main", "-r", "pinetrie-accepted")
    writeFileSync(path.join(project, "pkgs.txt"), "a\nb\n")
    rmSync(path.join(project, "c.txt"))
    jj(project, "commit", "-m", "you delete package c")
    await wu.actOnAccepted("publish")
    await wh.quiet()
    const first = await ask("@agent which outputs are there?", GONE)
    check(
      "a package deleted from accepted work leaves no output of its own in the next fork",
      lastResult(before).trim() === "out-a\nout-b\nout-c\nchecked" &&
        lastResult(first).trim() === "out-a\nout-b\nchecked",
      JSON.stringify({ before: lastResult(before), after: lastResult(first) }),
    )

    // In a lane, a turn deletes package b: the recipe runs again before the
    // turn's snapshot, its old outputs removed first.
    if (first === undefined) throw new Error("no lane")
    script.use([
      { tool: "bash", args: { command: "printf 'a\\n' > pkgs.txt" } },
      { text: "deleted b" },
    ])
    await wu.chat("@agent delete package b", at(laneTip(first)), {
      thread: first,
    })
    await idle()
    const ran = recordsOf(first).find(r => r.recipe === "ran")
    const branched = await ask(
      "@agent which outputs are there now?",
      GONE,
      at(ran?.entry ?? null),
      BRANCH,
    )
    check(
      "a package deleted in a lane leaves no output of its own in a branch from that turn",
      ran !== undefined && lastResult(branched).trim() === "out-a\nchecked",
      JSON.stringify({ ran, out: lastResult(branched) }),
    )

    // A turn that writes an ignored file: its record names it, and no
    // recipe output.
    script.use([
      { tool: "bash", args: { command: "echo SECRET=1 > .env" } },
      { text: "wrote it" },
    ])
    await wu.chat("@agent write .env", at(laneTip(first)), { thread: first })
    await idle()
    const wrote = recordsOf(first).at(-1)
    check(
      "a turn's record names the ignored files it wrote, and no recipe output",
      wrote?.ignored?.paths.includes(".env") === true &&
        !wrote.ignored.paths.some(p => p.startsWith("out-")) &&
        // No record names a path only the diff's own machinery made.
        !recordsOf(first).some(r =>
          (r.ignored?.paths ?? []).some(
            p => /^o\d+-\d+-\d+(\/|$)/.test(p) || p.startsWith(".git/"),
          ),
        ),
      JSON.stringify(wrote),
    )
  } finally {
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
    cleanUp(wh.session, project)
  }
}
