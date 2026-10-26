// e2e/lanes/vcs — what a host with tools makes of version control: with no
// jj on its PATH, a folder project is served and a lane's proposed changes
// accepted into it, while a folder holding `.git` is refused, naming jj; with
// jj, a git repo is made colocated at the start, its branch and your edits
// as they were.
//
// The harness itself needs jj (`committedProject`, the suite's images), so
// jj leaves the PATH only once a host is to start, and comes back after.
// Each scenario is a process of its own, so the PATH is this one's alone.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ROOT } from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { readPlaces, readProposedByLane } from "@pinetrie/reads"
import type { RunningHost } from "../../host/index.ts"
import type { Checks } from "../checks.ts"
import { command } from "../command.ts"
import {
  join,
  laneHolding,
  START_AGENT,
  untilSent,
  waitFor,
} from "../harness.ts"
import { cleanUp, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => vcsSection(check, lanes),
}

/** A folder of `files`, readable by a rootless Docker's user. */
function newFolder(prefix: string, files: Readonly<Record<string, string>>) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
  chmodSync(dir, 0o755)
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(dir, name), text)
  return dir
}

/**
 * `PATH` with each directory that holds `jj` replaced by one of links to
 * everything else in it, so the programs beside jj (Docker, git) still run.
 */
function pathWithoutJj(shims: string): string {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((dir, i) => {
      const names = (() => {
        try {
          return readdirSync(dir)
        } catch {
          return []
        }
      })()
      if (!names.includes("jj")) return dir
      const out = path.join(shims, String(i))
      mkdirSync(out)
      for (const n of names)
        if (n !== "jj") symlinkSync(path.join(dir, n), path.join(out, n))
      return out
    })
    .join(path.delimiter)
}

const git = (dir: string, ...args: string[]): Promise<string> =>
  command(
    "git",
    [
      "-c",
      "user.name=pinetrie e2e",
      "-c",
      "user.email=e2e@pinetrie.invalid",
      ...args,
    ],
    { cwd: dir },
  )

async function vcsSection(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  const withJj = process.env.PATH
  const shims = mkdtempSync(path.join(tmpdir(), "pinetrie-no-jj-"))
  try {
    process.env.PATH = pathWithoutJj(shims)
    await servedWithoutJj(check, lanes)
    await refusedWithoutJj(check, lanes)
  } finally {
    process.env.PATH = withJj
    rmSync(shims, { recursive: true, force: true })
  }
  await colocated(check, lanes)
}

async function servedWithoutJj(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  // 1. A folder project, served and accepted into with no jj.
  const dir = newFolder("pinetrie-no-jj-folder-", { "a.txt": "one\n" })
  const script = scriptedModel()
  const logs: string[] = []
  // Caught into the check: a start that fails is what it is about.
  const wh = await lanes
    .startHost({
      model: { kind: "scripted", script },
      project: { dir, tools: true },
      log: m => {
        logs.push(m)
        if (process.env.PINETRIE_E2E_LOG === "1") console.log(m)
      },
    })
    .catch((error: unknown) => String(error))
  const accepted = typeof wh === "string" ? wh : await acceptedWrite(wh, script)
  const b = path.join(dir, "b.txt")
  check(
    "with no jj on the host, a folder project is served, said so, and a lane's proposed changes accepted into it",
    logs.some(l => l.includes("jj does not run")) &&
      accepted === "accepted" &&
      existsSync(b) &&
      readFileSync(b, "utf8") === "lane's\n",
    `${accepted} ${logs.filter(l => /jj/.test(l)).join(" | ")}`,
  )
  if (typeof wh === "string") rmSync(dir, { recursive: true, force: true })
  else await cleanUp(wh.session, dir)
}

/** A lane of `wh`'s writes `b.txt`, and its proposed changes are accepted: the accept's kind, or why there was none. */
async function acceptedWrite(
  wh: RunningHost,
  script: ReturnType<typeof scriptedModel>,
): Promise<string> {
  const wu = await join(wh, "uma", "vcs")
  try {
    script.use([
      { tool: "write", args: { path: "b.txt", content: "lane's\n" } },
      { text: "wrote" },
    ])
    await untilSent(
      wh,
      await wu.send("@agent write b", ROOT, START_AGENT),
      300_000,
    )
    await wh.quiet()
    const lane = laneHolding(wh, readPlaces(wh.places), "@agent write b")?.name
    if (lane === undefined) return "no lane"
    const proposed = () => {
      const o = readProposedByLane(wh.session).get(lane)
      return o?.kind === "folder" && o.files.length > 0
    }
    await waitFor(proposed, 60_000).catch(() => {})
    if (!proposed()) return "no proposed changes"
    const accepted = await wu.proposed(lane, "accept", "")
    await wh.quiet()
    return accepted.kind
  } finally {
    await wu.close().catch(() => {})
    await wh.shutdown().catch(() => {})
  }
}

async function refusedWithoutJj(check: Checks["check"], lanes: LaneHosts) {
  // 2. A folder holding `.git`, with no jj: refused, naming jj.
  const repo = newFolder("pinetrie-no-jj-git-", { "a.txt": "one\n" })
  await git(repo, "init", "-q")
  const refused = await lanes
    .startHost({
      model: { kind: "scripted", script: scriptedModel() },
      project: { dir: repo, tools: true },
      log: () => {},
    })
    .then(
      async h => {
        await h.shutdown()
        return "started"
      },
      (error: unknown) => String(error),
    )
  rmSync(repo, { recursive: true, force: true })
  check(
    "with no jj on the host, a folder under git is refused, naming jj",
    refused.includes(".git") && refused.includes("jj does not run"),
    refused,
  )
}

async function colocated(
  check: Checks["check"],
  lanes: LaneHosts,
): Promise<void> {
  // 3. With jj: a git repo is made colocated at the start, as git had it.
  const repo = newFolder("pinetrie-git-", { "a.txt": "one\n" })
  await git(repo, "init", "-q", "-b", "main")
  await git(repo, "add", "a.txt")
  await git(repo, "commit", "-qm", "first")
  writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n")
  const status = await git(repo, "status", "--short")
  const logs: string[] = []
  // Caught into the check: a start that fails is what it is about.
  const started = await lanes
    .startHost({
      model: { kind: "scripted", script: scriptedModel() },
      project: { dir: repo, tools: true },
      log: m => {
        logs.push(m)
        if (process.env.PINETRIE_E2E_LOG === "1") console.log(m)
      },
    })
    .catch((error: unknown) => String(error))
  try {
    const branch = (await git(repo, "branch", "--show-current")).trim()
    const after = await git(repo, "status", "--short")
    check(
      "a git repo served is made colocated at the start, said so, its branch and your edits as they were",
      typeof started !== "string" &&
        existsSync(path.join(repo, ".jj")) &&
        logs.some(l => l.includes("jj git init --colocate")) &&
        branch === "main" &&
        after === status,
      `${typeof started === "string" ? started : ""} ${branch} ${after} ${logs.filter(l => /jj/.test(l)).join(" | ")}`,
    )
  } finally {
    if (typeof started === "string")
      rmSync(repo, { recursive: true, force: true })
    else {
      await started.shutdown().catch(() => {})
      await cleanUp(started.session, repo)
    }
  }
}
