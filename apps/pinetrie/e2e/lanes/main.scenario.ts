// e2e/lanes/main — one host with a scripted model over a throwaway project,
// whose threads' agents each work in a Linux container on a disk cloned from
// where they branched (ADR-0034).

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  ancestry,
  commitId,
  conflictAskedAt,
  type EntryId,
  entryId,
  HOST_OPERATOR,
  type LaneName,
  messageText,
  nearestRevision,
  projectTranscript,
  ROOT,
  rootOf,
} from "@pinetrie/core"
import { DEFAULT_REPO, laneBase, type Runner, run } from "@pinetrie/lanes"
import { scriptedModel } from "@pinetrie/pi"
import {
  readAccepted,
  readNames,
  readOffers,
  readPlaces,
  readProject,
  readRevisions,
} from "@pinetrie/reads"
import { startOfOffer } from "@pinetrie/repo"
import { deleteRecord, OFFER } from "@pinetrie/rules"
import { rowMessage } from "@pinetrie/schema"
import type { Checks } from "../checks.ts"
import {
  committedProject,
  containerProblem,
  entriesOf,
  entryMessageIn,
  idleNow,
  join,
  lanesOf,
  moveRootTo,
  rootRecordsOf,
  setUpAccepted,
  startSuiteHost,
  treeOf,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import {
  at,
  BRANCH,
  bringUpToDate,
  cleanUp,
  container,
  inLane,
  inLaneQuiet,
  jj,
  jjFails,
  queueCommand,
  START_AGENT,
  sh,
} from "./support.ts"

export const scenario: Scenario = {
  needs: containerProblem,
  run: ({ check }) => mainSection(check),
}

// ── the main section: one host, checks 1–8 ────────────────────────────
async function mainSection(check: Checks["check"]): Promise<void> {
  const home = homedir()
  const marker = path.join(home, `.pinetrie-e2e-marker-${process.pid}`)
  writeFileSync(marker, "visible only on the host\n")
  const project = committedProject("pinetrie-lanes-", {
    "shared.txt": "one\ntwo\nthree\n",
    ".gitignore": "node_modules/\n.vite/\n",
    "pinetrie.json": `${JSON.stringify({ lanes: { ssh: true }, publish: { catchUp: true } })}\n`,
  })
  const script = scriptedModel()
  const logs: string[] = []
  const wh = await startSuiteHost({
    model: { kind: "scripted", script },
    project: { dir: project, tools: true },
    log: m => {
      logs.push(m)
      if (process.env.PINETRIE_E2E_LOG === "1") console.log(m)
    },
  })
  const wu = await join(wh, "uma", "lanes")
  await wu.request({ kind: "name", name: "Uma" })
  const tree = () => treeOf(wh)
  const idle = async () => {
    await waitFor(() => idleNow(wh), 180_000)
    await wh.quiet()
  }
  const idOf = (text: string): EntryId | null => {
    const index = tree()
    return (
      Object.values(index.entries).find(
        e => projectTranscript(index, e.id).at(-1)?.text === text,
      )?.id ?? null
    )
  }
  /** The lane whose thread holds the message with `text`. */
  const laneWith = (text: string) => {
    const id = idOf(text)
    const index = tree()
    return lanesOf(wh, index, readPlaces(wh.places)).find(
      l => id !== null && ancestry(index, l.tip).path.includes(id),
    )
  }
  const tipOf = (text: string) => laneWith(text)?.tip ?? null
  const laneTip = (lane: LaneName) =>
    lanesOf(wh, tree(), readPlaces(wh.places)).find(l => l.name === lane)
      ?.tip ?? null
  /** Every tool result's text in a lane's thread, oldest first. */
  const toolResults = (lane: LaneName | undefined): string[] => {
    if (lane === undefined) return []
    const index = tree()
    const tip =
      lanesOf(wh, index, readPlaces(wh.places)).find(l => l.name === lane)
        ?.tip ?? null
    const onPath = new Set(ancestry(index, tip).path)
    return Object.values(entriesOf(wh))
      .filter(r => onPath.has(entryId(r.id)))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(r => rowMessage(r) as { role?: string })
      .filter(m => m.role === "toolResult")
      .map(m => messageText(m as never))
  }

  try {
    await waitFor(() => readProject(wh.session) !== null, 30_000)
    check(
      "the host finds container and gives threads lanes of their own",
      readProject(wh.session)?.kind === "lanes",
      `${JSON.stringify(readProject(wh.session))}`,
    )
    // Threads start at accepted work (ADR-0060): set it up at the
    // project's commit, as the footer's set up button does.
    await setUpAccepted(wh.session, wu)

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
        inLane(one.name, "cat who.txt").trim() === container(one.name) &&
        inLane(two.name, "cat who.txt").trim() === container(two.name) &&
        !existsSync(path.join(project, "who.txt")),
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
    check(
      "with ssh granted, the lane has SSH_AUTH_SOCK",
      /ssh: \S+/.test(bash ?? ""),
      `${bash?.match(/ssh: .*/)?.[0] ?? "none"}`,
    )

    // ── revisions: in the document, and in your repo by bundle ─────────────
    // Lane one's first run committed who.txt; its prompt and that message each
    // have a record with a snapshot, and your repo holds its history as a
    // remote bookmark (ADR-0038).
    const ofOne = [...rootRecordsOf(wh, readRevisions).values()].filter(
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
            `present(tip@pinetrie-${lane})`,
            "-T",
            "commit_id",
          ).trim()
    check(
      "each turn of a lane of its own records a snapshot, and your repo fetches its commits",
      ofOne.length >= 2 &&
        ofOne.every(r => r.snapshot !== null) &&
        ofOne.some(r => r.commit !== null && r.commit === bookmark(one?.name)),
      `${ofOne.length} records`,
    )
    check(
      "a lane's commits in your repo are immutable",
      bookmark(one?.name) !== "" &&
        jjFails(project, "describe", "-r", bookmark(one?.name), "-m", "x"),
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
    check(
      "a branch at a turn has that turn's tracked files, node_modules and .vite cache, byte for byte",
      looker !== undefined &&
        parentSums !== "" &&
        sums(looker.name).replace(/shared.txt.*/, "") ===
          parentSums.replace(/shared.txt.*/, "") &&
        sums(looker.name) === parentSums,
    )
    check(
      "a branch's writes never reach its parent, nor its parent's its",
      branch !== undefined &&
        one !== undefined &&
        inLane(branch.name, "cat shared.txt").trim() === "branch" &&
        inLane(one.name, "cat shared.txt").trim() === "parent-later",
    )
    // A branch of the branch.
    script.use([
      { tool: "bash", args: { command: "echo deeper >> shared.txt" } },
      { text: "deeper" },
    ])
    await wu.chat("@agent go deeper", at(idOf("branched")), BRANCH)
    await idle()
    const deeper = laneWith("@agent go deeper")
    check(
      "a branch of a branch starts from its parent's turn, and leaves it alone",
      deeper !== undefined &&
        branch !== undefined &&
        inLane(deeper.name, "cat shared.txt") === "branch\ndeeper\n" &&
        inLane(branch.name, "cat shared.txt") === "branch\n",
    )
    check(
      "your repo holds every lane's commits with no divergent change",
      jj(
        project,
        "log",
        "--no-graph",
        "-r",
        "divergent()",
        "-T",
        "commit_id",
      ).trim() === "",
    )

    // ── 8. A fork cannot rewrite what it inherited ─────────────────────────
    // The commit the branches forked at, which every one of them inherits.
    const inherited = nearestRevision(
      tree(),
      rootRecordsOf(wh, readRevisions),
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
    check(
      "rewriting an inherited commit in a fork is refused",
      inherited !== undefined &&
        inherited !== null &&
        rewrite.includes("immutable") &&
        !rewrite.includes("exit 0"),
      `${rewrite.split("\n")[0] ?? ""}`,
    )
    // The lane's config names a commit only its own repo has: any other repo
    // it reached would fail every jj command (S50).
    const scratch =
      deeper === undefined
        ? "no fork"
        : inLane(
            deeper.name,
            'cd /tmp && rm -rf scratch && mkdir scratch && cd scratch && jj git init && jj commit -m x 2>&1; echo "exit $?"',
          )
    check(
      "a jj repo outside the lane's own works in the lane",
      scratch.trim().endsWith("exit 0"),
      `${scratch.trim().split("\n").at(-1) ?? ""}`,
    )

    // ── An agent's own commit is the turn's revision (S56) ──────────────────────
    script.use([
      {
        tool: "bash",
        args: { command: "echo mine > mine.txt && jj commit -m mine 2>&1" },
      },
      { text: "committed it" },
    ])
    await wu.chat("commit it yourself", ROOT, START_AGENT)
    await idle()
    const committer = laneWith("commit it yourself")
    const committerOffer =
      committer === undefined
        ? undefined
        : readNames(wh.session).get(committer.name)
    const hasMine = () =>
      committerOffer !== undefined &&
      jj(
        project,
        "file",
        "list",
        "-r",
        // An empty revision set, before the offer is built, is no files.
        `latest(present(bookmarks(exact:"pinetrie-offer/${committerOffer}")) | root())`,
        'root:"mine.txt"',
      ).trim() !== ""
    check(
      "a commit the agent made itself reaches its thread's offer",
      (await waitFor(hasMine, 30_000)) >= 0,
    )
    script.use([{ text: "just looking" }])
    await wu.chat("@agent look at mine", at(idOf("committed it")), BRANCH)
    await idle()
    const atMine = laneWith("@agent look at mine")
    check(
      "a branch at the turn the agent committed in has its file",
      atMine !== undefined &&
        inLane(atMine.name, "cat mine.txt 2>&1").trim() === "mine",
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
    check(
      "a file the agent wrote is whole in a branch taken at the next turn",
      atOnce !== undefined &&
        inLane(atOnce.name, "sha256sum -c big.sum 2>&1").includes(
          "big.bin: OK",
        ),
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
    if (atOnce !== undefined)
      await wu.request({ kind: "stop", lane: atOnce.name })
    await idle()
    const left =
      atOnce === undefined
        ? "?"
        : inLane(
            atOnce.name,
            "ps -eo args | grep -c 'sleep 7[78]' || true",
          ).trim()
    check(
      "a bash timeout and an aborted run leave no process in the guest",
      left === "0",
      `${left} left`,
    )

    // ── 6. Offers: the thread's work as one commit you accept (ADR-0038) ─
    const offerOf = () =>
      two === undefined ? undefined : readOffers(wh.session).get(two.name)
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
    await wu.chat("edit line two", at(tipOf("lane two: who are you?")), {
      lane: two?.name,
    })
    await idle()
    const offered = await waitFor(
      () => offerOf()?.files.includes("shared.txt") === true,
      30_000,
    )
    await wh.quiet()
    check(
      "a turn's work is an offer in your repo, described, and its turns are not in your log",
      offered >= 0 &&
        offerOf()?.described === true &&
        !defaultLog().includes("edit line two") &&
        defaultLog().includes("offer: scripted"),
      `${JSON.stringify({ files: offerOf()?.files, described: offerOf()?.described, log: defaultLog().split("\n").slice(0, 4) })}`,
    )
    // Every lane has a name, two words, and no two alike; the offer's
    // bookmark and its message's trailer carry it (ADR-0039).
    const names = readNames(wh.session)
    const twoName = two === undefined ? undefined : names.get(two.name)
    const offerBookmarkOf = (lane: LaneName | undefined) =>
      lane === undefined
        ? ""
        : `pinetrie-offer/${readNames(wh.session).get(lane) ?? ""}`
    const allNamed = lanesOf(wh, tree(), readPlaces(wh.places)).every(l =>
      names.has(l.name),
    )
    check(
      "every lane has a two-word name, unique; the offer's bookmark and trailer carry it",
      allNamed &&
        [...names.values()].every(n => /^[a-z]+-[a-z]+$/.test(n)) &&
        new Set(names.values()).size === names.size &&
        offerOf()?.bookmark === offerBookmarkOf(two?.name) &&
        jj(
          project,
          "log",
          "--no-graph",
          "-r",
          offerBookmarkOf(two?.name),
          "-T",
          "description",
        ).includes(`Pinetrie-Thread: ${twoName}\n`),
      `${JSON.stringify({ names: [...names.values()], bookmark: offerOf()?.bookmark })}`,
    )
    const offerChange = () =>
      jj(
        project,
        "log",
        "--no-graph",
        "-r",
        offerBookmarkOf(two?.name),
        "-T",
        "change_id",
      )
    const firstChange = offerChange()
    /** An offer's descriptions, oldest first, each run of repeats once. */
    const descriptionsOf = (change: string) =>
      jj(
        project,
        "evolog",
        "--no-graph",
        "-r",
        change,
        "-T",
        'commit.description().first_line() ++ "\n"',
      )
        .split("\n")
        .filter(l => l !== "" && !l.startsWith("pinetrie-offer-"))
        .reverse()
        .filter((l, i, all) => l !== all[i - 1])
    // You change the same line, commit, publish it, and keep editing: the
    // offer is rebuilt on accepted work and shows the conflict before you
    // accept it (ADR-0060, ADR-0090). Publishing needs a main to move: it is
    // set at the project's first commit.
    jj(
      project,
      "bookmark",
      "create",
      "main",
      "-r",
      "roots(::pinetrie-accepted ~ root())",
    )
    writeFileSync(path.join(project, "shared.txt"), "one\ntwo (you)\nthree\n")
    jj(project, "commit", "-m", "you edit line two")
    const landed = await wu.actOnAccepted("publish")
    writeFileSync(path.join(project, "still-editing.txt"), "wip\n")
    const conflicted = await waitFor(
      () => offerOf()?.conflicts.includes("shared.txt") === true,
      30_000,
    )
    check(
      "the offer is rebuilt on accepted work when you publish your commit, and says it conflicts with it",
      landed.kind === "accepted-moved" && conflicted >= 0,
      `${JSON.stringify({ landed, conflicts: offerOf()?.conflicts })}`,
    )
    // You reword accepted work's commit under the offer, which is immutable
    // until you say otherwise: jj rebases the offer, not the host, whose next
    // trigger plans `none` and writes nothing to your repo. The record's
    // `commits` names the offer as it is now, which is what a review reads
    // (ADR-0047). The first line stays, for the acceptance below.
    // Publishing moved every open offer: their writes are done first.
    await wh.quiet()
    const commitsBefore = JSON.stringify(offerOf()?.commits)
    /** Who made the offer's newest version: an operation's user. */
    const newestBy = () =>
      jj(
        project,
        "evolog",
        "--no-graph",
        "-n",
        "1",
        "-r",
        offerBookmarkOf(two?.name),
        "-T",
        'if(operation, operation.user(), "")',
      )
    jj(
      project,
      "describe",
      "--ignore-immutable",
      "-r",
      "pinetrie-accepted",
      "-m",
      "you edit line two\n\nreworded",
    )
    const offerNow = () =>
      jj(
        project,
        "log",
        "--no-graph",
        "-r",
        offerBookmarkOf(two?.name),
        "-T",
        "commit_id",
      )
    const followed = await waitFor(
      () => JSON.stringify(offerOf()?.commits) === JSON.stringify([offerNow()]),
      30_000,
    )
    await wh.quiet()
    check(
      "the offer's record names its commit as it is now, after jj rebased it under the host, and the host wrote nothing",
      followed >= 0 &&
        commitsBefore !== JSON.stringify(offerOf()?.commits) &&
        !newestBy().startsWith(`${HOST_OPERATOR}@`) &&
        offerOf()?.edited === false,
      `${JSON.stringify({ before: commitsBefore, commits: offerOf()?.commits, now: offerNow(), by: newestBy(), edited: offerOf()?.edited })}`,
    )
    // The record is the page's cache (ADR-0060): lost, the next trigger, a
    // jj operation of yours that the offers depend on (a WIP bookmark, so
    // everything is refreshed, ADR-0065), writes it again from the repo, and
    // the offer is the same commit, not built anew.
    const lostAt = offerNow()
    if (two !== undefined)
      await wh.records.writeValues([deleteRecord(OFFER, two.name)])
    const poke = `${DEFAULT_REPO.wipPrefix}e2e-poke`
    jj(project, "bookmark", "create", poke, "-r", "@-")
    const rewritten = await waitFor(
      () => JSON.stringify(offerOf()?.commits) === JSON.stringify([lostAt]),
      30_000,
    )
    await wh.quiet()
    jj(project, "bookmark", "delete", poke)
    check(
      "a lost record changes nothing: the next trigger writes it again, and the offer keeps its change id",
      rewritten >= 0 && offerNow() === lostAt && offerChange() === firstChange,
      `${JSON.stringify({ lostAt, now: offerNow(), record: offerOf()?.commits })}`,
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
      bringUpToDate(wu, two.name, laneTip(two.name), intent)
    await waitFor(() => {
      const land = landOf()
      return land !== null && land !== landBefore
    }, 60_000)
    await idle()
    const landing = landOf()
    const landMessage = projectTranscript(tree(), landing).at(-1)
    const clean = await waitFor(
      () =>
        offerOf()?.conflicts.length === 0 &&
        offerOf()?.files.includes("shared.txt") === true,
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
    // A resolution ends as any run (ADR-0080): no ask about a conflict.
    const askedAt =
      two === undefined ? null : conflictAskedAt(tree(), laneTip(two.name))
    check(
      "a card that brings the thread up to date runs the resolution when it conflicts, with the card's text, and the offer comes back clean",
      landMessage?.text.includes("1 file conflicts") === true &&
        typeof landPrompt === "string" &&
        landPrompt.endsWith(intent) &&
        askedAt === null &&
        clean >= 0,
      `${JSON.stringify({ landing, askedAt, clean })}`,
    )
    // The resolution moved the lane: the offer followed it in place, back to
    // a work in progress while the run went on, then described again.
    await wh.quiet()
    const wip = `WIP (${twoName}): lane two: who are you?`
    const history = descriptionsOf(firstChange)
    // The update's merge reaches your repo before the resolution runs, so it
    // is followed, and described, on its own: at least two rounds.
    check(
      "a run that moves the lane keeps the offer's change id; it is a WIP line until each run ends",
      offerChange() === firstChange &&
        history.length >= 4 &&
        history.every(
          (d, i) => d === (i % 2 === 0 ? wip : "offer: scripted"),
        ) &&
        history.length % 2 === 0,
      `${JSON.stringify(history)}`,
    )
    // Accept: accepted work moves forward to the offer, which stays one commit on
    // your landed one; your working copy is untouched (ADR-0060).
    const atBefore = jj(
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
        : await wu.offer(two.name, "accept", "pinetrie-accepted")
    const acceptedLog = jj(
      project,
      "log",
      "--no-graph",
      "-r",
      "pinetrie-accepted | pinetrie-accepted-",
      "-T",
      'description.first_line() ++ "\n"',
    )
    check(
      "accepting the offer moves accepted work to it, on your landed commit; your working copy is untouched",
      accepted?.kind === "accepted" &&
        acceptedLog === "offer: scripted\nyou edit line two\n" &&
        jj(project, "log", "--no-graph", "-r", "@", "-T", "commit_id") ===
          atBefore &&
        readFileSync(path.join(project, "shared.txt"), "utf8") ===
          "one\ntwo (you)\nthree\n" &&
        readFileSync(path.join(project, "still-editing.txt"), "utf8") ===
          "wip\n",
      `${JSON.stringify(accepted)}, line: ${acceptedLog}`,
    )
    // The next turn's offer holds only what came after.
    script.use([
      { tool: "bash", args: { command: "echo after > after.txt" } },
      { text: "more" },
    ])
    await wu.chat(
      "one more",
      at(two === undefined ? null : laneTip(two.name)),
      {
        lane: two?.name,
      },
    )
    await idle()
    const next = await waitFor(
      () =>
        offerOf()?.acceptedAs === null &&
        JSON.stringify(offerOf()?.files) === JSON.stringify(["after.txt"]),
      30_000,
    )
    check(
      "after an acceptance, the next offer holds only the new work",
      next >= 0,
      `${JSON.stringify(offerOf()?.files)}`,
    )
    // A clean update: a fact in the thread, then the card's text, sent. Your
    // work goes in accepted work first: a publish catches it up with what you
    // accepted, as you, after accepted work's record previews it, then accepts it
    // and moves main (ADR-0090).
    writeFileSync(path.join(project, "yours.txt"), "yours\n")
    jj(project, "commit", "-m", "you add yours.txt")
    const previewed = await waitFor(
      () => (readAccepted(wh.session)?.yours.catchUp ?? null) !== null,
      30_000,
    )
    const preview = readAccepted(wh.session)?.yours.catchUp
    const unpublished = readAccepted(wh.session)?.published.behind ?? 0
    const published = await wu.actOnAccepted("publish")
    /** Who ran the newest rebase in your op log: the catch-up. */
    const caughtUpBy =
      jj(
        project,
        "op",
        "log",
        "--no-graph",
        "-T",
        'description.first_line() ++ "\t" ++ user ++ "\n"',
      )
        .split("\n")
        .find(l => l.startsWith("rebase"))
        ?.split("\t")[1] ?? ""
    const commitAt = (rev: string) =>
      jj(project, "log", "--no-graph", "-r", rev, "-T", "commit_id")
    check(
      "publish previews catching your files up, then rebases your work onto accepted work as you, and accepts it",
      previewed >= 0 &&
        preview?.conflicts.length === 0 &&
        published.kind === "accepted-moved" &&
        commitAt("pinetrie-accepted") === commitAt("@-") &&
        existsSync(path.join(project, "yours.txt")) &&
        caughtUpBy !== "" &&
        !caughtUpBy.startsWith(HOST_OPERATOR),
      `${JSON.stringify({ preview, published, caughtUpBy })}`,
    )
    const caughtUp = await waitFor(
      () => readAccepted(wh.session)?.published.behind === 0,
      30_000,
    )
    check(
      "publish moves main forward to accepted work, and nothing is left unpublished",
      unpublished > 0 &&
        caughtUp >= 0 &&
        commitAt("main") === commitAt("pinetrie-accepted"),
      `${JSON.stringify({ unpublished, line: readAccepted(wh.session)?.published })}`,
    )
    script.use([{ text: "it fits" }])
    if (two !== undefined)
      bringUpToDate(wu, two.name, laneTip(two.name), "check yours still fits")
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
        afterUpdate[1] === "chat:check yours still fits" &&
        afterUpdate[2] === "assistant:it fits",
      `${JSON.stringify(afterUpdate)}`,
    )
    // Split into a stack: the agent builds it in the lane; the host checks it
    // against the tip and makes it the offer. Squash brings it back to one.
    await wh.quiet()
    const lane2 = two?.name
    const laneTipCommit =
      lane2 === undefined
        ? ""
        : jj(
            project,
            "log",
            "--no-graph",
            "-r",
            `tip@pinetrie-${lane2}`,
            "-T",
            "commit_id",
          )
    // Where the host starts the offer, as it computes it.
    const tipCommit = commitId(laneTipCommit)
    // Your own reads, as you would run them: never snapshotting your files.
    const yours: Runner = args =>
      run("jj", ["-R", project, "--ignore-working-copy", ...args])
    const base = await laneBase(yours, tipCommit, DEFAULT_REPO)
    const read =
      base === null || lane2 === undefined
        ? null
        : await startOfOffer(yours, {
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
    // A split is a card's command, queued as the button queues it (ADR-0080).
    const split =
      lane2 === undefined
        ? null
        : queueCommand(wu, lane2, laneTip(lane2), "", "split")
    await idle()
    const stacked = await waitFor(() => offerOf()?.size === 2, 30_000)
    const squashed =
      stacked >= 0 && lane2 !== undefined
        ? await wu.offer(lane2, "squash")
        : null
    await wh.quiet()
    check(
      "split into a stack: the agent's stack becomes the offer, and squash makes it one again",
      split !== null &&
        stacked >= 0 &&
        squashed?.kind === "offered" &&
        offerOf()?.size === 1,
      `${JSON.stringify({ split, size: offerOf()?.size })}`,
    )

    // A new root thread starts at accepted work: what you landed, not what you
    // committed and have not landed, nor your working copy (ADR-0060).
    writeFileSync(path.join(project, "unlanded.txt"), "not landed\n")
    const aheadBefore = readAccepted(wh.session)?.yours.ahead ?? 0
    jj(project, "commit", "-m", "you add unlanded.txt")
    // The host has seen your commit (its line record counts it), so its
    // reads, pinned to the head it observed, have it too (ADR-0065).
    await waitFor(
      () => (readAccepted(wh.session)?.yours.ahead ?? 0) > aheadBefore,
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
    await wu.chat("read my files", ROOT, START_AGENT)
    await idle()
    const seenUnsaved = toolResults(laneWith("read my files")?.name)
    check(
      "a new root thread starts at accepted work: it has what you landed, and not what you have not",
      seenUnsaved.some(
        t =>
          t.includes("yours") &&
          !t.includes("not landed") &&
          !t.includes("not committed"),
      ) &&
        jj(
          project,
          "log",
          "--no-graph",
          "-r",
          "divergent()",
          "-T",
          "commit_id",
        ) === "",
      `${seenUnsaved.join(" | ").slice(0, 80)}`,
    )

    // A branch's offer holds its parent's work you lack, with its own.
    // Accepting the parent's shrinks it to its own, in place; accepting a
    // branch that holds all of its parent's withdraws the parent's
    // (ADR-0039).
    const offerFor = (lane: LaneName | undefined) =>
      lane === undefined ? undefined : readOffers(wh.session).get(lane)
    const filesOf = (lane: LaneName | undefined) =>
      JSON.stringify(offerFor(lane)?.files)
    const changeOf = (lane: LaneName | undefined) =>
      jj(
        project,
        "log",
        "--no-graph",
        "-r",
        offerBookmarkOf(lane),
        "-T",
        "change_id",
      )
    const branchWriting = async (text: string, file: string) => {
      script.use([
        { tool: "bash", args: { command: `echo ${file} > ${file}` } },
        { text: "wrote" },
      ])
      await wu.chat(
        text,
        at(two === undefined ? null : laneTip(two.name)),
        BRANCH,
      )
      await idle()
      const lane = laneWith(text)?.name
      await waitFor(() => offerFor(lane)?.files.includes(file) === true, 30_000)
      await wh.quiet()
      return lane
    }
    const branchA = await branchWriting("@agent branch a", "branch-a.txt")
    const aBefore = { files: filesOf(branchA), change: changeOf(branchA) }
    await wu.offer(lane2 ?? ("" as LaneName), "accept", "pinetrie-accepted")
    const shrunk = await waitFor(
      () => filesOf(branchA) === JSON.stringify(["branch-a.txt"]),
      30_000,
    )
    await wh.quiet()
    check(
      "accepting a parent's offer shrinks its branch's offer to its own work, in place",
      aBefore.files === JSON.stringify(["after.txt", "branch-a.txt"]) &&
        shrunk >= 0 &&
        changeOf(branchA) === aBefore.change,
      `${JSON.stringify({ before: aBefore.files, after: filesOf(branchA) })}`,
    )
    script.use([
      { tool: "bash", args: { command: "echo more > more.txt" } },
      { text: "more" },
    ])
    await wu.chat(
      "still more",
      at(lane2 === undefined ? null : laneTip(lane2)),
      {
        lane: lane2,
      },
    )
    await idle()
    await waitFor(() => offerOf()?.files.includes("more.txt") === true, 30_000)
    const branchB = await branchWriting("@agent branch b", "branch-b.txt")
    await wh.quiet()
    const acceptedB = await wu.offer(
      branchB ?? ("" as LaneName),
      "accept",
      "pinetrie-accepted",
    )
    const withdrawn = await waitFor(() => offerOf() === undefined, 30_000)
    check(
      "accepting a branch that holds all its parent's work withdraws the parent's offer: no record, no bookmark",
      acceptedB.kind === "accepted" &&
        withdrawn >= 0 &&
        jj(
          project,
          "log",
          "--no-graph",
          "-r",
          `bookmarks(exact:"${offerBookmarkOf(lane2)}")`,
          "-T",
          "commit_id",
        ) === "",
      `${JSON.stringify({ acceptedB, parent: offerOf()?.files })}`,
    )

    // ── 7. Archiving keeps each lane's newest snapshot; restoring runs again ─
    const snapshots = path.join(project, ".pinetrie", "snapshots")
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
    const before = inRootOne(rootRecordsOf(wh, readRevisions))
    // The root's open offers, by lane: archiving withdraws them, and
    // restoring builds them again.
    const offeredInRootOne = [...readOffers(wh.session).values()]
      .filter(o => {
        const tip = laneTip(o.lane)
        return (
          o.acceptedAs === null &&
          rootOne !== null &&
          tip !== null &&
          rootOf(tree(), tip) === rootOne
        )
      })
      .map(o => o.lane)
    const offerBookmarks = () =>
      offeredInRootOne.filter(
        lane =>
          jj(
            project,
            "log",
            "--no-graph",
            "-r",
            `present(bookmarks(exact:"${offerBookmarkOf(lane)}"))`,
            "-T",
            "commit_id",
          ) !== "",
      )
    if (rootOne !== null) await moveRootTo(wu, entryId(rootOne), "closed")
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
    check(
      "archiving a root deletes its lanes' containers and all but each lane's newest snapshot",
      kept.length === lanesInRoot.size &&
        newestKept &&
        one !== undefined &&
        !sh(`container list -a --quiet`).includes(container(one.name)),
      `${before.length} → ${kept.length}`,
    )
    check(
      "archiving a root withdraws its threads' offers: no bookmark in your repo, no record",
      offeredInRootOne.length > 0 &&
        offerBookmarks().length === 0 &&
        offeredInRootOne.every(lane => !readOffers(wh.session).has(lane)),
      `${JSON.stringify({ offered: offeredInRootOne, left: offerBookmarks() })}`,
    )
    if (rootOne !== null) await moveRootTo(wu, entryId(rootOne), "open")
    const rebuilt = await waitFor(
      () =>
        offeredInRootOne.length > 0 &&
        offerBookmarks().length === offeredInRootOne.length &&
        offeredInRootOne.every(lane => readOffers(wh.session).has(lane)),
      30_000,
    )
    check(
      "restoring it builds their offers again",
      rebuilt >= 0,
      `${JSON.stringify({ offered: offeredInRootOne, back: offerBookmarks() })}`,
    )
    script.use([
      { tool: "bash", args: { command: "cat shared.txt" } },
      { text: "back" },
    ])
    await wu.chat("still there?", at(tipOf("move on")), { lane: one?.name })
    await idle()
    check(
      "after restoring, a lane runs again on its newest snapshot",
      toolResults(one?.name).at(-1)?.trim() === "parent-later",
    )

    // A lane with a record and neither a disk nor a snapshot predates lane
    // containers: its tools say so, and name what to do.
    if (two !== undefined) {
      await wh.quiet()
      sh(
        `container rm -f ${container(two.name)} >/dev/null 2>&1; container volume rm ${container(two.name)} >/dev/null 2>&1; true`,
      )
      for (const r of rootRecordsOf(wh, readRevisions).values())
        if (r.lane === two.name && r.snapshot !== null)
          rmSync(path.join(snapshots, `${r.snapshot}.img`), { force: true })
    }
    script.use([
      { tool: "bash", args: { command: "echo still" } },
      { text: "retired" },
    ])
    await wu.chat("are you there?", at(two?.tip ?? null), { lane: two?.name })
    await idle()
    check(
      "a lane with no disk and no snapshot says it predates lane containers",
      toolResults(two?.name).at(-1)?.includes("predates lane containers") ===
        true,
      `${toolResults(two?.name).at(-1)?.slice(0, 60) ?? "none"}`,
    )
  } finally {
    // Whatever happened above: nothing of this run is left behind.
    rmSync(marker, { force: true })
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
    cleanUp(wh.session, project)
  }
}
