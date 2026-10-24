// scripts/test-lane — a throwaway lane that runs this checkout's tests where
// this machine cannot: Linux, util-linux, its `/workspace` on btrfs. Opened
// once (`openTestLane`), it holds a copy of the working copy,
// installed from the frozen lockfile; `put` sends files again, as a mutant
// changes one, and `run` runs a command in the copy.
//
// The lane is a throwaway project's, never this checkout's own: a host may
// serve this checkout, and a second host on a served project is refused.
// The copy is `jj file list`'s files, streamed through `tar` into the
// lane: the working copy exactly, uncommitted changes included, and no share
// of the checkout.

import { execFile, spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { type ThreadId, threadIdFor } from "@pinetrie/core"
import { PINETRIE_MOUNT, thisInstall } from "@pinetrie/install"
import {
  ensureRuntime,
  type LaneRuntime,
  laneContainer,
  prepareImages,
  RUNTIME_MOUNT,
  sessionFiles,
} from "@pinetrie/lanes"
import { findProject } from "../host/work/runtime.ts"
import { PLAYWRIGHT_VERSION } from "../host/work/setup.ts"

const run = promisify(execFile)

/** Where the copy is in the lane. */
export const LANE_CHECKOUT = "/workspace/src"

export interface Ran {
  readonly status: number | null
  readonly output: string
}

export interface TestLane {
  /** Send `paths` (from the checkout's root) again, as they are on disk now. */
  put(paths: readonly string[]): Promise<void>
  /**
   * Run `argv` in the copy, each chunk of its output to `onOutput` as it
   * comes. A run past `timeoutMs` is killed, its status null.
   */
  run(
    argv: readonly string[],
    options?: {
      readonly onOutput?: (chunk: string) => void
      readonly timeoutMs?: number
    },
  ): Promise<Ran>
  /** A file of the lane's, as text. */
  read(file: string): Promise<string>
  /** Remove the lane, its disk and the throwaway project. */
  close(): Promise<void>
}

/** A command's output and status, with its output streamed as it comes. */
function runStreamed(
  argv: readonly string[],
  options: {
    readonly input?: NodeJS.ReadableStream
    readonly onOutput?: (chunk: string) => void
    readonly timeoutMs?: number
  } = {},
): Promise<Ran> {
  const [cmd = "docker", ...args] = argv
  return new Promise(resolve => {
    const child = spawn(cmd, args, {
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    })
    if (options.input !== undefined && child.stdin !== null)
      options.input.pipe(child.stdin)
    let output = ""
    const take = (d: Buffer) => {
      const text = d.toString()
      output += text
      options.onOutput?.(text)
    }
    child.stdout?.on("data", take)
    child.stderr?.on("data", take)
    const timer =
      options.timeoutMs === undefined
        ? null
        : setTimeout(() => child.kill("SIGKILL"), options.timeoutMs)
    child.on("close", status => {
      if (timer !== null) clearTimeout(timer)
      resolve({ status, output })
    })
  })
}

/**
 * The files `list` names, from `root`, as a tar stream on its stdout, with
 * no Mac metadata (`._` files) and no extended attributes. `exited` settles
 * with its status.
 */
function tarStream(root: string, list: string) {
  const child = spawn("tar", ["-c", "--no-xattrs", "-f", "-", "-T", list], {
    cwd: root,
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let said = ""
  child.stderr.on("data", d => {
    said += d
  })
  const exited = new Promise<{ status: number | null; said: string }>(resolve =>
    child.on("close", status => resolve({ status, said })),
  )
  return { stdout: child.stdout, exited }
}

/**
 * Open a lane for the checkout at `root`: a throwaway project, its images
 * and `ready`, one plain lane, the working copy copied in and installed.
 * The lane is removed if opening fails.
 */
export async function openTestLane(input: {
  readonly root: string
  readonly log: (line: string) => void
}): Promise<TestLane> {
  const { root, log } = input
  const project = await mkdtemp(path.join(tmpdir(), "pinetrie-test-lane-"))
  const git = (...args: string[]) =>
    run("git", ["-c", "user.name=pinetrie", "-c", "user.email=t@t", ...args], {
      cwd: project,
    })
  await git("init", "-q")
  await writeFile(path.join(project, "README.md"), "a throwaway project\n")
  await git("add", ".")
  await git("commit", "-qm", "a throwaway project")
  const found = await findProject({
    root: project,
    install: thisInstall,
    slots: 16,
    // Nothing listens there: no lane here holds an ssh identity.
    hostSocket: path.join(project, ".no-ssh.sock"),
    log,
    working: () => {},
    manage: "manage",
  })
  if (found?.kind !== "found") {
    await rm(project, { recursive: true, force: true })
    throw new Error(
      `no lane can be made: ${found === null ? "no project" : found.words}`,
    )
  }
  const runtime: LaneRuntime = found.runtime
  const lane: ThreadId = threadIdFor(`tests-${process.pid}`)
  const container = laneContainer(lane)
  const close = async () => {
    await runtime.remove(container).catch(() => {})
    await runtime.disk({ kind: "delete", lane }).catch(() => {})
    await found.close()
    await rm(project, { recursive: true, force: true })
  }
  const inLane = (script: string) =>
    runtime.execArgv(container, ["bash", "-c", script])
  const put = async (paths: readonly string[]) => {
    const list = path.join(project, "files")
    await writeFile(list, `${paths.join("\n")}\n`)
    const tar = tarStream(root, list)
    const [extracted, archived] = await Promise.all([
      runStreamed(
        inLane(
          `mkdir -p ${LANE_CHECKOUT} && tar -x --no-same-owner -C ${LANE_CHECKOUT} -f -`,
        ),
        { input: tar.stdout },
      ),
      tar.exited,
    ])
    if (archived.status !== 0)
      throw new Error(`the copy's archive failed: ${archived.said}`)
    if (extracted.status !== 0)
      throw new Error(`the copy into the lane failed: ${extracted.output}`)
  }
  try {
    log("[lane] the project's images, and its slot served")
    const images = await prepareImages(runtime, project, PLAYWRIGHT_VERSION)
    const files = sessionFiles(path.join(project, ".session"))
    await found.ready({
      defaultImage: images.runtimeFrom,
      hostPorts: [],
      mounts: [
        { source: project, target: "/mnt/host-working-copy", readonly: true },
        { source: thisInstall.root, target: PINETRIE_MOUNT, readonly: true },
        {
          source: await ensureRuntime(
            runtime,
            files.lanes.runtime,
            images.runtimeFrom,
          ),
          target: RUNTIME_MOUNT,
          readonly: true,
        },
      ],
    })
    log("[lane] a lane")
    await runtime.disk({ kind: "create", lane })
    await runtime.run({
      name: container,
      lane,
      image: images.lane,
      memory: "6g",
      mounts: [],
      env: {},
      hostSocket: null,
      starts: [],
      nested: false,
      hostPorts: [],
      states: false,
    })
    log("[lane] the working copy, copied in")
    const listed = await run("jj", ["file", "list"], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    })
    await put(listed.stdout.split("\n").filter(p => p !== ""))
    log("[lane] installed from the frozen lockfile")
    const installed = await runStreamed(
      inLane(
        `cd ${LANE_CHECKOUT} && CI=1 corepack pnpm install --frozen-lockfile`,
      ),
    )
    if (installed.status !== 0)
      throw new Error(`the install in the lane failed:\n${installed.output}`)
  } catch (error) {
    await close()
    throw error
  }
  return {
    put,
    run: (argv, options = {}) =>
      runStreamed(
        inLane(`cd ${LANE_CHECKOUT} && exec ${argv.map(shellWord).join(" ")}`),
        options,
      ),
    async read(file) {
      const read = await runStreamed(inLane(`cat ${shellWord(file)}`))
      if (read.status !== 0)
        throw new Error(`${file} could not be read in the lane: ${read.output}`)
      return read.output
    },
    close,
  }
}

/** `word` as one word of a shell command. */
export const shellWord = (word: string): string =>
  /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`
