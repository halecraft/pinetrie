// pi/lane-helper — the guest side of a lane's channel (ADR-0034, S43, S44).
//
// The host starts this once per running lane, as
// `container exec -i <lane> <runtime loader> … node /pinetrie/packages/pi/lane-helper.ts`,
// and speaks `lane-protocol.ts` over its stdin and stdout. It serves:
// - pi's own `NodeExecutionEnv`, so pi's tools run in the lane unchanged;
// - `run` requests, the host's own jj and git, by `execFile` with no shell.
// Requests are handled concurrently: pi runs a turn's tool calls in parallel
// (`toolExecution` defaults to `"parallel"`). `{ abort }` cancels one.
//
// It runs on the lane runtime's Node through its bundled loader, so
// `process.execPath` is the loader, not Node (S44 item 2): nothing here may
// re-execute it. The host closes the channel by ending stdin: killing
// `container exec` does not reach the guest (S43 item 2).

import { execFile } from "node:child_process"
import readline from "node:readline"
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/pi-agent-core/harness/context"
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import { errorText, WORKSPACE_ROOT } from "@pinetrie/core"
import {
  decode,
  encode,
  isEnvMethod,
  type LaneReply,
  type LaneRequest,
  type RunResult,
} from "./lane-protocol.ts"

const cwd = process.env.PINETRIE_WORKSPACE_ROOT ?? WORKSPACE_ROOT
const env = new NodeExecutionEnv({ cwd })
const running = new Map<number, AbortController>()

const send = (reply: LaneReply) => process.stdout.write(`${encode(reply)}\n`)

function runCommand(
  argv: readonly string[],
  dir: string | null,
  bytes: boolean,
  signal: AbortSignal,
): Promise<RunResult> {
  return new Promise(resolve => {
    execFile(
      argv[0] ?? "",
      argv.slice(1),
      {
        cwd: dir ?? cwd,
        maxBuffer: 256 * 1024 * 1024,
        encoding: bytes ? "buffer" : "utf8",
        signal,
      },
      (error, stdout, stderr) => {
        const out = bytes
          ? new Uint8Array(stdout as unknown as Buffer)
          : String(stdout)
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : -1
        const err = String(stderr ?? "")
        resolve({
          code,
          stdout: out,
          stderr: error !== null && err === "" ? error.message : err,
        })
      },
    )
  })
}

async function answer(request: Exclude<LaneRequest, { abort: number }>) {
  const control = new AbortController()
  running.set(request.id, control)
  try {
    if ("run" in request) {
      send({
        id: request.id,
        result: await runCommand(
          request.run,
          request.cwd,
          request.bytes,
          control.signal,
        ),
      })
      return
    }
    if (!isEnvMethod(request.method))
      throw new Error(`${request.method} does not cross into a lane`)
    const context = withAbortSignal(control.signal, BACKGROUND_CONTEXT)
    const args = [...request.args]
    if (request.method === "exec" && request.updates)
      args[1] = {
        ...((args[1] as object | undefined) ?? {}),
        onUpdate: (update: unknown) => send({ id: request.id, update }),
      }
    const method = env[request.method] as (...a: unknown[]) => Promise<unknown>
    send({
      id: request.id,
      result: await method.apply(env, [...args, context]),
    })
  } catch (error) {
    send({
      id: request.id,
      thrown: errorText(error),
    })
  } finally {
    running.delete(request.id)
  }
}

readline
  .createInterface({ input: process.stdin })
  .on("line", line => {
    const request = decode<LaneRequest>(line)
    if ("abort" in request) running.get(request.abort)?.abort()
    else void answer(request)
  })
  // The host closed the channel: nothing still running has anyone to answer.
  .on("close", () => {
    for (const control of running.values()) control.abort()
  })
send({ ready: true, cwd })
