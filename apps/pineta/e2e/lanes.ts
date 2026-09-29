// e2e/lanes — lanes of their own, in real containers (ADR-0034).
//
//   pnpm run e2e:lanes    needs Apple's `container` running (macOS 26, Apple
//                         silicon), as `e2e:browser` needs a Playwright server
//   PINETA_LANES_SECTION=main,images,shared,commands,contract
//                         runs only the sections named, as a mutation that
//                         one section catches does
//
// Three sections:
// - main: a host with a scripted model over a throwaway project, whose
//   threads' agents each work in a Linux container on a disk cloned from
//   where they branched;
// - images: project images with no Node, and with no git;
// - shared: directories every lane and you see, never branched (ADR-0035);
// - commands: your pi skills' files, readable in a lane at /mnt/host
//   (ADR-0036);
// - contract: `container` does not promise that a clone written into a volume
//   it made works, so every upgrade reruns a small soak.

import { execFile, execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import {
  ancestry,
  atEntry,
  entryId,
  type LaneName,
  messageText,
  nearestRevision,
  type Position,
  projectTranscript,
  ROOT,
  rootOf,
} from "@pineta/core"
import {
  createVolume,
  executeOrThrow,
  hostBytesRunner,
  hostRunner,
} from "@pineta/lanes"
import { scriptedModel } from "@pineta/pi"
import {
  readLandings,
  readLaneRecords,
  readLanes,
  readOutbox,
  readProject,
  readRevisions,
  readTreeIndex,
} from "@pineta/reads"
import { readEntries, rowMessage } from "@pineta/schema"
import { startHost } from "../host/index.ts"
import { committedProject, createChecks, join, waitFor } from "./harness.ts"

const { ok, report } = createChecks()
const START_AGENT = { mode: "branch", asksAgent: true } as const
const BRANCH = { mode: "branch" } as const
const at = (id: string | null): Position =>
  id === null ? ROOT : atEntry(entryId(id))

console.log("=== Pineta — lanes of their own, in containers ===\n")

/** A shell command's output on the host; throws on failure. */
const sh = (command: string, cwd?: string): string =>
  execFileSync("sh", ["-c", command], {
    stdio: "pipe",
    ...(cwd === undefined ? {} : { cwd }),
  }).toString()
const jj = (dir: string, ...args: string[]): string =>
  execFileSync("jj", ["--no-pager", "-R", dir, ...args], {
    stdio: "pipe",
  }).toString()

const container = (lane: LaneName) => `pineta-${lane}`
/**
 * `script` run in a lane's container, as root, between runs: the container
 * is started for it and stopped after, as the host would.
 */
function inLane(lane: LaneName, script: string): string {
  const name = container(lane)
  const state = sh(
    `container inspect ${name} | grep -o '"state" *: *"[a-z]*"' || true`,
  )
  const wasRunning = state.includes("running")
  if (!wasRunning) sh(`container start ${name} >/dev/null`)
  try {
    return execFileSync(
      "container",
      ["exec", name, "sh", "-c", `cd /workspace && ${script}`],
      { stdio: "pipe" },
    ).toString()
  } catch (error) {
    // A command that fails is a check's to judge, from what it printed.
    const e = error as { stdout?: Buffer; stderr?: Buffer }
    return `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`
  } finally {
    if (!wasRunning) sh(`container stop ${name} >/dev/null`)
  }
}

/** `inLane` for a lane that is running now; empty if it is not. */
function inLaneQuiet(lane: LaneName, script: string): string {
  try {
    return execFileSync(
      "container",
      ["exec", container(lane), "sh", "-c", script],
      { stdio: "pipe" },
    ).toString()
  } catch {
    return ""
  }
}
/** Remove every container and volume of a host's lanes, then its project. */
function cleanUp(doc: Parameters<typeof readLaneRecords>[0], dir: string) {
  for (const lane of readLaneRecords(doc).keys())
    sh(
      `container rm -f ${container(lane as LaneName)} >/dev/null 2>&1; container volume rm ${container(lane as LaneName)} >/dev/null 2>&1; true`,
    )
  rmSync(dir, { recursive: true, force: true })
}
const jjFails = (dir: string, ...args: string[]): boolean => {
  try {
    jj(dir, ...args)
    return false
  } catch {
    return true
  }
}

// ── the main section: one host, checks 1–8 ────────────────────────────
async function mainSection(): Promise<void> {
  const home = homedir()
  const marker = path.join(home, `.pineta-e2e-marker-${process.pid}`)
  writeFileSync(marker, "visible only on the host\n")
  const project = committedProject("pineta-lanes-", {
    "shared.txt": "one\ntwo\nthree\n",
    ".gitignore": "node_modules/\n.vite/\n",
    "pineta.json": `${JSON.stringify({ lanes: { ssh: true } })}\n`,
  })
  const script = scriptedModel()
  const logs: string[] = []
  const wh = await startHost({
    model: { kind: "scripted", script },
    tools: { project },
    // A file of its own, so the person's own config never applies here.
    userConfig: path.join(project, "no-user-config.json"),
    log: m => {
      logs.push(m)
      if (process.env.PINETA_E2E_LOG === "1") console.log(m)
    },
  })
  const wu = await join(wh, "uma", "lanes")
  await wu.setName("Uma")
  const tree = () => readTreeIndex(wh.doc)
  const idle = async () => {
    await waitFor(
      () =>
        Object.keys(wh.doc.activeRuns()).length === 0 &&
        readOutbox(wh.doc).length === 0,
      180_000,
    )
    await wh.quiet()
  }
  const idOf = (text: string): string | null => {
    const index = tree()
    return (
      Object.keys(index.entries).find(
        id => projectTranscript(index, id).at(-1)?.text === text,
      ) ?? null
    )
  }
  /** The lane whose thread holds the message with `text`. */
  const laneWith = (text: string) => {
    const id = idOf(text)
    const index = tree()
    return readLanes(wh.doc, index).find(
      l => id !== null && ancestry(index, l.tip).path.includes(id),
    )
  }
  const tipOf = (text: string) => laneWith(text)?.tip ?? null
  /** Every tool result's text in a lane's thread, oldest first. */
  const toolResults = (lane: LaneName | undefined): string[] => {
    if (lane === undefined) return []
    const index = tree()
    const tip = readLanes(wh.doc, index).find(l => l.name === lane)?.tip ?? null
    const onPath = new Set(ancestry(index, tip).path)
    return Object.values(readEntries(wh.doc))
      .filter(r => onPath.has(r.id))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(r => rowMessage(r) as { role?: string })
      .filter(m => m.role === "toolResult")
      .map(m => messageText(m as never))
  }

  try {
    await waitFor(() => readProject(wh.doc) !== null, 30_000)
    ok(
      readProject(wh.doc)?.kind === "lanes",
      `the host finds container and gives threads lanes of their own (${JSON.stringify(readProject(wh.doc))})`,
    )

    // ── 1. Two lanes at once: the same file, the same port, their own ──────
    const serve =
      "node -e \"require('http').createServer((q, s) => s.end(require('os').hostname())).listen(5173)\" > /dev/null 2>&1 & sleep 0.5; hostname > who.txt; node -e \"fetch('http://127.0.0.1:5173').then(r => r.text()).then(t => console.log('served ' + t))\""
    script.use([
      { tool: "bash", args: { command: serve } },
      { tool: "bash", args: { command: serve } },
      { text: "noted" },
      { text: "noted" },
    ])
    await Promise.all([
      wu.chat("lane one: who are you?", ROOT, START_AGENT),
      wu.chat("lane two: who are you?", ROOT, START_AGENT),
    ])
    await idle()
    const one = laneWith("lane one: who are you?")
    const two = laneWith("lane two: who are you?")
    const servedOne = toolResults(one?.name).join("")
    const servedTwo = toolResults(two?.name).join("")
    ok(
      one !== undefined &&
        two !== undefined &&
        servedOne.includes(`served ${container(one.name)}`) &&
        servedTwo.includes(`served ${container(two.name)}`),
      "two lanes serve :5173 at once, each its own",
    )
    ok(
      one !== undefined &&
        two !== undefined &&
        inLane(one.name, "cat who.txt").trim() === container(one.name) &&
        inLane(two.name, "cat who.txt").trim() === container(two.name) &&
        !existsSync(path.join(project, "who.txt")),
      "two lanes write the same file, each on its own disk, and your working copy is untouched",
    )

    // ── 3. The boundary ────────────────────────────────────────────────────
    script.use([
      {
        tool: "bash",
        args: {
          command: `touch /mnt/host-working-copy/from-bash 2>&1; echo "home: $(ls ${marker} 2>&1)"; echo "ssh: $SSH_AUTH_SOCK"; ls /mnt/host-working-copy/shared.txt`,
        },
      },
      {
        tool: "write",
        args: { path: "/mnt/host-working-copy/from-write", content: "x" },
      },
      { text: "checked" },
    ])
    const asked = `check the boundary, and ${project}/shared.txt`
    await wu.chat(asked, at(tipOf("lane one: who are you?")), {
      lane: one?.name,
    })
    await idle()
    ok(
      idOf("check the boundary, and /mnt/host-working-copy/shared.txt") !==
        null && idOf(asked) === null,
      "a person's path to your working copy is stored as the lane sees it, under /mnt/host-working-copy",
    )
    const boundary = toolResults(one?.name).slice(-2)
    const [bash, write] = boundary
    ok(
      bash?.includes("Read-only file system") === true &&
        write?.includes("EROFS") === true &&
        !existsSync(path.join(project, "from-bash")) &&
        !existsSync(path.join(project, "from-write")),
      `a write to /mnt/host-working-copy fails, through bash and through write (${write?.slice(0, 80) ?? "none"})`,
    )
    ok(
      bash?.includes("No such file or directory") === true &&
        bash.includes("/mnt/host-working-copy/shared.txt"),
      "your home directory is not in a lane; your working copy is, at /mnt/host-working-copy",
    )
    ok(
      /ssh: \S+/.test(bash ?? ""),
      `with ssh granted, the lane has SSH_AUTH_SOCK (${bash?.match(/ssh: .*/)?.[0] ?? "none"})`,
    )

    // ── revisions: in the document, and in your repo by bundle ─────────────
    // Lane one's first run committed who.txt; its prompt and that message each
    // have a record with a snapshot, and your repo holds its bookmark.
    const ofOne = [...readRevisions(wh.doc).values()].filter(
      r => r.lane === one?.name,
    )
    const bookmark = (lane: LaneName | undefined) =>
      lane === undefined
        ? ""
        : jj(
            project,
            "log",
            "--no-graph",
            "-r",
            `present(bookmarks(exact:"pineta/${lane}"))`,
            "-T",
            "commit_id",
          ).trim()
    ok(
      ofOne.length >= 2 &&
        ofOne.every(r => r.snapshot !== null) &&
        ofOne.some(r => r.commit !== null && r.commit === bookmark(one?.name)),
      `each turn of a lane of its own records a snapshot, and your repo fetches its commits (${ofOne.length} records)`,
    )
    ok(
      bookmark(one?.name) !== "" &&
        jjFails(project, "describe", "-r", bookmark(one?.name), "-m", "x"),
      "a lane's commits in your repo are immutable",
    )

    // ── 2. Branching: the whole directory, byte for byte ───────────────────
    // Lane one writes tracked and ignored files; a branch at that turn gets
    // them all, and its writes never reach its parent.
    script.use([
      {
        tool: "bash",
        args: {
          command:
            "mkdir -p node_modules/dep .vite && head -c 300000 /dev/urandom > node_modules/dep/index.bin && head -c 5000 /dev/urandom > .vite/cache.bin && echo 'one\ntwo (lane)\nthree' > shared.txt",
        },
      },
      { text: "set up" },
    ])
    await wu.chat(
      "set up deps",
      at(tipOf("check the boundary, and /mnt/host-working-copy/shared.txt")),
      {
        lane: one?.name,
      },
    )
    await idle()
    const sums = (lane: LaneName) =>
      inLane(
        lane,
        "sha256sum shared.txt node_modules/dep/index.bin .vite/cache.bin",
      )
    const parentSums = one === undefined ? "" : sums(one.name)
    const setUp = idOf("set up")
    // Lane one goes on after the fork point.
    script.use([
      { tool: "bash", args: { command: "echo parent-later > shared.txt" } },
      { text: "parent moved on" },
    ])
    await wu.chat("move on", at(setUp), { lane: one?.name })
    await idle()
    script.use([
      { tool: "bash", args: { command: "echo branch > shared.txt" } },
      { text: "branched" },
    ])
    await wu.chat("@agent branch here", at(setUp), BRANCH)
    await idle()
    const branch = laneWith("@agent branch here")
    // Checked on a fresh branch of the same turn, before it writes.
    script.use([{ text: "just looking" }])
    await wu.chat("@agent look only", at(setUp), BRANCH)
    await idle()
    const looker = laneWith("@agent look only")
    ok(
      looker !== undefined &&
        parentSums !== "" &&
        sums(looker.name).replace(/shared.txt.*/, "") ===
          parentSums.replace(/shared.txt.*/, "") &&
        sums(looker.name) === parentSums,
      "a branch at a turn has that turn's tracked files, node_modules and .vite cache, byte for byte",
    )
    ok(
      branch !== undefined &&
        one !== undefined &&
        inLane(branch.name, "cat shared.txt").trim() === "branch" &&
        inLane(one.name, "cat shared.txt").trim() === "parent-later",
      "a branch's writes never reach its parent, nor its parent's its",
    )
    // A branch of the branch.
    script.use([
      { tool: "bash", args: { command: "echo deeper >> shared.txt" } },
      { text: "deeper" },
    ])
    await wu.chat("@agent go deeper", at(idOf("branched")), BRANCH)
    await idle()
    const deeper = laneWith("@agent go deeper")
    ok(
      deeper !== undefined &&
        branch !== undefined &&
        inLane(deeper.name, "cat shared.txt") === "branch\ndeeper\n" &&
        inLane(branch.name, "cat shared.txt") === "branch\n",
      "a branch of a branch starts from its parent's turn, and leaves it alone",
    )
    ok(
      jj(
        project,
        "log",
        "--no-graph",
        "-r",
        "divergent()",
        "-T",
        "commit_id",
      ).trim() === "",
      "your repo holds every lane's commits with no divergent change",
    )

    // ── 8. A fork cannot rewrite what it inherited ─────────────────────────
    // The commit the branches forked at, which every one of them inherits.
    const inherited = nearestRevision(
      tree(),
      readRevisions(wh.doc),
      at(setUp),
    ).commit
    script.use([
      {
        tool: "bash",
        args: {
          command: `jj describe -r ${inherited} -m rewritten 2>&1; echo "exit $?"`,
        },
      },
      { text: "tried" },
    ])
    await wu.chat("try to rewrite", at(tipOf("@agent go deeper")), {
      lane: deeper?.name,
    })
    await idle()
    const rewrite = toolResults(deeper?.name).at(-1) ?? ""
    ok(
      inherited !== undefined &&
        inherited !== null &&
        rewrite.includes("immutable") &&
        !rewrite.includes("exit 0"),
      `rewriting an inherited commit in a fork is refused (${rewrite.split("\n")[0] ?? ""})`,
    )

    // ── 4. A file the agent wrote is whole in a branch at the next turn ─────
    script.use([
      {
        tool: "bash",
        args: {
          command:
            "head -c 20000000 /dev/urandom > big.bin && sha256sum big.bin > big.sum",
        },
      },
      { text: "wrote big" },
    ])
    await wu.chat("write something big", at(tipOf("try to rewrite")), {
      lane: deeper?.name,
    })
    // At once, while the snapshot may still be running.
    await waitFor(() => idOf("wrote big") !== null, 60_000)
    script.use([{ text: "have a look" }])
    await wu.chat("@agent branch at once", at(idOf("wrote big")), BRANCH)
    await idle()
    const atOnce = laneWith("@agent branch at once")
    ok(
      atOnce !== undefined &&
        inLane(atOnce.name, "sha256sum -c big.sum 2>&1").includes(
          "big.bin: OK",
        ),
      "a file the agent wrote is whole in a branch taken at the next turn",
    )

    // ── 5. A timeout and an abort leave nothing running in the guest ───────
    script.use([
      {
        tool: "bash",
        args: { command: "(sleep 77.1 &) ; sleep 77.1", timeout: 1 },
      },
      { tool: "bash", args: { command: "sleep 78.2 & sleep 78.2" } },
      { text: "never" },
    ])
    await wu.chat("sleep a while", at(tipOf("have a look")), {
      lane: atOnce?.name,
    })
    // The second command is running: stop it, as a person does.
    await waitFor(
      () =>
        atOnce !== undefined &&
        inLaneQuiet(atOnce.name, "ps -eo args").includes("sleep 78.2"),
      60_000,
    )
    if (atOnce !== undefined) await wu.stop(atOnce.name)
    await idle()
    const left =
      atOnce === undefined
        ? "?"
        : inLane(
            atOnce.name,
            "ps -eo args | grep -c 'sleep 7[78]' || true",
          ).trim()
    ok(
      left === "0",
      `a bash timeout and an aborted run leave no process in the guest (${left} left)`,
    )

    // ── 6. Landing and taking ──────────────────────────────────────────────
    // You change line two, commit, and keep editing; lane two changed it too.
    script.use([
      {
        tool: "bash",
        args: { command: "echo 'one\ntwo (lane two)\nthree' > shared.txt" },
      },
      { text: "edited" },
    ])
    await wu.chat("edit line two", at(tipOf("lane two: who are you?")), {
      lane: two?.name,
    })
    await idle()
    writeFileSync(path.join(project, "shared.txt"), "one\ntwo (you)\nthree\n")
    jj(project, "commit", "-m", "you edit line two")
    writeFileSync(path.join(project, "still-editing.txt"), "wip\n")
    script.use([
      {
        tool: "write",
        args: {
          path: "shared.txt",
          content: "one\ntwo (you, and lane)\nthree\n",
        },
      },
      { text: "resolved: both kept" },
    ])
    const landed = two === undefined ? null : await wu.land(two.name)
    await idle()
    const landing = readLandings(wh.doc).at(-1)
    const landMessage = projectTranscript(tree(), landing?.prompt ?? null).at(
      -1,
    )
    ok(
      landed?.kind === "started" &&
        landMessage?.text.includes("1 file conflicts") === true &&
        landing?.state === "resolved",
      `landing merges your work in the lane, and the agent resolves the conflict (${landing?.state ?? JSON.stringify(landed)})`,
    )
    const taken = two === undefined ? null : await wu.take(two.name)
    ok(
      taken?.kind === "taken" &&
        readFileSync(path.join(project, "shared.txt"), "utf8") ===
          "one\ntwo (you, and lane)\nthree\n" &&
        readFileSync(path.join(project, "still-editing.txt"), "utf8") ===
          "wip\n",
      `taking it rebases your @ onto the lane's merge, keeping your uncommitted file (${JSON.stringify(taken)})`,
    )

    // ── 7. Archiving keeps each lane's newest snapshot; restoring runs again ─
    const snapshots = path.join(project, ".pineta", "snapshots")
    const rootOne =
      one?.tip === undefined || one.tip === null
        ? null
        : rootOf(tree(), one.tip)
    const inRootOne = (records: ReturnType<typeof readRevisions>) =>
      [...records.values()].filter(
        r =>
          rootOne !== null &&
          rootOf(tree(), r.entry) === rootOne &&
          r.snapshot !== null,
      )
    const before = inRootOne(readRevisions(wh.doc))
    if (rootOne !== null) await wu.archive("archive", entryId(rootOne))
    await wh.quiet()
    const kept = before.filter(r =>
      existsSync(path.join(snapshots, `${r.snapshot}.img`)),
    )
    const lanesInRoot = new Set(before.map(r => r.lane))
    const newestKept = [...lanesInRoot].every(lane => {
      const mine = before.filter(r => r.lane === lane)
      const newest = mine.sort((a, b) => (a.entry < b.entry ? 1 : -1))[0]
      return kept.some(k => k.entry === newest?.entry)
    })
    ok(
      kept.length === lanesInRoot.size &&
        newestKept &&
        one !== undefined &&
        !sh(`container list -a --quiet`).includes(container(one.name)),
      `archiving a root deletes its lanes' containers and all but each lane's newest snapshot (${before.length} → ${kept.length})`,
    )
    if (rootOne !== null) await wu.archive("restore", entryId(rootOne))
    script.use([
      { tool: "bash", args: { command: "cat shared.txt" } },
      { text: "back" },
    ])
    await wu.chat("still there?", at(tipOf("move on")), { lane: one?.name })
    await idle()
    ok(
      toolResults(one?.name).at(-1)?.trim() === "parent-later",
      "after restoring, a lane runs again on its newest snapshot",
    )

    // A lane with a record and neither a disk nor a snapshot predates lane
    // containers: its tools say so, and name what to do.
    if (two !== undefined) {
      await wh.quiet()
      sh(
        `container rm -f ${container(two.name)} >/dev/null 2>&1; container volume rm ${container(two.name)} >/dev/null 2>&1; true`,
      )
      for (const r of readRevisions(wh.doc).values())
        if (r.lane === two.name && r.snapshot !== null)
          rmSync(path.join(snapshots, `${r.snapshot}.img`), { force: true })
    }
    script.use([
      { tool: "bash", args: { command: "echo still" } },
      { text: "retired" },
    ])
    await wu.chat("are you there?", at(two?.tip ?? null), { lane: two?.name })
    await idle()
    ok(
      toolResults(two?.name).at(-1)?.includes("predates lane containers") ===
        true,
      `a lane with no disk and no snapshot says it predates lane containers (${toolResults(two?.name).at(-1)?.slice(0, 60) ?? "none"})`,
    )
  } finally {
    // Whatever happened above: nothing of this run is left behind.
    rmSync(marker, { force: true })
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
    cleanUp(wh.doc, project)
  }
}
// ── 9. Any image with sh and git: Pineta brings Node and jj ──────────────
// Alpine has musl and no Node; the helper runs on the lane runtime's Node,
// through its own loader. An image with no git cannot host a lane.
/**
 * A host of its own for a section: a project (`files`, or an existing `dir`),
 * its own scripted model and user, and reads by message text. `close` removes
 * its lanes; `keep` leaves the project, for a host to restart over.
 */
async function sectionHost(input: {
  readonly files?: Readonly<Record<string, string>>
  readonly dir?: string
  readonly store?: string
  readonly userConfig?: string
  readonly agentDir?: string
  readonly logs?: string[]
}) {
  const dir =
    input.dir ?? committedProject("pineta-section-", input.files ?? {})
  const script = scriptedModel()
  const host = await startHost({
    model: { kind: "scripted", script },
    tools: { project: dir },
    ...(input.store === undefined ? {} : { store: input.store }),
    // A file of its own, so the person's own config never applies here.
    userConfig: input.userConfig ?? path.join(dir, "no-user-config.json"),
    ...(input.agentDir === undefined ? {} : { agentDir: input.agentDir }),
    log: m => {
      input.logs?.push(m)
      if (process.env.PINETA_E2E_LOG === "1") console.log(m)
    },
  })
  const user = await join(
    host,
    `u${Math.random().toString(36).slice(2, 10)}`,
    `section-${process.pid}`,
  )
  const idle = async () => {
    await waitFor(
      () =>
        Object.keys(host.doc.activeRuns()).length === 0 &&
        readOutbox(host.doc).length === 0,
      300_000,
    )
    await host.quiet()
  }
  /** The lane whose thread holds the message with `text`. */
  const laneWith = (text: string) => {
    const index = readTreeIndex(host.doc)
    const id =
      Object.keys(index.entries).find(
        e => projectTranscript(index, e).at(-1)?.text === text,
      ) ?? null
    return readLanes(host.doc, index).find(
      l => id !== null && ancestry(index, l.tip).path.includes(id),
    )
  }
  /** Every tool result's text in the thread holding `text`, oldest first. */
  const results = async (text: string) => {
    await idle()
    const index = readTreeIndex(host.doc)
    const onPath = new Set(ancestry(index, laneWith(text)?.tip ?? null).path)
    return Object.values(readEntries(host.doc))
      .filter(r => onPath.has(r.id))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(r => rowMessage(r) as { role?: string })
      .filter(m => m.role === "toolResult")
      .map(m => messageText(m as never))
  }
  const close = async (keep = false) => {
    await user.close().catch(() => {})
    await host.shutdown().catch(() => {})
    // Kept for a restart: the lanes' containers too, as a host leaves them.
    if (!keep) cleanUp(host.doc, dir)
  }
  return { dir, script, host, user, idle, laneWith, results, close }
}

const imageHost = (containerfile: string) =>
  sectionHost({
    files: {
      "pineta.Containerfile": containerfile,
      "notes.txt": "the secret word is MANGO\n",
    },
  })
async function imagesSection(): Promise<void> {
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
    ok(
      ran[0]?.includes("MANGO") === true &&
        ran.at(-1)?.includes("edited") === true &&
        ran.at(-1)?.includes("no node") === true &&
        ran.at(-1)?.includes("musl") === true,
      `a lane on Alpine, with musl and no Node, runs pi's four tools (${JSON.stringify(ran.at(-1))})`,
    )
    const recorded = [...readRevisions(alpine.host.doc).values()]
    ok(
      recorded.some(r => r.commit !== null && r.snapshot !== null),
      "and its turn is committed and snapshotted",
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
    ok(
      refused.includes("has no git") && !refused.includes("hello\n"),
      `an image with no git cannot host a lane, and says so (${refused.slice(0, 90)})`,
    )
  } finally {
    await bare.close()
  }
}

// ── the contract: a clone written into a volume `container` made ─────────
// Not an API of `container` (S40): a volume is its `entity.json` and an image
// read by path. Twenty clones of a journaled volume, taken while a writer
// appends fsynced records, must each check clean and hold every record
// fsynced before it was taken (S41's soak, in small).
/** An image with `e2fsck` and `debugfs`, to read a lane's disk: built once and kept. */
const FSCK_IMAGE = "pineta-fsck:1"

function ensureFsckImage(): void {
  if (sh(`container image list --quiet`).includes("pineta-fsck")) return
  const context = realpathSync(mkdtempSync(path.join(tmpdir(), "pineta-fsck-")))
  try {
    writeFileSync(
      path.join(context, "Containerfile"),
      "FROM docker.io/library/alpine:3.22\nRUN apk add --no-cache e2fsprogs e2fsprogs-extra\n",
    )
    sh(
      `container build -t ${FSCK_IMAGE} -f ${context}/Containerfile ${context} >/dev/null 2>&1; container builder stop >/dev/null 2>&1; true`,
    )
  } finally {
    rmSync(context, { recursive: true, force: true })
  }
}

// ── shared: directories every lane and you see, never branched (ADR-0035) ──
async function sharedSection(): Promise<void> {
  const logs: string[] = []
  const store = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "pineta-store-"))),
    "pineta.db",
  )
  const userConfig = path.join(path.dirname(store), "config.json")
  writeFileSync(
    userConfig,
    JSON.stringify({ lanes: { shared: [".plans", ".jj/x"] } }),
  )
  let h = await sectionHost({
    files: { "shared.txt": "one\n" },
    store,
    userConfig,
    logs,
  })
  const { dir } = h
  try {
    ok(
      logs.some(l => l.includes(".plans/ is shared read-write")) &&
        logs.some(l => l.includes(".jj/x is not shared: it is inside .jj")),
      "the user's shared directories apply, and a refused one is logged with its reason",
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
    ok(
      existsSync(plan) &&
        readFileSync(plan, "utf8") === "the plan\n" &&
        statSync(plan).uid === process.getuid?.(),
      "a plan a lane writes is in your working copy at once, and yours",
    )
    h.script.use([
      { tool: "bash", args: { command: "cat .plans/a.md" } },
      { text: "read" },
    ])
    await h.user.chat("read the plan", ROOT, START_AGENT)
    ok(
      (await h.results("read the plan")).at(-1)?.includes("the plan") === true,
      "another lane reads it",
    )

    // 2. Never branched: not in the lane's commit, your repo, a snapshot or @.
    const writer = h.laneWith("write a plan")
    const files = (rev: string) =>
      jj(dir, "file", "list", "--ignore-working-copy", "-r", rev)
    const newest = [...readRevisions(h.host.doc).values()]
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
    ok(
      writer !== undefined &&
        newest !== undefined &&
        files(`pineta/${writer.name}`).includes("shared.txt") &&
        !files(`pineta/${writer.name}`).includes(".plans") &&
        !files("@").includes(".plans") &&
        !inSnapshot.includes("a.md") &&
        (await h.results("@agent look from a branch"))
          .at(-1)
          ?.includes("after the fork") === true,
      "a shared directory is never in a lane's commit, your @ or a snapshot, and a branch sees it live",
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
    ok(
      existsSync(path.join(dir, "notes", "n.md")) &&
        noted.includes("lane") &&
        noted.includes("a.md"),
      `after a restart, an existing lane has the newly shared directory, with its disk as it was (${noted.replaceAll("\n", " ")})`,
    )
  } finally {
    await h.close()
    rmSync(path.dirname(store), { recursive: true, force: true })
  }
}

// ── commands: skill files at /mnt/host in a lane (ADR-0036) ─────────────────
async function commandsSection(): Promise<void> {
  const fixtures = path.join(
    import.meta.dirname,
    "../../../packages/pi/fixtures",
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
    const inLane = `/mnt/host${hello}`
    ok(
      told.includes(
        `<skill name="hello" location="${inLane}/SKILL.md">\nReferences are relative to ${inLane}.`,
      ),
      `in a lane of its own, an expanded skill names its files at /mnt/host (${told.slice(0, 90)})`,
    )
    ok(
      system.includes(
        `/mnt/host${path.join(fixtures, "fixture-pkg", "skills", "explain")}/SKILL.md`,
      ),
      "the system prompt lists the skills the model may use at /mnt/host",
    )
    h.script.use([
      {
        tool: "bash",
        args: {
          command: `cat ${inLane}/references/note.md; sh ${inLane}/scripts/hello.sh; ls /mnt/host${agentDir} 2>&1 | head -1`,
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
    ok(
      ran.includes("HELLO-NOTE") && ran.includes("HELLO-SCRIPT"),
      "the lane reads the skill's references and runs its scripts there",
    )
    ok(
      ran.includes("No such file or directory"),
      `pi's agent directory is never mounted (${ran.trim().split("\n").at(-1)})`,
    )
  } finally {
    await h.close()
  }
}

/** Clones the contract checks. */
const CLONES = 20

async function contractSection(): Promise<void> {
  const status = JSON.parse(sh("container system status --format json")) as {
    paths: { appRoot: string }
  }
  const volume = `pineta-contract-${process.pid}`
  const image = path.join(status.paths.appRoot, "volumes", volume, "volume.img")
  const probe = realpathSync(mkdtempSync(path.join(tmpdir(), "pineta-soak-")))
  const clones = path.join(probe, "clones")
  sh(`mkdir -p ${clones}`)
  // Appends fsynced records, and churns files, until the host says stop.
  writeFileSync(
    path.join(probe, "writer.js"),
    `const fs = require("fs"), crypto = require("crypto")
const fd = fs.openSync("/workspace/log.bin", "a")
let n = 0
while (!fs.existsSync("/probe/stop")) {
  fs.writeSync(fd, "rec " + String(n).padStart(8, "0") + " " + "x".repeat(40) + "\\n")
  fs.fsyncSync(fd)
  n++
  fs.writeFileSync("/probe/fsynced", String(n))
  if (n % 20 === 0) fs.writeFileSync("/workspace/churn-" + (n % 7), crypto.randomBytes(40000))
}
`,
  )
  // One clone: replay the journal, check, and compare the records with what
  // was fsynced before the clone was taken. One line per clone.
  writeFileSync(
    path.join(probe, "check-one.sh"),
    `img=$1; n=$2; w=/tmp/w-$img; mkdir -p $w
cd /clones
e2fsck -fy "$img" > $w/fsck1 2>&1
e2fsck -fn "$img" > $w/fsck2 2>&1; clean=$?
repairs=$(awk 'NF { if ($0 ~ /\\? yes$/) { d = ($0 ~ /^[A-Za-z ]+\\? yes$/) ? prev : $0; print d } prev = $0 }' $w/fsck1 | grep -cvE '^Free (blocks|inodes) count wrong')
debugfs -R "dump /log.bin $w/log.bin" "$img" >/dev/null 2>&1
bad=$(head -n "$n" $w/log.bin | awk '!/^rec [0-9]{8} x{40}$/ { b++ } END { print b + 0 }')
have=$(wc -l < $w/log.bin)
echo "$img repairs=$repairs clean=$clean promised=$n have=$have bad=$bad"
rm -rf $w
`,
  )
  ensureFsckImage()
  // Small, so each check is quick: `e2fsck -f` walks every block group of a
  // volume, however little it holds. The journal is what is under test.
  await executeOrThrow([createVolume(volume, "4G")], {
    host: hostRunner(),
    lane: hostRunner(),
    laneBytes: hostBytesRunner(),
  })
  const writer = `pineta-contract-writer-${process.pid}`
  const fsynced = () =>
    Number(
      existsSync(path.join(probe, "fsynced"))
        ? readFileSync(path.join(probe, "fsynced"), "utf8").trim()
        : "0",
    )
  try {
    const t0 = Date.now()
    sh(
      `container run -d --init --name ${writer} -m 1G -v ${volume}:/workspace --mount type=bind,source=${probe},target=/probe docker.io/library/node:24-trixie-slim sleep infinity >/dev/null`,
    )
    const writing = new Promise<void>((resolve, reject) => {
      execFile(
        "container",
        ["exec", writer, "node", "/probe/writer.js"],
        error => (error === null ? resolve() : reject(error)),
      )
    })
    // Clones start once the writer is under way, and are taken back to back
    // with short random gaps while it writes (S41's soak, in small).
    await waitFor(() => fsynced() >= 100, 30_000)
    const t1 = Date.now()
    const promised: string[] = []
    for (let i = 0; i < CLONES; i++) {
      const count = fsynced()
      execFileSync("/bin/cp", ["-c", image, path.join(clones, `c${i}.img`)])
      promised.push(`c${i}.img ${count}`)
      await new Promise(r => setTimeout(r, 50 + Math.random() * 150))
    }
    writeFileSync(path.join(probe, "stop"), "")
    await writing
    const t2 = Date.now()
    writeFileSync(path.join(clones, "promised"), `${promised.join("\n")}\n`)
    const checked = sh(
      `container run --rm -v ${clones}:/clones -v ${probe}:/probe ${FSCK_IMAGE} sh -c 'xargs -n 2 -P 4 sh /probe/check-one.sh < /clones/promised'`,
    )
    const t3 = Date.now()
    console.log(
      `  (contract: writer up in ${((t1 - t0) / 1000).toFixed(1)} s, ${CLONES} clones in ${((t2 - t1) / 1000).toFixed(1)} s, checked in ${((t3 - t2) / 1000).toFixed(1)} s)`,
    )
    const rows = checked.trim().split("\n")
    const good = rows.filter(row => {
      const f = Object.fromEntries(
        row
          .split(" ")
          .slice(1)
          .map(kv => kv.split("=")),
      ) as Record<string, string>
      return (
        f.repairs === "0" &&
        f.clean === "0" &&
        f.bad === "0" &&
        Number(f.have) >= Number(f.promised)
      )
    })
    ok(
      rows.length === CLONES && good.length === CLONES,
      `every clone of a journaled volume taken mid-write checks clean and holds every fsynced record (${good.length} of ${rows.length})`,
    )
    if (good.length !== rows.length)
      console.log(rows.filter(r => !good.includes(r)).join("\n"))
  } finally {
    sh(`container rm -f ${writer} >/dev/null 2>&1 || true`)
    sh(`container volume rm ${volume} >/dev/null 2>&1 || true`)
    rmSync(probe, { recursive: true, force: true })
  }
}

/** The sections, run in this order; `PINETA_LANES_SECTION` picks some. */
const SECTIONS: Readonly<Record<string, () => Promise<void>>> = {
  main: mainSection,
  images: imagesSection,
  shared: sharedSection,
  commands: commandsSection,
  contract: contractSection,
}
const chosen = (
  process.env.PINETA_LANES_SECTION ?? Object.keys(SECTIONS).join(",")
)
  .split(",")
  .map(s => s.trim())
  .filter(s => s !== "")
for (const name of chosen) {
  const section = SECTIONS[name]
  if (section === undefined)
    throw new Error(
      `no section ${name}: PINETA_LANES_SECTION takes ${Object.keys(SECTIONS).join(", ")}`,
    )
  await section()
}
report("e2e:lanes")
