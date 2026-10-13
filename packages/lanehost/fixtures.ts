// @pinetrie/lanehost/fixtures — the machine role's server on a stand-in
// loader (`fixtures/stand-in-observe.mjs`), for tests of its hosts: what
// the stand-in's table holds is said there.

import { spawn } from "node:child_process"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/** The role started on a socket of its own; `close` stops it. */
export async function standInRole(): Promise<{
  readonly socket: string
  close(): void
}> {
  const socket = path.join(
    mkdtempSync(path.join(tmpdir(), "observer-")),
    "observer.sock",
  )
  const role = spawn(
    "node",
    [
      path.join(import.meta.dirname, "observer-server.ts"),
      socket,
      path.join(import.meta.dirname, "fixtures/stand-in-observe.mjs"),
      "v1",
    ],
    { stdio: "inherit" },
  )
  // It listens once its loader is spawned, before its hello.
  for (let i = 0; i < 100 && !existsSync(socket); i++)
    await new Promise(r => setTimeout(r, 50))
  return { socket, close: () => role.kill() }
}
