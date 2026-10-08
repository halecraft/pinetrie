// e2e/lane-hosts — hosts whose agents have tools, each thread's agent in a
// lane of its own on the suites' runtime (ADR-0102): why that runtime cannot
// run here (`runtimeProblem`), a host with tools (`LaneHosts`), a host of a
// scenario's own with accepted work set up (`sectionHost`), a lane's shell,
// and removing a host's lanes. The scenario runner gives `LaneHosts` only to
// a scenario that declares `lanes: true` (`scenario.ts`), and skips it where
// `runtimeProblem` gives a reason.

import { execFileSync } from "node:child_process"
import { rmSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  ancestry,
  entryId,
  messageText,
  projectTranscript,
  type ThreadId,
} from "@pinetrie/core"
import { dockerWords } from "@pinetrie/docker"
import { scriptedModel } from "@pinetrie/pi"
import { readLaneRecords, readPlaces } from "@pinetrie/reads"
import { rowMessage } from "@pinetrie/schema"
import { vmProblem, vmStateDir } from "@pinetrie/vm"
import {
  type RunningHost,
  type StartHostOptions,
  startHost,
} from "../host/index.ts"
import { findProject } from "../host/work/runtime.ts"
import {
  committedProject,
  entriesOf,
  idleNow,
  join,
  lanesOf,
  setUpAccepted,
  suiteConfigFile,
  treeOf,
  waitFor,
} from "./harness.ts"
import {
  cli,
  container,
  isRunning,
  ownForInnerLanes,
  removeLane,
} from "./lane-runtime.ts"

/**
 * Why the suites' runtime, Docker, cannot give lanes their own here,
 * or null: the reason the host itself would give (`findProject`), on a
 * throwaway project. On the Mac under Docker it takes no lease: a lease
 * would start the person's VM, with whatever launcher this checkout holds (a
 * mutant's, in a mutation run), and leave it running for 10 minutes.
 */
export async function runtimeProblem(): Promise<string | null> {
  if (process.platform === "darwin") return macDockerProblem()
  const dir = committedProject("pinetrie-runtime-", { "README.md": "probe\n" })
  try {
    const found = await findProject({
      dir,
      machine: { slots: null },
      log: () => {},
    })
    if (found === null) return "no project"
    if (found.kind === "refused") return found.words
    await found.close()
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The lane VM's refusal, else the docker CLI's or buildx's, asked locally. */
async function macDockerProblem(): Promise<string | null> {
  const vm = await vmProblem(vmStateDir(process.env, homedir()))
  if (vm !== null) return vm
  const answers = (args: readonly string[]) => {
    try {
      execFileSync("docker", [...args], { stdio: "pipe" })
      return null
    } catch (error) {
      const e = error as { stderr?: Buffer }
      return e.stderr?.toString().trim().split("\n")[0] ?? ""
    }
  }
  const cli = answers(["--version"])
  if (cli !== null)
    return dockerWords({ kind: "no-docker", platform: "darwin", said: cli })
  const buildx = answers(["buildx", "version"])
  return buildx === null
    ? null
    : dockerWords({ kind: "no-buildx", platform: "darwin", said: buildx })
}

/**
 * What a section host takes: a project, or the files to commit in a new one;
 * the host's other options, its model a scripted one of its own unless
 * given; and a list its log lines are pushed to.
 */
export type SectionInput = Partial<
  Omit<StartHostOptions, "project" | "log">
> & {
  readonly files?: Readonly<Record<string, string | Uint8Array>>
  readonly dir?: string
  readonly logs?: string[]
}

export type SectionHost = Awaited<ReturnType<typeof sectionHost>>

/** What a scenario that declares `lanes: true` is given. */
export interface LaneHosts {
  /**
   * `startHost` with `SUITE_CONFIG` unless the scenario names its own file;
   * a runtime that cannot run lanes stops it.
   */
  startHost(options: StartHostOptions): Promise<RunningHost>
  /** A host of a section's own, with accepted work set up (`sectionHost`). */
  sectionHost(input?: SectionInput): Promise<SectionHost>
}

export const laneHosts: LaneHosts = {
  startHost: options => startLaneHost(options),
  sectionHost: input => sectionHost(input ?? {}),
}

const startLaneHost = (options: StartHostOptions): Promise<RunningHost> =>
  startHost({ userConfig: suiteConfigFile(), ...options })

/**
 * A host of its own for a section: a project (`files`, or an existing `dir`),
 * its own scripted model unless given one, a user, and accepted work set up
 * (ADR-0104), so its root lanes start there. Reads by message text. `close`
 * removes its lanes; `keep` leaves the project, for a host to restart over.
 */
async function sectionHost(input: SectionInput) {
  const { files, dir: given, logs, ...options } = input
  const dir = given ?? committedProject("pinetrie-section-", files ?? {})
  const script = scriptedModel()
  const seen: string[] = []
  const host = await startLaneHost({
    model: { kind: "scripted", script },
    ...options,
    project: { dir, tools: true },
    log: m => {
      seen.push(m)
      logs?.push(m)
      if (process.env.PINETRIE_E2E_LOG === "1") console.log(m)
    },
  })
  // After the host made the shared directories it was given, as it logged.
  for (const l of seen) {
    const m = /\[host\] (.+)\/ is shared read-write with every lane/.exec(l)
    if (m?.[1] !== undefined) ownForInnerLanes(path.join(dir, m[1]))
  }
  const user = await join(
    host,
    `u${Math.random().toString(36).slice(2, 10)}`,
    `section-${process.pid}`,
  )
  await setUpAccepted(host.session, user)
  const idle = async () => {
    await waitFor(() => idleNow(host), 300_000)
    await host.quiet()
  }
  /** The lane whose thread holds the message with `text`. */
  const laneWith = (text: string) => {
    const index = treeOf(host)
    const id =
      Object.values(index.entries).find(
        e => projectTranscript(index, e.id).at(-1)?.text === text,
      )?.id ?? null
    return lanesOf(host, index, readPlaces(host.places)).find(
      l => id !== null && ancestry(index, l.tip).path.includes(id),
    )
  }
  /** Every tool result's text in the thread holding `text`, oldest first. */
  const results = async (text: string) => {
    await idle()
    const index = treeOf(host)
    const onPath = new Set(ancestry(index, laneWith(text)?.tip ?? null).path)
    return Object.values(entriesOf(host))
      .filter(r => onPath.has(entryId(r.id)))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(r => rowMessage(r) as { role?: string })
      .filter(m => m.role === "toolResult")
      .map(m => messageText(m as never))
  }
  const close = async (keep = false) => {
    await user.close().catch(() => {})
    await host.shutdown().catch(() => {})
    // Kept for a restart: the lanes' containers too, as a host leaves them.
    if (!keep) cleanUp(host.session, dir)
  }
  return { dir, script, host, user, idle, laneWith, results, close }
}

/** Remove every container and disk of a host's lanes, then its project. */
export function cleanUp(
  doc: Parameters<typeof readLaneRecords>[0],
  dir: string,
): void {
  for (const lane of readLaneRecords(doc).keys()) removeLane(dir, lane)
  rmSync(dir, { recursive: true, force: true })
}

/**
 * `script` run in a lane's container, as root, between runs: the container
 * is started for it and stopped after, as the host would.
 */
export function inLane(lane: ThreadId, script: string): string {
  const name = container(lane)
  const wasRunning = isRunning(name)
  try {
    if (!wasRunning) cli(["start", name])
    return cli(["exec", name, "sh", "-c", `cd /workspace && ${script}`])
  } catch (error) {
    // A command that fails, or a lane that does not start, is a check's to
    // judge, from what it printed.
    const e = error as { stdout?: Buffer; stderr?: Buffer }
    return `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`
  } finally {
    if (!wasRunning && isRunning(name)) cli(["stop", name])
  }
}

/** `inLane` for a lane that is running now; empty if it is not. */
export function inLaneQuiet(lane: ThreadId, script: string): string {
  try {
    return cli(["exec", container(lane), "sh", "-c", script])
  } catch {
    return ""
  }
}
