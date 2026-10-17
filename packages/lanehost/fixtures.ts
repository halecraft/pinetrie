// @pinetrie/lanehost/fixtures — for tests of lanehost's hosts: the machine
// role's server on a stand-in loader (`fixtures/stand-in-observe.mjs`, which
// says what its table holds), and the disks role answering in-process, its
// tar stream too.

import { spawn } from "node:child_process"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { answer } from "./answer.ts"
import type { LanehostCall, LanehostResult } from "./protocol.ts"
import { servingFrom } from "./serving.ts"

export { tarStream } from "./tar-out.ts"

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

/**
 * The disks role answering in this process, over `lanesDir`, its project's
 * root at `folder` in place of its mount: for an adapter's tests on btrfs.
 */
export function disksInProcess(input: {
  readonly lanesDir: string
  readonly folder: string
}): <C extends LanehostCall>(call: C) => Promise<LanehostResult<C>> {
  const serving = servingFrom([
    "disks",
    input.lanesDir,
    JSON.stringify({ rootless: true, folder: input.folder }),
  ])
  return call => answer(call, serving)
}
