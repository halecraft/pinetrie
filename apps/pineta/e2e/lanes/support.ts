// e2e/lanes/support — what the lanes scenarios share: shell and jj helpers, a
// lane's shell, a host of a scenario's own (`sectionHost`), and the image the
// fsck checks run in.

import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { SessionClient } from "@pineta/client/session"
import {
  ancestry,
  atEntry,
  type CardId,
  cardId,
  entryId,
  type LaneName,
  messageText,
  type Position,
  projectTranscript,
  ROOT,
} from "@pineta/core"
import { scriptedModel } from "@pineta/pi"
import {
  readCards,
  readLaneRecords,
  readLanes,
  readTreeIndex,
} from "@pineta/reads"
import { readEntries, rowMessage } from "@pineta/schema"
import { startHost } from "../../host/index.ts"
import { committedProject, join, noQueued, waitFor } from "../harness.ts"

export const START_AGENT = { mode: "branch", asksAgent: true } as const
export const BRANCH = { mode: "branch" } as const
export const at = (id: string | null): Position =>
  id === null ? ROOT : atEntry(entryId(id))

/**
 * Bring a thread up to date (ADR-0055), as its button and a send do: a card
 * at the lane's tip with the command and `text`, queued. On an idle lane the
 * host takes it at once.
 */
export function bringUpToDate(
  session: SessionClient,
  lane: LaneName,
  tip: string | null,
  text: string,
): CardId {
  const id = cardId(crypto.randomUUID())
  const where = at(tip)
  session.createCard(
    {
      id,
      owner: session.writer,
      place: { kind: "drafting", at: where, lane },
      command: "bring-up-to-date",
      unsent: null,
    },
    text,
  )
  session.queueCard(id, { lane, at: where })
  return id
}

console.log("=== Pineta — lanes of their own, in containers ===\n")

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

export const container = (lane: LaneName) => `pineta-${lane}`
/**
 * `script` run in a lane's container, as root, between runs: the container
 * is started for it and stopped after, as the host would.
 */
export function inLane(lane: LaneName, script: string): string {
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
export function inLaneQuiet(lane: LaneName, script: string): string {
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
export function cleanUp(
  doc: Parameters<typeof readLaneRecords>[0],
  dir: string,
) {
  for (const lane of readLaneRecords(doc).keys())
    sh(
      `container rm -f ${container(lane as LaneName)} >/dev/null 2>&1; container volume rm ${container(lane as LaneName)} >/dev/null 2>&1; true`,
    )
  rmSync(dir, { recursive: true, force: true })
}
export const jjFails = (dir: string, ...args: string[]): boolean => {
  try {
    jj(dir, ...args)
    return false
  } catch {
    return true
  }
}

/**
 * A host of its own for a section: a project (`files`, or an existing `dir`),
 * its own scripted model and user, and reads by message text. `close` removes
 * its lanes; `keep` leaves the project, for a host to restart over.
 */
export async function sectionHost(input: {
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
      () => Object.keys(host.doc.activeRuns()).length === 0 && noQueued(host),
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
    return readLanes(host.doc, index, readCards(host.cards)).find(
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

export const imageHost = (containerfile: string) =>
  sectionHost({
    files: {
      "pineta.Containerfile": containerfile,
      "notes.txt": "the secret word is MANGO\n",
    },
  })

// ── the contract: a clone written into a volume `container` made ─────────
// Not an API of `container` (S40): a volume is its `entity.json` and an image
// read by path. Twenty clones of a journaled volume, taken while a writer
// appends fsynced records, must each check clean and hold every record
// fsynced before it was taken (S41's soak, in small).
/** An image with `e2fsck` and `debugfs`, to read a lane's disk: built once and kept. */
export const FSCK_IMAGE = "pineta-fsck:1"

export function ensureFsckImage(): void {
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
