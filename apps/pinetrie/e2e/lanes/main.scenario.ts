// e2e/lanes/main — one host with a scripted model over a throwaway project,
// whose threads' agents each work in a Linux container on a disk cloned from
// where they branched.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  commitId,
  type EntryId,
  entryId,
  HOST_OPERATOR,
  ROOT,
  type ThreadId,
} from "@pinetrie/core"
import { DEFAULT_REPO, laneBase, startOfProposed } from "@pinetrie/jj"
import { type Runner, run } from "@pinetrie/lanes"
import { scriptedModel } from "@pinetrie/pi"
import {
  readConflictAsks,
  readNames,
  readPlaces,
  readProject,
  readRevisions,
} from "@pinetrie/reads"
import {
  deleteRecord,
  LANE_FORK,
  PROPOSED_CHANGES,
  setRecord,
} from "@pinetrie/rules"
import { rowMessage } from "@pinetrie/schema"
import {
  ancestry,
  messageText,
  nearestRevision,
  projectTranscript,
  treeRoot,
} from "@pinetrie/threads"
import { laneMachine, planStartSteps } from "../../host/start-checklist.ts"
import { startStepWords } from "../../host/startup-lines.ts"
import type { Checks } from "../checks.ts"
import {
  at,
  BRANCH,
  committedProject,
  entryMessageIn,
  filterAsync,
  heldEntries,
  heldLanes,
  heldRootRecords,
  heldTree,
  idleNow,
  idOfText,
  join,
  laneHolding,
  moveCanvasOnBoard,
  readJjAccepted,
  readJjProposedByLane,
  START_AGENT,
  setUpAccepted,
  untilSent,
  waitFor,
} from "../harness.ts"
import { cleanUp, inLane, inLaneQuiet, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"
import {
  bringUpToDate,
  cli,
  container,
  containerExists,
  deleteEntrySnapshot,
  jj,
  jjRefusal,
  projectSnapshots,
  queueCommand,
  removeLane,
  restoreDisk,
} from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check, skip }, { lanes }) => mainSection(check, skip, lanes),
}

// ── the main section: one host, checks 1–8 ────────────────────────────
async function mainSection(
  check: Checks["check"],
  _skip: Checks["skip"],
  lanes: LaneHosts,
): Promise<void> {
  const home = homedir()
  const marker = path.join(home, `.pinetrie-e2e-marker-${process.pid}`)
  writeFileSync(marker, "visible only on the host\n")
  const project = await committedProject("pinetrie-lanes-", {
    "shared.txt": "one\ntwo\nthree\n",
    ".gitignore": "node_modules/\n.vite/\n",
    "pinetrie.json": `${JSON.stringify({ lanes: { ssh: { personal: true } }, publish: { catchUp: true } })}\n`,
  })
  const script = scriptedModel()
  const logs: string[] = []
  const wh = await lanes.startHost({
    model: { kind: "scripted", script },
    project: { dir: project, tools: true },
    log: m => {
      logs.push(m)
      if (process.env.PINETRIE_E2E_LOG === "1") console.log(m)
    },
  })
  // What the start said by the time it returned: each step's end, in order.
  const startLines = [...logs]
  const wu = await join(wh, "uma", "lanes")
  await wu.request({ kind: "name", name: "Uma" })
  const tree = () => heldTree(wh)
  const idle = async () => {
    await waitFor(() => idleNow(wh), 180_000)
    await wh.quiet()
  }
  const idOf = (text: string): EntryId | null => idOfText(wh, text)
  /** The lane whose thread holds the message with `text`. */
  const laneWith = (text: string) =>
    laneHolding(wh, readPlaces(wh.places), text)
  const tipOf = (text: string) => laneWith(text)?.tip ?? null
  const laneTip = (lane: ThreadId) =>
    heldLanes(wh, tree(), readPlaces(wh.places)).find(l => l.name === lane)
      ?.tip ?? null
  /** Every tool result's text in a lane's thread, oldest first. */
  const toolResults = (lane: ThreadId | undefined): string[] => {
    if (lane === undefined) return []
    const index = tree()
    const tip =
      heldLanes(wh, index, readPlaces(wh.places)).find(l => l.name === lane)
        ?.tip ?? null
    const onPath = new Set(ancestry(index, tip).path)
    return Object.values(heldEntries(wh))
      .filter(r => onPath.has(entryId(r.id)))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(r => rowMessage(r) as { role?: string })
      .filter(m => m.role === "toolResult")
      .map(m => messageText(m as never))
  }

  try {
    const machine = laneMachine(process.platform)
    const ends = startLines.filter(l => l.startsWith("[host] ✓ "))
    check(
      "a host's start reports each of its steps as it ends",
      planStartSteps({ tools: true }).every((step, i) =>
        ends[i]?.startsWith(`[host] ✓ ${startStepWords(step, machine)}`),
      ),
      ends.join(" | "),
    )
    await waitFor(() => readProject(wh.session) !== null, 30_000)
    check(
      "the host finds Docker and gives threads lanes of their own",
      readProject(wh.session)?.root === project,
      `${JSON.stringify(readProject(wh.session))}`,
    )
    // Threads start at accepted work: set it up at the
    // project's commit, as the footer's set up button does.
    await setUpAccepted(wh.session, wu)

    // ── 1. Two lanes at once: the same file, the same port, their own ──────
    // The fetch is tried until the server listens: a refused fetch exits
    // non-zero, and each try is a node start, so a hundred are a few seconds.
    const serve =
      "node -e \"require('http').createServer((q, s) => s.end(require('os').hostname())).listen(5173)\" > /dev/null 2>&1 & hostname > who.txt; for i in $(seq 1 100); do node -e \"fetch('http://127.0.0.1:5173').then(r => r.text()).then(t => console.log('served ' + t))\" 2>/dev/null && break; done"
    script.use([
      { tool: "bash", args: { command: serve } },
      { tool: "bash", args: { command: serve } },
      { text: "noted" },
      { text: "noted" },
    ])
    await Promise.all([
      wu.send("lane one: who are you?", ROOT, START_AGENT),
      wu.send("lane two: who are you?", ROOT, START_AGENT),
    ])
    await idle()
    const one = laneWith("lane one: who are you?")
    const two = laneWith("lane two: who are you?")
    const servedOne = toolResults(one?.name).join("")
    const servedTwo = toolResults(two?.name).join("")
    check(
      "two lanes serve :5173 at once, each its own",
      one !== undefined &&
        two !== undefined &&
        servedOne.includes(`served ${container(one.name)}`) &&
        servedTwo.includes(`served ${container(two.name)}`),
    )
    check(
      "two lanes write the same file, each on its own disk, and your working copy is untouched",
      one !== undefined &&
        two !== undefined &&
        (await inLane(one.name, "cat who.txt")).trim() ===
          container(one.name) &&
        (await inLane(two.name, "cat who.txt")).trim() ===
          container(two.name) &&
        !existsSync(path.join(project, "who.txt")),
    )
    const exclude = path.join(project, ".git", "info", "exclude")
    check(
      "nothing of pine·trie's is written in your project",
      !existsSync(path.join(project, ".pinetrie")) &&
        !(existsSync(exclude) ? readFileSync(exclude, "utf8") : "")
          .split("\n")
          .includes("/.pinetrie/"),
    )

    // ── 3. The boundary ────────────────────────────────────────────────────
    script.use([
      {
        tool: "bash",
        args: {
          command: `touch /mnt/host-working-copy/from-bash 2>&1; echo "home: $(ls ${marker} 2>&1)"; ls /mnt/host-working-copy/shared.txt`,
        },
      },
      {
        tool: "write",
        args: { path: "/mnt/host-working-copy/from-write", content: "x" },
      },
      { text: "checked" },
    ])
    const asked = `check the boundary, and ${project}/shared.txt`
    await untilSent(
      wh,
      await wu.send(asked, at(tipOf("lane one: who are you?")), {
        thread: one?.name,
      }),
      180_000,
    )
    await wh.quiet()
    check(
      "a person's path to your working copy is stored as the lane sees it, under /mnt/host-working-copy",
      idOf("check the boundary, and /mnt/host-working-copy/shared.txt") !==
        null && idOf(asked) === null,
    )
    const boundary = toolResults(one?.name).slice(-2)
    const [bash, write] = boundary
    check(
      "a write to /mnt/host-working-copy fails, through bash and through write",
      bash?.includes("Read-only file system") === true &&
        write?.includes("EROFS") === true &&
        !existsSync(path.join(project, "from-bash")) &&
        !existsSync(path.join(project, "from-write")),
      `${write?.slice(0, 80) ?? "none"}`,
    )
    check(
      "your home directory is not in a lane; your working copy is, at /mnt/host-working-copy",
      bash?.includes("No such file or directory") === true &&
        bash.includes("/mnt/host-working-copy/shared.txt"),
    )

    // ── revisions: in the document, and in your repo by bundle ─────────────
    // Lane one's first run committed who.txt; its prompt and that message each
    // have a record with a snapshot, and your repo holds its history as a
    // remote bookmark.
    const ofOne = [...heldRootRecords(wh, readRevisions).values()].filter(
      r => r.lane === one?.name,
    )
    const bookmark = async (lane: ThreadId | undefined) =>
      lane === undefined
        ? ""
        : (
            await jj(
              project,
              "log",
              "--no-graph",
              "-r",
              `present(tip@pinetrie-${lane})`,
              "-T",
              "commit_id",
            )
          ).trim()
    const oneTip = await bookmark(one?.name)
    check(
      "each turn of a lane of its own records a snapshot, and your repo fetches its commits",
      ofOne.length >= 2 &&
        ofOne.every(r => r.snapshot !== null) &&
        ofOne.some(r => r.point !== null && r.point === oneTip),
      `${ofOne.length} records`,
    )
    const refusal =
      oneTip === ""
        ? null
        : await jjRefusal(project, "describe", "-r", oneTip, "-m", "x")
    check(
      "a lane's commits in your repo are immutable",
      refusal?.includes("immutable") === true,
      `${refusal?.split("\n")[0] ?? "described"}`,
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
    await untilSent(
      wh,
      await wu.send(
        "set up deps",
        at(tipOf("check the boundary, and /mnt/host-working-copy/shared.txt")),
        {
          thread: one?.name,
        },
      ),
      180_000,
    )
    await wh.quiet()
    const sums = (lane: ThreadId) =>
      inLane(
        lane,
        "sha256sum shared.txt node_modules/dep/index.bin .vite/cache.bin",
      )
    const parentSums = one === undefined ? "" : await sums(one.name)
    const setUp = idOf("set up")
    // Lane one goes on after the fork point.
    script.use([
      { tool: "bash", args: { command: "echo parent-later > shared.txt" } },
      { text: "parent moved on" },
    ])
    await untilSent(
      wh,
      await wu.send("move on", at(setUp), { thread: one?.name }),
      180_000,
    )
    await wh.quiet()
    script.use([
      { tool: "bash", args: { command: "echo branch > shared.txt" } },
      { text: "branched" },
    ])
    await untilSent(
      wh,
      await wu.send("@agent branch here", at(setUp), BRANCH),
      180_000,
    )
    await wh.quiet()
    const branch = laneWith("@agent branch here")
    // Checked on a fresh branch of the same turn, before it writes.
    script.use([{ text: "just looking" }])
    await untilSent(
      wh,
      await wu.send("@agent look only", at(setUp), BRANCH),
      180_000,
    )
    await wh.quiet()
    const looker = laneWith("@agent look only")
    check(
      "a branch at a turn has that turn's tracked files, node_modules and .vite cache, byte for byte",
      looker !== undefined &&
        parentSums !== "" &&
        (await sums(looker.name)).replace(/shared.txt.*/, "") ===
          parentSums.replace(/shared.txt.*/, "") &&
        (await sums(looker.name)) === parentSums,
    )
    // A fork a host stopped after its clone: the looker's container gone,
    // its disk put back as its source's snapshot, its setup not run, its
    // fork owed. Its next start forks it again, so it has its own bookmark.
    const source =
      setUp === null
        ? null
        : nearestRevision(tree(), heldRootRecords(wh, readRevisions), at(setUp))
            .snapshot
    if (looker !== undefined && source !== null) {
      await wh.quiet()
      await cli(["rm", "-f", container(looker.name)])
      await restoreDisk(project, looker.name, source)
      await wh.records.writeValues([
        setRecord(LANE_FORK, { lane: looker.name, base: null, state: "owed" }),
      ])
    }
    script.use([
      { tool: "bash", args: { command: "jj bookmark list" } },
      { text: "listed" },
    ])
    await untilSent(
      wh,
      await wu.send("which bookmarks?", at(looker?.tip ?? null), {
        thread: looker?.name,
      }),
      180_000,
    )
    await wh.quiet()
    check(
      "a fork a host stopped after its clone is run again at the lane's next start",
      looker !== undefined &&
        source !== null &&
        toolResults(looker.name)
          .at(-1)
          ?.includes(`pinetrie/${looker.name}:`) === true,
      `${toolResults(looker?.name).at(-1)?.slice(0, 200) ?? "none"}`,
    )
    // That a branch's writes never reach its parent, nor its parent's it, is
    // the disks' rule, proved on btrfs by lanehost's `disks.test.ts`.
    // A branch of the branch.
    script.use([
      { tool: "bash", args: { command: "echo deeper >> shared.txt" } },
      { text: "deeper" },
    ])
    await untilSent(
      wh,
      await wu.send("@agent go deeper", at(idOf("branched")), BRANCH),
      180_000,
    )
    await wh.quiet()
    const deeper = laneWith("@agent go deeper")
    check(
      "a branch of a branch starts from its parent's turn, and leaves it alone",
      deeper !== undefined &&
        branch !== undefined &&
        (await inLane(deeper.name, "cat shared.txt")) === "branch\ndeeper\n" &&
        (await inLane(branch.name, "cat shared.txt")) === "branch\n",
    )
    check(
      "your repo holds every lane's commits with no divergent change",
      (
        await jj(
          project,
          "log",
          "--no-graph",
          "-r",
          "divergent()",
          "-T",
          "commit_id",
        )
      ).trim() === "",
    )

    // ── 8. A fork cannot rewrite what it inherited ─────────────────────────
    // The commit the branches forked at, which every one of them inherits.
    const inherited = nearestRevision(
      tree(),
      heldRootRecords(wh, readRevisions),
      at(setUp),
    ).point
    script.use([
      {
        tool: "bash",
        args: {
          command: `jj describe -r ${inherited} -m rewritten 2>&1; echo "exit $?"`,
        },
      },
      { text: "tried" },
    ])
    await untilSent(
      wh,
      await wu.send("try to rewrite", at(tipOf("@agent go deeper")), {
        thread: deeper?.name,
      }),
      180_000,
    )
    await wh.quiet()
    const rewrite = toolResults(deeper?.name).at(-1) ?? ""
    check(
      "rewriting an inherited commit in a fork is refused",
      inherited !== undefined &&
        inherited !== null &&
        rewrite.includes("immutable") &&
        !rewrite.includes("exit 0"),
      `${rewrite.split("\n")[0] ?? ""}`,
    )
    // The lane's config names a commit only its own repo has: any other repo
    // it reached would fail every jj command.
    const scratch =
      deeper === undefined
        ? "no fork"
        : await inLane(
            deeper.name,
            'cd /tmp && rm -rf scratch && mkdir scratch && cd scratch && jj git init && jj commit -m x 2>&1; echo "exit $?"',
          )
    check(
      "a jj repo outside the lane's own works in the lane",
      scratch.trim().endsWith("exit 0"),
      `${scratch.trim().split("\n").at(-1) ?? ""}`,
    )

    // ── An agent's own commit is the turn's revision ────────────────────────────
    script.use([
      {
        tool: "bash",
        args: { command: "echo mine > mine.txt && jj commit -m mine 2>&1" },
      },
      { text: "committed it" },
    ])
    await untilSent(
      wh,
      await wu.send("commit it yourself", ROOT, START_AGENT),
      180_000,
    )
    await wh.quiet()
    const committer = laneWith("commit it yourself")
    const committerProposed =
      committer === undefined
        ? undefined
        : readNames(wh.session).get(committer.name)
    const hasMine = async () =>
      committerProposed !== undefined &&
      (
        await jj(
          project,
          "file",
          "list",
          "-r",
          // An empty revision set, before the proposed changes are built, is no
          // files.
          `latest(present(bookmarks(exact:"pinetrie-proposed/${committerProposed}")) | root())`,
          'root:"mine.txt"',
        )
      ).trim() !== ""
    check(
      "a commit the agent made itself reaches its thread's proposed changes",
      (await waitFor(hasMine, 30_000)) >= 0,
    )
    script.use([{ text: "just looking" }])
    await untilSent(
      wh,
      await wu.send("@agent look at mine", at(idOf("committed it")), BRANCH),
      180_000,
    )
    await wh.quiet()
    const atMine = laneWith("@agent look at mine")
    check(
      "a branch at the turn the agent committed in has its file",
      atMine !== undefined &&
        (await inLane(atMine.name, "cat mine.txt 2>&1")).trim() === "mine",
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
    await wu.send("write something big", at(tipOf("try to rewrite")), {
      thread: deeper?.name,
    })
    // At once, while the snapshot may still be running.
    await waitFor(() => idOf("wrote big") !== null, 60_000)
    script.use([{ text: "have a look" }])
    await untilSent(
      wh,
      await wu.send("@agent branch at once", at(idOf("wrote big")), BRANCH),
      180_000,
    )
    await wh.quiet()
    const atOnce = laneWith("@agent branch at once")
    check(
      "a file the agent wrote is whole in a branch taken at the next turn",
      atOnce !== undefined &&
        (await inLane(atOnce.name, "sha256sum -c big.sum 2>&1")).includes(
          "big.bin: OK",
        ),
    )

    // ── 5. A timeout and an abort: that their processes are gone is
    // `packages/pi/lane-env.test.ts`'s. Later steps go on from this run.
    script.use([
      {
        tool: "bash",
        args: { command: "(sleep 77.1 &) ; sleep 77.1", timeout: 1 },
      },
      { tool: "bash", args: { command: "sleep 78.2 & sleep 78.2" } },
      { text: "never" },
    ])
    await wu.send("sleep a while", at(tipOf("have a look")), {
      thread: atOnce?.name,
    })
    // The second command is running: stop it, as a person does.
    await waitFor(
      async () =>
        atOnce !== undefined &&
        (await inLaneQuiet(atOnce.name, "ps -eo args")).includes("sleep 78.2"),
      60_000,
    )
    if (atOnce !== undefined)
      await wu.request({ kind: "stop", lane: atOnce.name })
    await idle()

    // ── 6. ProposedChanges: the thread's work as one commit you accept
    // ────────────
    const proposedFromRows = () =>
      two === undefined
        ? undefined
        : readJjProposedByLane(wh.session).get(two.name)
    const defaultLog = () =>
      jj(
        project,
        "log",
        "--no-graph",
        "-T",
        'description.first_line() ++ "\\n"',
      )
    script.use([
      {
        tool: "bash",
        args: { command: "echo 'one\ntwo (lane two)\nthree' > shared.txt" },
      },
      { text: "edited" },
    ])
    await untilSent(
      wh,
      await wu.send("edit line two", at(tipOf("lane two: who are you?")), {
        thread: two?.name,
      }),
      180_000,
    )
    await wh.quiet()
    const proposed = await waitFor(
      () => proposedFromRows()?.files.includes("shared.txt") === true,
      30_000,
    )
    await wh.quiet()
    check(
      "a turn's work is proposed changes in your repo, described, and its turns are not in your log",
      proposed >= 0 &&
        proposedFromRows()?.described === true &&
        !(await defaultLog()).includes("edit line two") &&
        (await defaultLog()).includes("proposed changes: scripted"),
      `${JSON.stringify({ files: proposedFromRows()?.files, described: proposedFromRows()?.described, log: (await defaultLog()).split("\n").slice(0, 4) })}`,
    )
    // Every lane has a name, two words, and no two alike; the proposed changes'
    // bookmark and its message's trailer carry it.
    const names = readNames(wh.session)
    const twoName = two === undefined ? undefined : names.get(two.name)
    const proposedBookmarkFor = (lane: ThreadId | undefined) =>
      lane === undefined
        ? ""
        : `pinetrie-proposed/${readNames(wh.session).get(lane) ?? ""}`
    const allNamed = heldLanes(wh, tree(), readPlaces(wh.places)).every(l =>
      names.has(l.name),
    )
    check(
      "every lane has a two-word name, unique; the proposed changes' bookmark and trailer carry it",
      allNamed &&
        [...names.values()].every(n => /^[a-z]+-[a-z]+$/.test(n)) &&
        new Set(names.values()).size === names.size &&
        proposedFromRows()?.bookmark === proposedBookmarkFor(two?.name) &&
        (
          await jj(
            project,
            "log",
            "--no-graph",
            "-r",
            proposedBookmarkFor(two?.name),
            "-T",
            "description",
          )
        ).includes(`Pinetrie-Thread: ${twoName}\n`),
      `${JSON.stringify({ names: [...names.values()], bookmark: proposedFromRows()?.bookmark })}`,
    )
    const proposedChangeId = () =>
      jj(
        project,
        "log",
        "--no-graph",
        "-r",
        proposedBookmarkFor(two?.name),
        "-T",
        "change_id",
      )
    const firstChange = await proposedChangeId()
    /** Proposed changes' descriptions, oldest first, each run of repeats once. */
    const descriptionsOf = async (change: string) =>
      (
        await jj(
          project,
          "evolog",
          "--no-graph",
          "-r",
          change,
          "-T",
          'commit.description().first_line() ++ "\n"',
        )
      )
        .split("\n")
        .filter(l => l !== "" && !l.startsWith("pinetrie-proposed-"))
        .reverse()
        .filter((l, i, all) => l !== all[i - 1])
    // You change the same line, commit, publish it, and keep editing: the
    // proposed changes are rebuilt on accepted work and shows the conflict
    // before you accept it. Publishing needs a main to move: it is set at the
    // project's first commit.
    await jj(
      project,
      "bookmark",
      "create",
      "main",
      "-r",
      "roots(::pinetrie-accepted ~ root())",
    )
    writeFileSync(path.join(project, "shared.txt"), "one\ntwo (you)\nthree\n")
    await jj(project, "commit", "-m", "you edit line two")
    const landed = await wu.actOnAccepted("publish")
    writeFileSync(path.join(project, "still-editing.txt"), "wip\n")
    const conflicted = await waitFor(
      () => proposedFromRows()?.conflicts.includes("shared.txt") === true,
      30_000,
    )
    check(
      "the proposed changes are rebuilt on accepted work when you publish your commit, and says it conflicts with it",
      landed.kind === "accepted-moved" && conflicted >= 0,
      `${JSON.stringify({ landed, conflicts: proposedFromRows()?.conflicts })}`,
    )
    // You reword accepted work's commit under the proposed changes, which is
    // immutable until you say otherwise: jj rebases the proposed changes, not
    // the host, whose next trigger plans `none` and writes nothing to your
    // repo. The record's `commits` names the proposed changes as it is now,
    // which is what a review reads. The first line stays, for the acceptance
    // below. Publishing moved every open proposed changes: their writes are
    // done first.
    await wh.quiet()
    const commitsBefore = JSON.stringify(proposedFromRows()?.commits)
    /** Who made the proposed changes' newest version: an operation's user. */
    const newestBy = () =>
      jj(
        project,
        "evolog",
        "--no-graph",
        "-n",
        "1",
        "-r",
        proposedBookmarkFor(two?.name),
        "-T",
        'if(operation, operation.user(), "")',
      )
    await jj(
      project,
      "describe",
      "--ignore-immutable",
      "-r",
      "pinetrie-accepted",
      "-m",
      "you edit line two\n\nreworded",
    )
    const proposedNow = () =>
      jj(
        project,
        "log",
        "--no-graph",
        "-r",
        proposedBookmarkFor(two?.name),
        "-T",
        "commit_id",
      )
    const followed = await waitFor(
      async () =>
        JSON.stringify(proposedFromRows()?.commits) ===
        JSON.stringify([await proposedNow()]),
      30_000,
    )
    await wh.quiet()
    check(
      "the proposed changes' record names its commit as it is now, after jj rebased it under the host, and the host wrote nothing",
      followed >= 0 &&
        commitsBefore !== JSON.stringify(proposedFromRows()?.commits) &&
        !(await newestBy()).startsWith(`${HOST_OPERATOR}@`) &&
        proposedFromRows()?.edited === false,
      `${JSON.stringify({ before: commitsBefore, commits: proposedFromRows()?.commits, now: await proposedNow(), by: await newestBy(), edited: proposedFromRows()?.edited })}`,
    )
    // The record is the page's cache: lost, the next trigger, a jj operation of
    // yours that the proposed changes depend on (a WIP bookmark, so everything
    // is refreshed), writes it again from the repo, and the proposed changes
    // are the same commit, not built anew.
    const lostAt = await proposedNow()
    if (two !== undefined)
      await wh.records.writeValues([deleteRecord(PROPOSED_CHANGES, two.name)])
    const poke = `${DEFAULT_REPO.wipPrefix}e2e-poke`
    await jj(project, "bookmark", "create", poke, "-r", "@-")
    const rewritten = await waitFor(
      () =>
        JSON.stringify(proposedFromRows()?.commits) ===
        JSON.stringify([lostAt]),
      30_000,
    )
    await wh.quiet()
    await jj(project, "bookmark", "delete", poke)
    check(
      "a lost record changes nothing: the next trigger writes it again, and the proposed changes keep its change id",
      rewritten >= 0 &&
        (await proposedNow()) === lostAt &&
        (await proposedChangeId()) === firstChange,
      `${JSON.stringify({ lostAt, now: await proposedNow(), record: proposedFromRows()?.commits })}`,
    )
    // Catch it up: accepted work merged into the lane, and the
    // agent resolves the conflict, told what the card asked.
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
    const intent = "keep both sides"
    /** The newest land message on the thread's path: a resolution's prompt. */
    const landOf = (): EntryId | null => {
      if (two === undefined) return null
      const index = tree()
      return (
        ancestry(index, laneTip(two.name)).path.find(
          id => index.entries[id]?.message?.role === "land",
        ) ?? null
      )
    }
    const landBefore = landOf()
    if (two !== undefined)
      await bringUpToDate(wu, two.name, laneTip(two.name), intent)
    await waitFor(() => {
      const land = landOf()
      return land !== null && land !== landBefore
    }, 60_000)
    await idle()
    const landing = landOf()
    const landMessage = projectTranscript(tree(), landing).at(-1)
    const clean = await waitFor(
      () =>
        proposedFromRows()?.conflicts.length === 0 &&
        proposedFromRows()?.files.includes("shared.txt") === true,
      30_000,
    )
    // What the model read: the land message's content, not its one line.
    const stored =
      landing === null
        ? { present: false as const }
        : entryMessageIn(wh, landing)
    const landPrompt = stored.present
      ? (stored.message as { content?: unknown }).content
      : undefined
    // A resolution ends as any run, and this one asked nothing: no ask
    // about a conflict names any run of the lane.
    const askedIn =
      two === undefined
        ? null
        : (readConflictAsks(wh.session).get(two.name)?.run ?? null)
    check(
      "a card that brings the thread up to date runs the resolution when it conflicts, with the card's text, and the proposed changes come back clean",
      landMessage?.text.includes("1 file conflicts") === true &&
        typeof landPrompt === "string" &&
        landPrompt.endsWith(intent) &&
        askedIn === null &&
        clean >= 0,
      `${JSON.stringify({ landing, askedIn, clean })}`,
    )
    // The resolution moved the lane: the proposed changes followed it in place,
    // back to a work in progress while the run went on, then described again.
    await wh.quiet()
    const unfinished = `WIP (${twoName}): lane two: who are you?`
    const history = await descriptionsOf(firstChange)
    // The update's merge reaches your repo before the resolution runs, so it
    // is followed, and described, on its own: at least two rounds.
    check(
      "a run that moves the lane keeps the proposed changes' change id; it is a WIP line until each run ends",
      (await proposedChangeId()) === firstChange &&
        history.length >= 4 &&
        history.every(
          (d, i) =>
            d === (i % 2 === 0 ? unfinished : "proposed changes: scripted"),
        ) &&
        history.length % 2 === 0,
      `${JSON.stringify(history)}`,
    )
    // Accept: accepted work moves forward to the proposed changes, which stays
    // one commit on your landed one; your working copy is untouched.
    const atBefore = await jj(
      project,
      "log",
      "--no-graph",
      "-r",
      "@",
      "-T",
      "commit_id",
    )
    const accepted =
      two === undefined
        ? null
        : await wu.proposed(two.name, "accept", "pinetrie-accepted")
    const acceptedLog = await jj(
      project,
      "log",
      "--no-graph",
      "-r",
      "pinetrie-accepted | pinetrie-accepted-",
      "-T",
      'description.first_line() ++ "\n"',
    )
    check(
      "accepting the proposed changes move accepted work to it, on your landed commit; your working copy is untouched",
      accepted?.kind === "accepted" &&
        acceptedLog === "proposed changes: scripted\nyou edit line two\n" &&
        (await jj(
          project,
          "log",
          "--no-graph",
          "-r",
          "@",
          "-T",
          "commit_id",
        )) === atBefore &&
        readFileSync(path.join(project, "shared.txt"), "utf8") ===
          "one\ntwo (you)\nthree\n" &&
        readFileSync(path.join(project, "still-editing.txt"), "utf8") ===
          "wip\n",
      `${JSON.stringify(accepted)}, line: ${acceptedLog}`,
    )
    // The next turn's proposed changes hold only what came after.
    script.use([
      { tool: "bash", args: { command: "echo after > after.txt" } },
      { text: "more" },
    ])
    await untilSent(
      wh,
      await wu.send(
        "one more",
        at(two === undefined ? null : laneTip(two.name)),
        {
          thread: two?.name,
        },
      ),
      180_000,
    )
    await wh.quiet()
    // That they start above what was accepted is `repo-proposed.test.ts`'s, on real jj.
    await waitFor(
      () =>
        proposedFromRows()?.acceptedAs === null &&
        JSON.stringify(proposedFromRows()?.files) ===
          JSON.stringify(["after.txt"]),
      30_000,
    )
    // A clean update: a fact in the thread, then the card's text, sent. Your
    // work goes in accepted work first: a publish catches it up with what you
    // accepted, as you, after accepted work's record previews it, then accepts it
    // and moves main.
    writeFileSync(path.join(project, "yours.txt"), "yours\n")
    await jj(project, "commit", "-m", "you add yours.txt")
    const previewed = await waitFor(
      () =>
        (readJjAccepted(wh.session)?.workingCopy.getLatest ?? null) !== null,
      30_000,
    )
    const preview = readJjAccepted(wh.session)?.workingCopy.getLatest
    const unpublished = readJjAccepted(wh.session)?.published.behind ?? 0
    const published = await wu.actOnAccepted("publish")
    /** Who ran the newest rebase in your op log: the catch-up. */
    const upToDateBy =
      (
        await jj(
          project,
          "op",
          "log",
          "--no-graph",
          "-T",
          'description.first_line() ++ "\t" ++ user ++ "\n"',
        )
      )
        .split("\n")
        .find(l => l.startsWith("rebase"))
        ?.split("\t")[1] ?? ""
    const commitAt = (rev: string) =>
      jj(project, "log", "--no-graph", "-r", rev, "-T", "commit_id")
    check(
      "publish previews catching the working copy up, then rebases your work onto accepted work as you, and accepts it",
      previewed >= 0 &&
        preview?.conflicts.length === 0 &&
        published.kind === "accepted-moved" &&
        (await commitAt("pinetrie-accepted")) === (await commitAt("@-")) &&
        existsSync(path.join(project, "yours.txt")) &&
        upToDateBy !== "" &&
        !upToDateBy.startsWith(HOST_OPERATOR),
      `${JSON.stringify({ preview, published, upToDateBy })}`,
    )
    const upToDate = await waitFor(
      () => readJjAccepted(wh.session)?.published.behind === 0,
      30_000,
    )
    check(
      "publish moves main forward to accepted work, and nothing is left unpublished",
      unpublished > 0 &&
        upToDate >= 0 &&
        (await commitAt("main")) === (await commitAt("pinetrie-accepted")),
      `${JSON.stringify({ unpublished, line: readJjAccepted(wh.session)?.published })}`,
    )
    script.use([{ text: "it fits" }])
    if (two !== undefined)
      await bringUpToDate(
        wu,
        two.name,
        laneTip(two.name),
        "check yours still fits",
      )
    await waitFor(() => idOf("it fits") !== null, 60_000)
    await idle()
    const afterUpdate = projectTranscript(
      tree(),
      two === undefined ? null : laneTip(two.name),
    )
      .slice(-3)
      .map(m => `${m.role}:${m.text}`)
    check(
      "a card that brings the thread up to date writes the update in the thread, then sends its text",
      afterUpdate[0]?.startsWith("update:") === true &&
        afterUpdate[1] === "person:check yours still fits" &&
        afterUpdate[2] === "assistant:it fits",
      `${JSON.stringify(afterUpdate)}`,
    )
    // Split into a stack: the agent builds it in the lane; the host checks it
    // against the tip and makes it the proposed changes. Squash brings it back
    // to one.
    await wh.quiet()
    const lane2 = two?.name
    const laneTipCommit =
      lane2 === undefined
        ? ""
        : await jj(
            project,
            "log",
            "--no-graph",
            "-r",
            `tip@pinetrie-${lane2}`,
            "-T",
            "commit_id",
          )
    // Where the host starts the proposed changes, as it computes it.
    const tipCommit = commitId(laneTipCommit)
    // Your own reads, as you would run them: never snapshotting the working copy.
    const repo: Runner = args =>
      run("jj", ["-R", project, "--ignore-working-copy", ...args])
    const base = await laneBase(repo, tipCommit, DEFAULT_REPO)
    const read =
      base === null || lane2 === undefined
        ? null
        : await startOfProposed(repo, {
            tip: tipCommit,
            base,
            repoConfig: DEFAULT_REPO,
            lane: lane2,
          })
    const start = read?.kind === "known" ? read.start.join(" ") : ""
    script.use([
      {
        tool: "bash",
        args: {
          command: `jj new ${start} -m s && jj restore --from ${laneTipCommit} 'root:"after.txt"' && jj commit -m 'stack 1: after.txt' && jj restore --from ${laneTipCommit} && jj commit -m 'stack 2: the rest' && jj bookmark set pinetrie/${lane2}-stack -r @-`,
        },
      },
      { text: "split" },
    ])
    // A split is a card's command, queued as the button queues it.
    const split =
      lane2 === undefined
        ? null
        : await queueCommand(wu, lane2, laneTip(lane2), "", "split")
    await idle()
    const stacked = await waitFor(() => proposedFromRows()?.size === 2, 30_000)
    const squashed =
      stacked >= 0 && lane2 !== undefined
        ? await wu.proposed(lane2, "squash")
        : null
    await wh.quiet()
    check(
      "split into a stack: the agent's stack becomes the proposed changes, and squash makes it one again",
      split !== null &&
        stacked >= 0 &&
        squashed?.kind === "proposed" &&
        proposedFromRows()?.size === 1,
      `${JSON.stringify({ split, size: proposedFromRows()?.size })}`,
    )

    // A new root thread starts at accepted work: what you landed, not what you
    // committed and have not landed, nor your working copy.
    writeFileSync(path.join(project, "unlanded.txt"), "not landed\n")
    const aheadBefore = readJjAccepted(wh.session)?.workingCopy.ahead ?? 0
    await jj(project, "commit", "-m", "you add unlanded.txt")
    // The host has seen your commit (its line record counts it), so its
    // reads, pinned to the head it observed, have it too.
    await waitFor(
      () => (readJjAccepted(wh.session)?.workingCopy.ahead ?? 0) > aheadBefore,
      10_000,
    )
    writeFileSync(path.join(project, "unsaved.txt"), "not committed\n")
    script.use([
      {
        tool: "bash",
        args: { command: "cat yours.txt unlanded.txt unsaved.txt 2>&1" },
      },
      { text: "seen" },
    ])
    await untilSent(
      wh,
      await wu.send("read my files", ROOT, START_AGENT),
      180_000,
    )
    await wh.quiet()
    const seenUnsaved = toolResults(laneWith("read my files")?.name)
    check(
      "a new root thread starts at accepted work: it has what you landed, and not what you have not",
      seenUnsaved.some(
        t =>
          t.includes("yours") &&
          !t.includes("not landed") &&
          !t.includes("not committed"),
      ) &&
        (await jj(
          project,
          "log",
          "--no-graph",
          "-r",
          "divergent()",
          "-T",
          "commit_id",
        )) === "",
      `${seenUnsaved.join(" | ").slice(0, 80)}`,
    )

    // A branch's proposed changes hold its parent's work you lack, with its
    // own. Accepting the parent's shrinks it to its own, in place; accepting a
    // branch that holds all of its parent's withdraws the parent's.
    const proposedFor = (lane: ThreadId | undefined) =>
      lane === undefined
        ? undefined
        : readJjProposedByLane(wh.session).get(lane)
    const filesOf = (lane: ThreadId | undefined) =>
      JSON.stringify(proposedFor(lane)?.files)
    const changeOf = (lane: ThreadId | undefined) =>
      jj(
        project,
        "log",
        "--no-graph",
        "-r",
        proposedBookmarkFor(lane),
        "-T",
        "change_id",
      )
    const branchWriting = async (text: string, file: string) => {
      script.use([
        { tool: "bash", args: { command: `echo ${file} > ${file}` } },
        { text: "wrote" },
      ])
      await untilSent(
        wh,
        await wu.send(
          text,
          at(two === undefined ? null : laneTip(two.name)),
          BRANCH,
        ),
        180_000,
      )
      await wh.quiet()
      const lane = laneWith(text)?.name
      await waitFor(
        () => proposedFor(lane)?.files.includes(file) === true,
        30_000,
      )
      await wh.quiet()
      return lane
    }
    const branchA = await branchWriting("@agent branch a", "branch-a.txt")
    const aBefore = { files: filesOf(branchA), change: await changeOf(branchA) }
    await wu.proposed(lane2 ?? ("" as ThreadId), "accept", "pinetrie-accepted")
    const shrunk = await waitFor(
      () => filesOf(branchA) === JSON.stringify(["branch-a.txt"]),
      30_000,
    )
    await wh.quiet()
    check(
      "accepting a parent's proposed changes shrink its branch's proposed changes to its own work, in place",
      aBefore.files === JSON.stringify(["after.txt", "branch-a.txt"]) &&
        shrunk >= 0 &&
        (await changeOf(branchA)) === aBefore.change,
      `${JSON.stringify({ before: aBefore.files, after: filesOf(branchA) })}`,
    )
    script.use([
      { tool: "bash", args: { command: "echo more > more.txt" } },
      { text: "more" },
    ])
    await untilSent(
      wh,
      await wu.send(
        "still more",
        at(lane2 === undefined ? null : laneTip(lane2)),
        {
          thread: lane2,
        },
      ),
      180_000,
    )
    await wh.quiet()
    await waitFor(
      () => proposedFromRows()?.files.includes("more.txt") === true,
      30_000,
    )
    const branchB = await branchWriting("@agent branch b", "branch-b.txt")
    await wh.quiet()
    const acceptedB = await wu.proposed(
      branchB ?? ("" as ThreadId),
      "accept",
      "pinetrie-accepted",
    )
    const withdrawn = await waitFor(
      () => proposedFromRows() === undefined,
      30_000,
    )
    check(
      "accepting a branch that holds all its parent's work withdraws the parent's proposed changes: no record, no bookmark",
      acceptedB.kind === "accepted" &&
        withdrawn >= 0 &&
        (await jj(
          project,
          "log",
          "--no-graph",
          "-r",
          `bookmarks(exact:"${proposedBookmarkFor(lane2)}")`,
          "-T",
          "commit_id",
        )) === "",
      `${JSON.stringify({ acceptedB, parent: proposedFromRows()?.files })}`,
    )

    // ── 7. Archiving keeps each lane's newest snapshot; restoring runs again ─
    const rootOne =
      one?.tip === undefined || one.tip === null
        ? null
        : treeRoot(tree(), one.tip)
    const inRootOne = (records: ReturnType<typeof readRevisions>) =>
      [...records.values()].filter(
        r =>
          rootOne !== null &&
          treeRoot(tree(), r.entry) === rootOne &&
          r.snapshot !== null,
      )
    const before = inRootOne(heldRootRecords(wh, readRevisions))
    // The root's open proposed changes, by lane: archiving withdraws them, and
    // restoring builds them again.
    const proposedInRootOne = [...readJjProposedByLane(wh.session).values()]
      .filter(o => {
        const tip = laneTip(o.lane)
        return (
          o.acceptedAs === null &&
          rootOne !== null &&
          tip !== null &&
          treeRoot(tree(), tip) === rootOne
        )
      })
      .map(o => o.lane)
    const proposedBookmarks = () =>
      filterAsync(
        proposedInRootOne,
        async lane =>
          (await jj(
            project,
            "log",
            "--no-graph",
            "-r",
            `present(bookmarks(exact:"${proposedBookmarkFor(lane)}"))`,
            "-T",
            "commit_id",
          )) !== "",
      )
    if (rootOne !== null)
      await moveCanvasOnBoard(wu, entryId(rootOne), "archive")
    await wh.quiet()
    const there = await projectSnapshots(project)
    const kept = before.filter(
      r => r.snapshot !== null && there.has(r.snapshot),
    )
    const lanesInRoot = new Set(before.map(r => r.lane))
    const newestKept = [...lanesInRoot].every(lane => {
      const mine = before.filter(r => r.lane === lane)
      const newest = mine.sort((a, b) => (a.entry < b.entry ? 1 : -1))[0]
      return kept.some(k => k.entry === newest?.entry)
    })
    check(
      "archiving a root deletes its lanes' containers and all but each lane's newest snapshot",
      kept.length === lanesInRoot.size &&
        newestKept &&
        one !== undefined &&
        !(await containerExists(container(one.name))),
      `${before.length} → ${kept.length}`,
    )
    const left = await proposedBookmarks()
    check(
      "archiving a root withdraws its threads' proposed changes: no bookmark in your repo, no record",
      proposedInRootOne.length > 0 &&
        left.length === 0 &&
        proposedInRootOne.every(
          lane => !readJjProposedByLane(wh.session).has(lane),
        ),
      `${JSON.stringify({ proposed: proposedInRootOne, left })}`,
    )
    if (rootOne !== null) await moveCanvasOnBoard(wu, entryId(rootOne), "open")
    const rebuilt = await waitFor(
      async () =>
        proposedInRootOne.length > 0 &&
        (await proposedBookmarks()).length === proposedInRootOne.length &&
        proposedInRootOne.every(lane =>
          readJjProposedByLane(wh.session).has(lane),
        ),
      30_000,
    )
    check(
      "restoring it builds their proposed changes again",
      rebuilt >= 0,
      `${JSON.stringify({ proposed: proposedInRootOne, back: await proposedBookmarks() })}`,
    )
    script.use([
      { tool: "bash", args: { command: "cat shared.txt" } },
      { text: "back" },
    ])
    await untilSent(
      wh,
      await wu.send("still there?", at(tipOf("move on")), {
        thread: one?.name,
      }),
      180_000,
    )
    await wh.quiet()
    check(
      "after restoring, a lane runs again on its newest snapshot",
      toolResults(one?.name).at(-1)?.trim() === "parent-later",
    )

    // A lane that recorded turns, with neither a disk nor a snapshot left,
    // is retired (`planLaneStart`): its tools say so, and name what to do.
    if (two !== undefined) {
      await wh.quiet()
      await removeLane(project, two.name)
      for (const r of heldRootRecords(wh, readRevisions).values())
        if (r.lane === two.name && r.snapshot !== null)
          await deleteEntrySnapshot(project, r.snapshot)
    }
    script.use([
      { tool: "bash", args: { command: "echo still" } },
      { text: "retired" },
    ])
    await untilSent(
      wh,
      await wu.send("are you there?", at(two?.tip ?? null), {
        thread: two?.name,
      }),
      180_000,
    )
    await wh.quiet()
    check(
      "a lane with no disk and no snapshot is retired, and its tools say to branch from it",
      toolResults(two?.name)
        .at(-1)
        ?.includes("no disk and no snapshot to start from; branch from it") ===
        true,
      `${toolResults(two?.name).at(-1)?.slice(0, 60) ?? "none"}`,
    )

    // ── A lane's own pinetrie.json: it may give up a grant, never take one ─
    // Accepted work grants ssh. A lane's copy that drops it, and names a
    // variable accepted work does not, narrows at the lane's next run and
    // widens nothing; the write's reply says which is which.
    process.env.PINETRIE_E2E_WIDE = "granted only by acceptance"
    script.use([
      {
        tool: "write",
        args: {
          path: "pinetrie.json",
          content: JSON.stringify({
            lanes: { env: ["PINETRIE_E2E_WIDE"] },
            publish: { catchUp: true },
          }),
        },
      },
      { text: "changed" },
    ])
    await untilSent(
      wh,
      await wu.send("@agent change the lane config", ROOT, START_AGENT),
      180_000,
    )
    await wh.quiet()
    const configured = laneWith("@agent change the lane config")?.name
    const note = toolResults(configured).at(-1) ?? ""
    script.use([
      {
        tool: "bash",
        args: {
          command:
            'echo "ssh: $SSH_AUTH_SOCK"; echo "wide: $PINETRIE_E2E_WIDE"',
        },
      },
      { text: "looked" },
    ])
    await untilSent(
      wh,
      await wu.send(
        "@agent what are you granted now?",
        at(tipOf("@agent change the lane config")),
        { thread: configured },
      ),
      180_000,
    )
    await wh.quiet()
    const granted = toolResults(configured).at(-1) ?? ""
    check(
      "a lane's own pinetrie.json narrows its grants from its next run, and widens none until accepted",
      note.includes("gives up your ssh identity from its next run") &&
        note.includes("$PINETRIE_E2E_WIDE only once") &&
        granted.includes("ssh: \n") &&
        granted.includes("wide: \n"),
      JSON.stringify({ note, granted }),
    )
  } finally {
    // Whatever happened above: nothing of this run is left behind.
    rmSync(marker, { force: true })
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
    await cleanUp(wh.session, project)
  }
}
