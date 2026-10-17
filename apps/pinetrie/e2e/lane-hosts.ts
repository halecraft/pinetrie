// e2e/lane-hosts — hosts whose agents have tools, each thread's agent in a
// lane of its own on the suites' runtime: why that runtime cannot
// run here (`runtimeProblem`), a host with tools (`LaneHosts`), a host of a
// scenario's own with accepted work set up (`sectionHost`), a lane's shell,
// and removing a host's lanes. The scenario runner gives `LaneHosts` only to
// a scenario that declares `lanes: true` (`scenario.ts`), and skips it where
// `runtimeProblem` gives a reason.

import { rmSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { ancestry, entryId, messageText, type ThreadId } from "@pinetrie/core"
import { dockerWords } from "@pinetrie/docker"
import { type SessionFiles, sessionFiles } from "@pinetrie/lanes"
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
import { CommandFailed, command } from "./command.ts"
import {
  committedProject,
  entriesOf,
  idleNow,
  join,
  laneHolding,
  readEveryRoot,
  setUpAccepted,
  suiteBinding,
  suiteDirsNow,
  suitePlaces,
  suiteSshPlaces,
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
  const dir = await committedProject("pinetrie-runtime-", {
    "README.md": "probe\n",
  })
  try {
    const found = await findProject({
      root: dir,
      slots: 16,
      // Nothing listens there: this probe makes no lane.
      hostSocket: path.join(dir, ".no-ssh.sock"),
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
  const answers = (args: readonly string[]) =>
    command("docker", args).then(
      () => null,
      (error: unknown) =>
        error instanceof CommandFailed
          ? (error.stderr.trim().split("\n")[0] ?? "")
          : String(error),
    )
  const cli = await answers(["--version"])
  if (cli !== null)
    return dockerWords({ kind: "no-docker", platform: "darwin", said: cli })
  const buildx = await answers(["buildx", "version"])
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
  Omit<StartHostOptions, "project" | "log" | "binding">
> & {
  readonly files?: Readonly<Record<string, string | Uint8Array>>
  readonly dir?: string
  readonly logs?: string[]
}

export type SectionHost = Awaited<ReturnType<typeof sectionHost>>

/** A host with tools, as a scenario starts one: its session's files are the suite's to give. */
export type LaneHostOptions = Omit<StartHostOptions, "binding" | "project"> & {
  readonly project: { readonly dir: string; readonly tools: true }
}

/**
 * The files of the session a suite's host serves `dir` as: in the suite's
 * data directory, one session per project folder, so hosts running at once
 * never share an ignore file, and a host started again over a kept project
 * finds its runtime.
 */
export const suiteSessionFiles = (dir: string): SessionFiles =>
  sessionFiles(path.join(suiteDirsNow().data, "sessions", path.basename(dir)))

/** What a scenario that declares `lanes: true` is given. */
export interface LaneHosts {
  /**
   * `startHost` with the suite's places and binding unless the scenario
   * gives its own places, and the session's files (`suiteSessionFiles`); a
   * runtime that cannot run lanes stops it.
   */
  startHost(options: LaneHostOptions): Promise<RunningHost>
  /** A host of a section's own, with accepted work set up (`sectionHost`). */
  sectionHost(input?: SectionInput): Promise<SectionHost>
}

export const laneHosts: LaneHosts = {
  startHost: options => startLaneHost(options),
  sectionHost: input => sectionHost(input ?? {}),
}

const startLaneHost = async (options: LaneHostOptions): Promise<RunningHost> =>
  readEveryRoot(
    await startHost({
      places: suitePlaces(),
      ssh: suiteSshPlaces(),
      binding: suiteBinding(),
      env: {},
      keepRootsRead: true,
      ...options,
      project: {
        ...options.project,
        files: suiteSessionFiles(options.project.dir).lanes,
      },
    }),
  )

/**
 * A host of its own for a section: a project (`files`, or an existing `dir`),
 * its own scripted model unless given one, a user, and accepted work set up,
 * so its root lanes start there. Reads by message text. `close`
 * removes its lanes; `keep` leaves the project, for a host to restart over.
 */
async function sectionHost(input: SectionInput) {
  const { files, dir: given, logs, ...options } = input
  const dir =
    given ?? (await committedProject("pinetrie-section-", files ?? {}))
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
    if (m?.[1] !== undefined) await ownForInnerLanes(path.join(dir, m[1]))
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
  const laneWith = (text: string) =>
    laneHolding(host, readPlaces(host.places), text)
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
    if (!keep) await cleanUp(host.session, dir)
  }
  return { dir, script, host, user, idle, laneWith, results, close }
}

/** Remove every container and disk of a host's lanes, then its project. */
export async function cleanUp(
  doc: Parameters<typeof readLaneRecords>[0],
  dir: string,
): Promise<void> {
  for (const lane of readLaneRecords(doc).keys()) await removeLane(dir, lane)
  rmSync(dir, { recursive: true, force: true })
}

/**
 * `script` run in a lane's container, as root, between runs: the container
 * is started for it and stopped after, as the host would. The host may stop
 * the container as a run ends, between the start and the exec: the exec is
 * then tried again, on a container started again.
 */
export async function inLane(lane: ThreadId, script: string): Promise<string> {
  const name = container(lane)
  const wasRunning = await isRunning(name)
  try {
    for (let tries = 1; ; tries++) {
      await cli(["start", name])
      try {
        return await cli([
          "exec",
          name,
          "sh",
          "-c",
          `cd /workspace && ${script}`,
        ])
      } catch (error) {
        const stopped =
          error instanceof CommandFailed && /is not running/.test(error.stderr)
        if (!stopped || tries === 3) throw error
      }
    }
  } catch (error) {
    // A command that fails, or a lane that does not start, is a check's to
    // judge, from what it printed.
    if (error instanceof CommandFailed) return `${error.stdout}${error.stderr}`
    throw error
  } finally {
    if (!wasRunning && (await isRunning(name))) await cli(["stop", name])
  }
}

/** `inLane` for a lane that is running now; empty if it is not, or if `script` fails. */
export const inLaneQuiet = (lane: ThreadId, script: string): Promise<string> =>
  cli(["exec", container(lane), "sh", "-c", script]).catch(() => "")
