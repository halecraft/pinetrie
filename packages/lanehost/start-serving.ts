// lanehost/start-serving — a role's server started, in its order: its
// project's lock taken, what a snapshot cut short left dropped, then its
// calls answered. A server whose lock is another host's says so in its
// hello and answers nothing, so its client opens a fresh one next time.

import { mkdir } from "node:fs/promises"
import path from "node:path"
import { PRODUCT_NAME } from "@pinetrie/core"
import type { Held, Hold } from "@pinetrie/lock"
import { answer, type Serving } from "./answer.ts"
import { type ProjectDisks, projectDisks } from "./layout.ts"
import type { LanehostCall } from "./protocol.ts"

/** The lock's file, in the project's directory. */
export const HOST_LOCK = "host.lock"

/** Why a server serves nothing, as its client's error says it. */
export function lockRefusal(hold: Exclude<Hold, Held>): string {
  switch (hold.kind) {
    case "held-by-another":
      return `another ${PRODUCT_NAME} host serves this project's lanes, or one that stopped is finishing its last step: stop it, or start again shortly`
    case "failed":
      return `this project's lanes could not be locked to this host: ${hold.detail}`
  }
}

/** What starting a server does, as ports: the server's script gives the real ones. */
export interface ServingPorts {
  hold(file: string): Promise<Hold>
  drop(held: Held, disks: ProjectDisks): Promise<unknown>
  /** Answer calls with `answer`, the hello saying `refused`. */
  serve(
    refused: string | null,
    answer: (call: LanehostCall) => Promise<unknown>,
  ): void
  /** The lock went with its child: the server must stop. */
  lost(): void
}

/**
 * Serve `serving`. A server that holds a project's lock takes it before it
 * answers anything, and drops the project's `.tmp` snapshots once it holds
 * it; one that holds none (a one-shot, another role) serves at once.
 */
export async function startServing(
  serving: Serving,
  ports: ServingPorts,
): Promise<void> {
  const answerCall = (call: LanehostCall) => answer(call, serving)
  if (serving.holds === null) return ports.serve(null, answerCall)
  const disks = projectDisks(serving.lanesDir, serving.holds)
  await mkdir(disks.dir, { recursive: true })
  const hold = await ports.hold(path.join(disks.dir, HOST_LOCK))
  if (hold.kind !== "held") {
    const refused = lockRefusal(hold)
    return ports.serve(refused, async () => {
      throw new Error(refused)
    })
  }
  void hold.lost.then(() => ports.lost())
  // One left is dropped at the next start: no reason to refuse calls now.
  await ports.drop(hold, disks).catch(() => {})
  ports.serve(null, answerCall)
}
