// e2e/lanes/support — what the lanes scenarios share: shell and jj helpers,
// commands queued in a thread, a snapshot's listing, and an image's host. A
// host with lanes, and a lane's shell, are `lane-hosts.ts`'s.

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  entryId,
  PRODUCT_NAME,
  type SnapshotId,
  type ThreadId,
} from "@pinetrie/core"
import type { SessionClient } from "@pinetrie/session"
import type { CardCommand, CardId } from "@pinetrie/threads"
import { vmStateDir } from "@pinetrie/vm"
import { composeCard, queueCard } from "../harness.ts"
import type { LaneHosts } from "../lane-hosts.ts"

/**
 * Bring a thread up to date, as its button and a send do: a card
 * at the lane's tip with the command and `text`, queued. On an idle lane the
 * host pops it at once.
 */
export const bringUpToDate = (
  session: Omit<SessionClient, "send">,
  lane: ThreadId,
  tip: string | null,
  text: string,
): Promise<CardId> => queueCommand(session, lane, tip, text, "get-latest")

/**
 * A card with `command` and `text`, made at the thread's end once the
 * session holds it (`composeCard`), then queued: a command button makes its
 * card in the queue, empty; this one carries text, which a card
 * made in the queue cannot.
 */
export async function queueCommand(
  session: Omit<SessionClient, "send">,
  lane: ThreadId,
  tip: string | null,
  text: string,
  command: CardCommand,
): Promise<CardId> {
  const entry = tip === null ? null : entryId(tip)
  const id = await composeCard(session, { entry, lane, command }, text)
  void queueCard(session, id, lane)
  return id
}

console.log(`=== ${PRODUCT_NAME} — lanes of their own, in containers ===\n`)

/** A shell command's output on the host; rejects on failure. */
export const sh = (script: string, cwd?: string): Promise<string> =>
  command("sh", ["-c", script], cwd === undefined ? {} : { cwd })
export const jj = (dir: string, ...args: string[]): Promise<string> =>
  command("jj", ["--no-pager", "-R", dir, ...args])

import { CommandFailed, command } from "../command.ts"
import { dockerDisks, inDisks } from "../lane-runtime.ts"

export {
  cli,
  container,
  containerExists,
  deleteSnapshot,
  dockerDisks,
  inDisks,
  isRunning,
  removeLane,
  restoreDisk,
  runtimeCli,
  snapshotExists,
} from "../lane-runtime.ts"

/** The names in `dir` of snapshot `id`'s disk. */
export function snapshotListing(
  root: string,
  id: SnapshotId,
  dir: string,
): Promise<string> {
  return inDisks(root, 'ls -a "$1"', `${dockerDisks(root).snapshot(id)}/${dir}`)
}

/** Why jj refused a command in `dir`: its stderr, or null when it ran. */
export const jjRefusal = (
  dir: string,
  ...args: string[]
): Promise<string | null> =>
  jj(dir, ...args).then(
    () => null,
    (error: unknown) => {
      if (error instanceof CommandFailed) return error.stderr
      throw error
    },
  )

/** A section host whose project builds its image from `containerfile`. */
export const imageHost = (lanes: LaneHosts, containerfile: string) =>
  lanes.sectionHost({
    files: {
      "pinetrie.Containerfile": containerfile,
      "notes.txt": "the secret word is MANGO\n",
    },
  })

/**
 * A lane VM of a scenario's own on the Mac: a state directory under `/tmp/`
 * whose `share`d entries (`images`, `bin`, `builder`) are the person's, so
 * what is built there is kept, and the rest its own. `data` names a data
 * disk of the person's state kept between runs, so a cold start formats it
 * only the first time and Docker keeps what it pulled; without it the VM
 * formats a fresh one. Its launcher stops 2 s after its last lease. Null
 * off the Mac. Returns how to put the environment back.
 */
export function ownVm(input: {
  readonly share: readonly ("images" | "bin" | "builder")[]
  readonly data?: string
}): { readonly state: string; restore(): void } | null {
  if (process.platform !== "darwin") return null
  const real = vmStateDir(process.env, homedir())
  const state = realpathSync(mkdtempSync("/tmp/pc-"))
  const vm = path.join(state, "pinetrie", "vm")
  mkdirSync(vm, { recursive: true })
  for (const d of input.share) {
    mkdirSync(path.join(real, d), { recursive: true })
    symlinkSync(path.join(real, d), path.join(vm, d))
  }
  if (input.data !== undefined)
    symlinkSync(path.join(real, input.data), path.join(vm, "data.img"))
  const saved = {
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    LAUNCHER_IDLE_SECONDS: process.env.LAUNCHER_IDLE_SECONDS,
  }
  process.env.XDG_STATE_HOME = state
  process.env.LAUNCHER_IDLE_SECONDS = "2"
  return {
    state,
    restore() {
      for (const [k, v] of Object.entries(saved))
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
    },
  }
}
