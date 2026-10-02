// e2e/harness — what the end-to-end suites share besides their checks
// (checks.ts) and scenarios (scenario.ts): waiting, throwaway projects,
// joining a host, a host for a body (`withHost`), why `container` is unusable
// here (`containerProblem`), and their model.
//
// Deliberately not in core/: core is pure domain logic and imports nothing.
// A test harness is neither.

import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { type ConnectOptions, connectSession } from "@pineta/client/session"
import { prepareHost } from "@pineta/lanes"
import { scriptedModel } from "@pineta/pi"
import { readPlaces } from "@pineta/reads"
import {
  type RunningHost,
  type StartHostOptions,
  startHost,
} from "../host/index.ts"

/**
 * Poll until `pred` holds. Resolves with the elapsed milliseconds, or -1 on
 * timeout. Shared by every suite, so none grows its own copy.
 */
export async function waitFor(
  pred: () => boolean | Promise<boolean>,
  timeoutMs = 60_000,
): Promise<number> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return Date.now() - t0
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return -1
}

/** No card is queued on any lane (ADR-0048): nothing waits to be taken. */
export const noQueued = (host: Pick<RunningHost, "places">): boolean =>
  readPlaces(host.places).every(c => c.place.kind !== "queued")

/**
 * The host has nothing to do: no lane runs, and no card waits for one. A card
 * queued under a run is taken only as it ends, so "no run" alone can hold
 * between a run's end and the take.
 */
export const idleNow = (host: Pick<RunningHost, "doc" | "places">): boolean =>
  Object.keys(host.doc.activeRuns()).length === 0 && noQueued(host)

/**
 * A project for a host with tools: a jj repo, colocated with git, with
 * `files` committed. A lane starts from your committed work (`@-`,
 * ADR-0032), so what its agent should see must be committed. The path is the
 * real one (on macOS a temporary directory is behind a symlink), as jj names
 * it.
 */
export function committedProject(
  prefix: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
  const jj = (...args: string[]) =>
    execFileSync("jj", ["--no-pager", ...args], { cwd: dir, stdio: "pipe" })
  jj("git", "init", "--colocate")
  jj("config", "set", "--repo", "user.name", "Pineta e2e")
  jj("config", "set", "--repo", "user.email", "e2e@pineta.invalid")
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(dir, name), text)
  jj("commit", "-m", "the project")
  return dir
}

/**
 * A person joining `host` over its WebSocket, as `<name>@<scenario>.test`:
 * one domain per scenario, so no two scenarios share a person (ADR-0037).
 */
export const join = (
  host: { readonly wsUrl: string },
  name: string,
  scenario: string,
  options: Partial<
    Omit<ConnectOptions, "url" | "WebSocket" | "principal">
  > = {},
) =>
  connectSession({
    url: host.wsUrl,
    WebSocket,
    principal: `${name}@${scenario}.test`,
    ...options,
  })

/** What the suites' agent says when nothing is scripted. */
const SUITE_REPLY =
  "A scripted reply, streamed in pieces, so a suite sees it grow and then end."

/**
 * The suites' own model: scripted, so a run spends nothing and needs no key
 * (ADR-0041). At 400 tokens per second a reply's pieces arrive over tens of
 * milliseconds, so a streaming check sees it grow. A check that needs a run
 * in progress pauses it (`ScriptedModel.pause`).
 */
export const suiteModel = () =>
  scriptedModel({ tokensPerSecond: 400, answer: { text: SUITE_REPLY } })

/** Start a host, give it to `body`, and shut it down however `body` ends. */
export async function withHost<T>(
  options: StartHostOptions,
  body: (host: RunningHost) => Promise<T>,
): Promise<T> {
  const host = await startHost(options)
  try {
    return await body(host)
  } finally {
    await host.shutdown().catch(() => {})
  }
}

/**
 * Why lanes cannot have containers of their own here, or null: the reason the
 * host itself would give (`prepareHost`, `planHost` in `@pineta/lanes`), on a
 * throwaway project. A scenario that needs `container` gives this as its
 * `needs`.
 */
export async function containerProblem(): Promise<string | null> {
  const dir = committedProject("pineta-container-", { "README.md": "probe\n" })
  try {
    const { project } = await prepareHost(dir)
    return project.kind === "direct" ? project.reason : null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
