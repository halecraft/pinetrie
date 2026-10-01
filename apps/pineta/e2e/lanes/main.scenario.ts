// e2e/lanes/main — one host with a scripted model over a throwaway project,
// whose threads' agents each work in a Linux container on a disk cloned from
// where they branched (ADR-0034).

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  ancestry,
  commitId,
  entryId,
  type LaneName,
  messageText,
  nearestRevision,
  projectTranscript,
  ROOT,
  rootOf,
} from "@pineta/core"
import { hostOps, startOfOffer } from "@pineta/lanes"
import { scriptedModel } from "@pineta/pi"
import {
  readHaves,
  readLandings,
  readLanes,
  readNames,
  readOffers,
  readOutbox,
  readProject,
  readRevisions,
  readTreeIndex,
} from "@pineta/reads"
import { readEntries, rowMessage } from "@pineta/schema"
import { startHost } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import {
  committedProject,
  containerProblem,
  join,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import {
  at,
  BRANCH,
  cleanUp,
  container,
  inLane,
  inLaneQuiet,
  jj,
  jjFails,
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
  const laneTip = (lane: LaneName) =>
    readLanes(wh.doc, tree()).find(l => l.name === lane)?.tip ?? null
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
    check(
      "the host finds container and gives threads lanes of their own",
      readProject(wh.doc)?.kind === "lanes",
      `${JSON.stringify(readProject(wh.doc))}`,
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
            `present(tip@pineta-${lane})`,
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
        : readNames(wh.doc).get(committer.name)
    const hasMine = () =>
      committerOffer !== undefined &&
      jj(
        project,
        "file",
        "list",
        "-r",
        `present(bookmarks(exact:"pineta-offer/${committerOffer}"))`,
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
    if (atOnce !== undefined) await wu.stop(atOnce.name)
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

    // ── 6. Offers: the thread's work as one commit you take (ADR-0038) ────
    const offerOf = () =>
      two === undefined ? undefined : readOffers(wh.doc).get(two.name)
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
    const names = readNames(wh.doc)
    const twoName = two === undefined ? undefined : names.get(two.name)
    const offerBookmarkOf = (lane: LaneName | undefined) =>
      lane === undefined
        ? ""
        : `pineta-offer/${readNames(wh.doc).get(lane) ?? ""}`
    const allNamed = readLanes(wh.doc, tree()).every(l => names.has(l.name))
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
        ).includes(`Pineta-Thread: ${twoName}\n`),
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
        .filter(l => l !== "" && !l.startsWith("pineta-offer-"))
        .reverse()
        .filter((l, i, all) => l !== all[i - 1])
    // You change the same line, commit, and keep editing: the offer shows the
    // conflict before you take it.
    writeFileSync(path.join(project, "shared.txt"), "one\ntwo (you)\nthree\n")
    jj(project, "commit", "-m", "you edit line two")
    writeFileSync(path.join(project, "still-editing.txt"), "wip\n")
    const conflicted = await waitFor(
      () => offerOf()?.conflicts.includes("shared.txt") === true,
      30_000,
    )
    check(
      "the offer follows your commit, and says it conflicts with your work",
      conflicted >= 0,
      `${JSON.stringify(offerOf()?.conflicts)}`,
    )
    // You reword the commit under the offer: jj rebases the offer, not the
    // host, whose next trigger plans `none` and keeps `host.wrote`. The
    // record's `commits` still names the offer as it is now, which is what
    // a review reads (ADR-0047). The first line stays, for the take below.
    const wroteBefore = JSON.stringify(offerOf()?.host.wrote)
    jj(project, "describe", "-r", "@-", "-m", "you edit line two\n\nreworded")
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
    check(
      "the offer's record names its commit as it is now, after jj rebased it under the host",
      followed >= 0 &&
        JSON.stringify(offerOf()?.host.wrote) === wroteBefore &&
        wroteBefore !== JSON.stringify(offerOf()?.commits),
      `${JSON.stringify({ commits: offerOf()?.commits, wrote: offerOf()?.host.wrote, now: offerNow() })}`,
    )
    // Resolve in the thread: your work merged into the lane, the agent resolves.
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
    const resolving = two === undefined ? null : await wu.update(two.name)
    await idle()
    const landing = readLandings(wh.doc).at(-1)
    const landMessage = projectTranscript(tree(), landing?.prompt ?? null).at(
      -1,
    )
    const clean = await waitFor(
      () =>
        offerOf()?.conflicts.length === 0 &&
        offerOf()?.files.includes("shared.txt") === true,
      30_000,
    )
    check(
      "a conflicting update runs the resolution, and the offer comes back clean",
      resolving?.kind === "started" &&
        landMessage?.text.includes("1 file conflicts") === true &&
        landing?.state === "resolved" &&
        clean >= 0,
      `${landing?.state ?? JSON.stringify(resolving)}`,
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
    // Take: one commit under your edits; your uncommitted file kept.
    const taken = two === undefined ? null : await wu.offer(two.name, "take")
    const below = jj(
      project,
      "log",
      "--no-graph",
      "-r",
      "@--",
      "-T",
      "description.first_line()",
    )
    check(
      "taking the offer puts one commit under your edits, your uncommitted file kept",
      taken?.kind === "taken" &&
        readFileSync(path.join(project, "shared.txt"), "utf8") ===
          "one\ntwo (you, and lane)\nthree\n" &&
        readFileSync(path.join(project, "still-editing.txt"), "utf8") ===
          "wip\n" &&
        below === "you edit line two",
      `${JSON.stringify(taken)}, below: ${below}`,
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
        offerOf()?.taken === null &&
        JSON.stringify(offerOf()?.files) === JSON.stringify(["after.txt"]),
      30_000,
    )
    check(
      "after a take, the next offer holds only the new work",
      next >= 0,
      `${JSON.stringify(offerOf()?.files)}`,
    )
    // A clean update: a fact in the thread, and the composer's prefill.
    writeFileSync(path.join(project, "yours.txt"), "yours\n")
    jj(project, "commit", "-m", "you add yours.txt")
    const updated = two === undefined ? null : await wu.update(two.name)
    const updateEntry = projectTranscript(
      tree(),
      two === undefined ? null : laneTip(two.name),
    ).at(-1)
    check(
      "a clean update writes a fact in the thread and returns the composer's prefill",
      updated?.kind === "updated" &&
        updated.text.includes("merged my latest work") &&
        updateEntry?.role === "update",
      `${JSON.stringify(updated)}`,
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
            `tip@pineta-${lane2}`,
            "-T",
            "commit_id",
          )
    // Where the host starts the offer, as it computes it.
    const start = (
      await startOfOffer(hostOps(project), {
        tip: commitId(laneTipCommit),
        target: "@-",
        haves: readHaves(wh.doc),
      })
    ).join(" ")
    script.use([
      {
        tool: "bash",
        args: {
          command: `jj new ${start} -m s && jj restore --from ${laneTipCommit} 'root:"after.txt"' && jj commit -m 'stack 1: after.txt' && jj restore --from ${laneTipCommit} && jj commit -m 'stack 2: the rest' && jj bookmark set pineta/${lane2}-stack -r @-`,
        },
      },
      { text: "split" },
    ])
    const split = lane2 === undefined ? null : await wu.offer(lane2, "split")
    await idle()
    const stacked = await waitFor(() => offerOf()?.size === 2, 30_000)
    const squashed =
      stacked >= 0 && lane2 !== undefined
        ? await wu.offer(lane2, "squash")
        : null
    await wh.quiet()
    check(
      "split into a stack: the agent's stack becomes the offer, and squash makes it one again",
      split?.kind === "started" &&
        stacked >= 0 &&
        squashed?.kind === "offered" &&
        offerOf()?.size === 1,
      `${JSON.stringify({ split, size: offerOf()?.size })}`,
    )

    // A new root thread sees work you have not committed.
    writeFileSync(path.join(project, "unsaved.txt"), "not committed\n")
    script.use([
      { tool: "bash", args: { command: "cat unsaved.txt" } },
      { text: "seen" },
    ])
    await wu.chat("read my unsaved file", ROOT, START_AGENT)
    await idle()
    const seenUnsaved = toolResults(laneWith("read my unsaved file")?.name)
    check(
      "a new root thread starts from a copy of your @: it sees your uncommitted file",
      seenUnsaved.some(t => t.includes("not committed")) &&
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

    // A branch's offer holds its parent's work you lack, with its own. Taking
    // the parent's shrinks it to its own, in place; taking a branch that holds
    // all of its parent's withdraws the parent's (ADR-0039).
    const offerFor = (lane: LaneName | undefined) =>
      lane === undefined ? undefined : readOffers(wh.doc).get(lane)
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
    await wu.offer(lane2 ?? ("" as LaneName), "take")
    const shrunk = await waitFor(
      () => filesOf(branchA) === JSON.stringify(["branch-a.txt"]),
      30_000,
    )
    await wh.quiet()
    check(
      "taking a parent's offer shrinks its branch's offer to its own work, in place",
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
    const takenB = await wu.offer(branchB ?? ("" as LaneName), "take")
    const withdrawn = await waitFor(() => offerOf() === undefined, 30_000)
    check(
      "taking a branch that holds all its parent's work withdraws the parent's offer: no record, no bookmark",
      takenB.kind === "taken" &&
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
      `${JSON.stringify({ takenB, parent: offerOf()?.files })}`,
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
    check(
      "archiving a root deletes its lanes' containers and all but each lane's newest snapshot",
      kept.length === lanesInRoot.size &&
        newestKept &&
        one !== undefined &&
        !sh(`container list -a --quiet`).includes(container(one.name)),
      `${before.length} → ${kept.length}`,
    )
    if (rootOne !== null) await wu.archive("restore", entryId(rootOne))
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
    cleanUp(wh.doc, project)
  }
}
