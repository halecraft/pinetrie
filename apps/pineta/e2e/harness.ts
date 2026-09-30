// e2e/harness — what the end-to-end suites share besides their checks
// (checks.ts): waiting, throwaway projects, joining a host, and their model.
//
// Deliberately not in core/: core is pure domain logic and imports nothing.
// A test harness is neither.

import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { type ConnectOptions, connectSession } from "@pineta/client/session"
import { scriptedModel } from "@pineta/pi"

/**
 * Poll until `pred` holds. Resolves with the elapsed milliseconds, or -1 on
 * timeout. Shared by both suites so each does not grow its own copy.
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
 * A person joining `host` over its WebSocket, as `<name>@<section>.test`: one
 * domain per section, so no two sections share a person (ADR-0037).
 */
export const join = (
  host: { readonly wsUrl: string },
  name: string,
  section: string,
  options: Partial<
    Omit<ConnectOptions, "url" | "WebSocket" | "principal">
  > = {},
) =>
  connectSession({
    url: host.wsUrl,
    WebSocket,
    principal: `${name}@${section}.test`,
    ...options,
  })

/** What the suites' agent says when nothing is scripted. */
export const SUITE_REPLY =
  "A scripted reply, streamed in pieces, so a suite sees it grow and then end."

/**
 * The suites' own model: scripted, so a run spends nothing and needs no key
 * (ADR-0041). At 400 tokens per second a reply's pieces arrive over tens of
 * milliseconds, so a streaming check sees it grow. A check that needs a run
 * in progress pauses it (`ScriptedModel.pause`).
 */
export const suiteModel = () =>
  scriptedModel({ tokensPerSecond: 400, answer: { text: SUITE_REPLY } })
