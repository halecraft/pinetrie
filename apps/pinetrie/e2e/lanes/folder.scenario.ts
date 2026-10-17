// e2e/lanes/folder — a folder with no jj repo served: a thread works in its
// lane, its proposed changes are the files it changed; the project's folder,
// edited, is read once it is quiet; a clean catch-up, then one that conflicts,
// its versions in the lane and resolved by `resolve_conflict`; nothing written
// in the project's folder until an accept writes the shown merge there, and
// none after a save of yours since the review. A person chooses a conflict's
// version; accepted work is restored to its state before the accept, and a
// restore not as shown is refused. Then the folder becomes a jj repo, and the
// folder lane is refused.

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  ancestry,
  CATCH_UP_TOOL,
  ERR,
  entryId,
  messageText,
  RESOLVE_TOOL,
  ROOT,
  type ThreadId,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import {
  readAccepted,
  readConflicts,
  readPlaces,
  readProposedByLane,
  readStates,
} from "@pinetrie/reads"
import { foreignLaneWords, reviewUrl } from "@pinetrie/rules"
import { rowMessage } from "@pinetrie/schema"
import type { Checks } from "../checks.ts"
import { command } from "../command.ts"
import {
  at,
  entriesOf,
  idleNow,
  join,
  laneHolding,
  lanesOf,
  START_AGENT,
  treeOf,
  waitFor,
} from "../harness.ts"
import { cleanUp, inLane, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => folderSection(check, lanes),
}

/** A folder of `files` with no repo, readable by a rootless Docker's user. */
function plainFolder(files: Readonly<Record<string, string>>): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-folder-")))
  chmodSync(dir, 0o755)
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(dir, name), text)
  return dir
}

/** Every name in `dir`, sorted, recursively. */
const listing = (dir: string): string[] =>
  readdirSync(dir, { recursive: true }).map(String).sort()

async function folderSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const dir = plainFolder({ "a.txt": "one\ntwo\nthree\n" })
  const script = scriptedModel()
  const logs: string[] = []
  // One store across the restart, as the person's session keeps.
  const store = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-store-"))),
    "pinetrie.db",
  )
  const start = () =>
    lanes.startHost({
      model: { kind: "scripted", script },
      store,
      project: { dir, tools: true },
      log: m => {
        logs.push(m)
        if (process.env.PINETRIE_E2E_LOG === "1") console.log(m)
      },
    })
  let wh = await start()
  let wu = await join(wh, "uma", "folder")
  const tree = () => treeOf(wh)
  const idle = async () => {
    await waitFor(() => idleNow(wh), 300_000)
    await wh.quiet()
  }
  const laneTip = (lane: ThreadId) =>
    lanesOf(wh, tree(), readPlaces(wh.places)).find(l => l.name === lane)
      ?.tip ?? null
  const laneWith = (text: string) =>
    laneHolding(wh, readPlaces(wh.places), text)
  const toolResults = (lane: ThreadId): string[] => {
    const onPath = new Set(ancestry(tree(), laneTip(lane)).path)
    return Object.values(entriesOf(wh))
      .filter(r => onPath.has(entryId(r.id)))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(r => rowMessage(r) as { role?: string })
      .filter(m => m.role === "toolResult")
      .map(m => messageText(m as never))
  }
  try {
    const before = listing(dir)
    // 1. A thread writes a file in its lane; its proposed changes are that
    //    file.
    script.use([
      { tool: "write", args: { path: "b.txt", content: "lane's\n" } },
      { text: "wrote" },
    ])
    await wu.send("@agent write b", ROOT, START_AGENT)
    await idle()
    const lane = laneWith("@agent write b")?.name
    if (lane === undefined) throw new Error("no lane")
    const proposedFromRows = () => {
      const o = readProposedByLane(wh.session).get(lane)
      return o?.kind === "folder" && o.files.length > 0 ? o : undefined
    }
    await waitFor(() => proposedFromRows() !== undefined, 60_000)
    const proposed = proposedFromRows()
    check(
      "a folder lane's proposed changes are the files it changed, against accepted work's newest state",
      proposed?.kind === "folder" &&
        proposed.files.join() === "b.txt" &&
        readAccepted(wh.session)?.kind === "folder",
      JSON.stringify(proposed),
    )
    const review =
      proposed?.kind === "folder"
        ? await fetch(
            new URL(
              reviewUrl({
                kind: "range",
                from: proposed.start,
                to: proposed.tip,
              }),
              wh.httpUrl,
            ),
          ).then(r => (r.ok ? r.json() : r.status))
        : null
    check(
      "the proposed changes are reviewed as files, with their line counts",
      typeof review === "object" &&
        JSON.stringify(review).includes('"path":"b.txt"') &&
        JSON.stringify(review).includes('"added":1,'),
      JSON.stringify(review),
    )

    // 2. The project's folder, edited, is read once it is quiet, and the thread hears of it.
    const newestOf = () => {
      const now = readAccepted(wh.session)
      return now?.kind === "folder" ? now.newest : null
    }
    const first = newestOf()
    writeFileSync(path.join(dir, "c.txt"), "yours\n")
    await waitFor(() => newestOf() !== first, 60_000)
    const moved = newestOf()
    check(
      "the project's folder, edited, is read into a new state once it is quiet",
      moved !== first,
    )

    // 3. A clean catch-up brings your file into the lane.
    script.use([
      { tool: CATCH_UP_TOOL, args: {} },
      { tool: "bash", args: { command: "cat c.txt" } },
      { text: "caught up" },
    ])
    await wu.send("@agent catch up", at(laneTip(lane)), { thread: lane })
    await idle()
    check(
      "a clean catch-up merges accepted work's newest state into the lane",
      toolResults(lane).at(-1)?.trim() === "yours",
      JSON.stringify(toolResults(lane)),
    )

    // 4. Both change a.txt's middle line: a conflict, its versions in the lane, resolved.
    script.use([
      { tool: "write", args: { path: "a.txt", content: "one\nlane\nthree\n" } },
      { text: "edited" },
    ])
    await wu.send("@agent edit a", at(laneTip(lane)), { thread: lane })
    await idle()
    writeFileSync(path.join(dir, "a.txt"), "one\nyours\nthree\n")
    await waitFor(() => newestOf() !== moved, 60_000)
    script.use([{ tool: CATCH_UP_TOOL, args: {} }, { text: "conflicted" }])
    await wu.send("@agent catch up again", at(laneTip(lane)), { thread: lane })
    await idle()
    const theirs = await inLane(
      lane,
      "cat /pinetrie-states/conflicts/a.txt/theirs",
    )
    check(
      "a conflicted catch-up leaves the lane's file, and its three versions under /pinetrie-states",
      theirs.includes("yours"),
      theirs,
    )
    script.use([
      { tool: RESOLVE_TOOL, args: { path: "a.txt", choose: "theirs" } },
      {
        tool: "bash",
        args: { command: "cat a.txt; ls /pinetrie-states/conflicts" },
      },
      { text: "resolved" },
    ])
    await wu.send("@agent resolve", at(laneTip(lane)), { thread: lane })
    await idle()
    const resolved = toolResults(lane).at(-1) ?? ""
    check(
      "resolve_conflict writes the version chosen, and its versions go",
      resolved.includes("yours") && !resolved.includes("a.txt"),
      resolved,
    )
    check(
      "nothing of pine·trie's is written in the project's folder",
      JSON.stringify(listing(dir)) ===
        JSON.stringify([...before, "c.txt"].sort()),
      JSON.stringify(listing(dir)),
    )

    // 5. Both add f.txt: a person chooses accepted work's version, which
    //    closes the conflict as a state of the lane's and tells the thread.
    script.use([
      { tool: "write", args: { path: "f.txt", content: "lane's f\n" } },
      { text: "wrote f" },
    ])
    await wu.send("@agent write f", at(laneTip(lane)), { thread: lane })
    await idle()
    const beforeF = newestOf()
    writeFileSync(path.join(dir, "f.txt"), "yours f\n")
    await waitFor(() => newestOf() !== beforeF, 60_000)
    script.use([{ tool: CATCH_UP_TOOL, args: {} }, { text: "conflicted on f" }])
    await wu.send("@agent catch up with f", at(laneTip(lane)), {
      thread: lane,
    })
    await idle()
    const open = () =>
      readConflicts(wh.session)
        .filter(c => c.lane === lane)
        .map(c => c.path)
    await waitFor(() => open().includes("f.txt"), 60_000)
    const chose = await wu.resolve(lane, "f.txt", "theirs")
    const told =
      (await waitFor(() => {
        const now = tree()
        return ancestry(now, laneTip(lane)).path.some(id => {
          const m = now.entries[id]?.message as
            | { readonly role?: string; readonly content?: unknown }
            | undefined
          return (
            m?.role === "fact" &&
            String(m.content).includes("f.txt") &&
            String(m.content).includes("its conflict is closed")
          )
        })
      }, 30_000)) >= 0
    const resolveState = [...readStates(wh.session).values()].find(
      r => r.made.kind === "resolve" && r.made.path === "f.txt",
    )
    const fInLane = await inLane(lane, "cat f.txt")
    check(
      "a person's choice of a conflict's version closes it as a state of the lane's, and tells the thread",
      chose.kind === "proposed" &&
        !open().includes("f.txt") &&
        resolveState !== undefined &&
        fInLane.includes("yours f") &&
        told,
      JSON.stringify({ chose, open: open(), resolveState, fInLane, told }),
    )

    // 6. Accepted: the shown merge's files are written into the project's
    //    folder, and nothing of the accept's own stays there.
    const openWith = (file: string) => {
      const o = readProposedByLane(wh.session).get(lane)
      return o?.kind === "folder" &&
        o.start === newestOf() &&
        o.files.includes(file) &&
        o.conflicts.length === 0
        ? o
        : undefined
    }
    await waitFor(() => openWith("b.txt") !== undefined, 60_000)
    const accepted = await wu.proposed(lane, "accept", "")
    check(
      "an accept writes the shown merge into the project's folder, and leaves nothing of its own there",
      accepted.kind === "accepted" &&
        readFileSync(path.join(dir, "b.txt"), "utf8") === "lane's\n" &&
        readFileSync(path.join(dir, "a.txt"), "utf8") ===
          "one\nyours\nthree\n" &&
        JSON.stringify(listing(dir)) ===
          JSON.stringify([...before, "b.txt", "c.txt", "f.txt"].sort()),
      `${JSON.stringify(accepted)} ${JSON.stringify(listing(dir))}`,
    )

    // 7. Accepted work restored to its state before the accept: the
    //    folder holds its files again; a restore whose preview the folder
    //    moved past is refused.
    const acceptState = newestOf()
    const beforeAccept =
      acceptState === null
        ? undefined
        : readStates(wh.session).get(acceptState)?.parents[0]
    await waitFor(() => {
      const r = readAccepted(wh.session)
      return (
        r?.kind === "folder" &&
        beforeAccept !== undefined &&
        r.kept.includes(beforeAccept)
      )
    }, 30_000)
    const restored =
      acceptState === null || beforeAccept === undefined
        ? null
        : await wu.restore({ of: beforeAccept, from: acceptState })
    check(
      "a restore of the state before the accept writes its files back into the project's folder",
      restored?.kind === "accepted-moved" &&
        !existsSync(path.join(dir, "b.txt")) &&
        readFileSync(path.join(dir, "a.txt"), "utf8") ===
          "one\nyours\nthree\n" &&
        readStates(wh.session).get(newestOf() ?? acceptState ?? ("" as never))
          ?.made.kind === "restore",
      JSON.stringify({ restored, listing: listing(dir) }),
    )
    const shownFrom = newestOf()
    writeFileSync(path.join(dir, "g.txt"), "yours, since the preview\n")
    const stale =
      shownFrom === null || acceptState === null
        ? null
        : await wu.restore({ of: acceptState, from: shownFrom })
    check(
      "a restore after your save since its preview is refused as not shown, and writes nothing",
      stale?.kind === "refused" &&
        stale.code === ERR.NOT_AS_SHOWN &&
        !existsSync(path.join(dir, "b.txt")),
      JSON.stringify(stale),
    )

    // 8. Your save after the review refuses the accept, and nothing is written.
    script.use([
      { tool: "write", args: { path: "d.txt", content: "lane's d\n" } },
      { text: "wrote d" },
    ])
    await wu.send("@agent write d", at(laneTip(lane)), { thread: lane })
    await idle()
    await waitFor(() => openWith("d.txt") !== undefined, 60_000)
    writeFileSync(path.join(dir, "e.txt"), "yours, since the review\n")
    const refused = await wu.proposed(lane, "accept", "")
    check(
      "an accept after your save since the review is refused as not shown, and writes nothing",
      refused.kind === "refused" &&
        refused.code === ERR.NOT_AS_SHOWN &&
        !existsSync(path.join(dir, "d.txt")),
      JSON.stringify(refused),
    )

    // 9. The folder becomes a jj repo: the folder lane is refused, a new one works.
    const tipBefore = laneTip(lane)
    await wu.close()
    await wh.shutdown()
    await command("jj", ["git", "init", "--colocate"], { cwd: dir })
    wh = await start()
    wu = await join(wh, "uma", "folder")
    const refusal = await wu.send("@agent again", at(tipBefore), {
      thread: lane,
    })
    check(
      "after the folder became a jj repo, its folder lane is refused, saying why",
      refusal.kind === "refused" &&
        refusal.message.includes(
          foreignLaneWords({ kind: "foreign", lane, history: "folder" }),
        ),
      JSON.stringify(refusal),
    )
  } finally {
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
    await cleanUp(wh.session, dir)
  }
}
