// e2e/lanes/support — what the lanes scenarios share: shell and jj helpers,
// commands queued in a thread, a snapshot's listing, and an image's host. A
// host with lanes, and a lane's shell, are `lane-hosts.ts`'s.

import { execFileSync } from "node:child_process"
import {
  type CardCommand,
  type CardId,
  entryId,
  PRODUCT_NAME,
  type SnapshotId,
  type ThreadId,
} from "@pinetrie/core"
import type { SessionClient } from "@pinetrie/session"
import { composeAt, queueCard } from "../harness.ts"
import type { LaneHosts } from "../lane-hosts.ts"

/**
 * Bring a thread up to date (ADR-0108), as its button and a send do: a card
 * at the lane's tip with the command and `text`, queued. On an idle lane the
 * host pops it at once.
 */
export const bringUpToDate = (
  session: Omit<SessionClient, "chat">,
  lane: ThreadId,
  tip: string | null,
  text: string,
): Promise<CardId> => queueCommand(session, lane, tip, text, "bring-up-to-date")

/**
 * A card with `command` and `text`, made at the thread's end once the
 * session holds it (`composeAt`), then queued: a command button makes its
 * card in the queue, empty (ADR-0113); this one carries text, which a card
 * made in the queue cannot.
 */
export async function queueCommand(
  session: Omit<SessionClient, "chat">,
  lane: ThreadId,
  tip: string | null,
  text: string,
  command: CardCommand,
): Promise<CardId> {
  const entry = tip === null ? null : entryId(tip)
  const id = await composeAt(session, { entry, lane, command }, text)
  void queueCard(session, id, lane)
  return id
}

console.log(`=== ${PRODUCT_NAME} — lanes of their own, in containers ===\n`)

/** A shell command's output on the host; throws on failure. */
export const sh = (command: string, cwd?: string): string =>
  execFileSync("sh", ["-c", command], {
    stdio: "pipe",
    ...(cwd === undefined ? {} : { cwd }),
  }).toString()
export const jj = (dir: string, ...args: string[]): string =>
  execFileSync("jj", ["--no-pager", "-R", dir, ...args], {
    stdio: "pipe",
  }).toString()

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
  runtimeCli,
  snapshotExists,
} from "../lane-runtime.ts"

/** The names in `dir` of snapshot `id`'s disk. */
export function snapshotListing(
  root: string,
  id: SnapshotId,
  dir: string,
): string {
  return inDisks('ls -a "$1"', `${dockerDisks(root).snapshot(id)}/${dir}`)
}

/** Why jj refused a command in `dir`: its stderr, or null when it ran. */
export const jjRefusal = (dir: string, ...args: string[]): string | null => {
  try {
    jj(dir, ...args)
    return null
  } catch (error) {
    return (error as { stderr?: Buffer }).stderr?.toString() ?? ""
  }
}

/** A section host whose project builds its image from `containerfile`. */
export const imageHost = (lanes: LaneHosts, containerfile: string) =>
  lanes.sectionHost({
    files: {
      "pinetrie.Containerfile": containerfile,
      "notes.txt": "the secret word is MANGO\n",
    },
  })
