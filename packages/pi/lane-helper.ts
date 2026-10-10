// pi/lane-helper — the guest side of a lane's channel (ADR-0034, S43, S44).
//
// The host starts this once per running lane, through its runtime's
// `docker exec -i` (`helperCommand`):
// `<runtime loader> … node /pinetrie/packages/pi/lane-helper.ts`. It serves
// `lane-protocol.ts`'s calls over `@pinetrie/channel`:
// - pi's own `NodeExecutionEnv`, so pi's tools run in the lane unchanged;
// - `run` calls, the host's own jj and git, with no shell (`runCommand`).
// Calls are handled concurrently: pi runs a turn's tool calls in parallel
// (`toolExecution` defaults to `"parallel"`). `{ abort }` cancels one.
//
// It runs on the lane runtime's Node through its bundled loader, so
// `process.execPath` is the loader, not Node (S44 item 2): nothing here may
// re-execute it. The host closes the channel by ending stdin: killing the
// `exec` process does not reach the guest (S43 item 2).

import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/pi-agent-core/harness/context"
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import { runCommand, serve } from "@pinetrie/channel"
import { WORKSPACE_ROOT } from "@pinetrie/core"
import { isEnvMethod, type LaneCall, type LaneHello } from "./lane-protocol.ts"

const cwd = process.env.PINETRIE_WORKSPACE_ROOT ?? WORKSPACE_ROOT
const env = new NodeExecutionEnv({ cwd })

serve<LaneHello, LaneCall, unknown, unknown>({ cwd }, async (call, context) => {
  if ("run" in call)
    return runCommand(call.run, {
      cwd: call.cwd ?? cwd,
      bytes: call.bytes,
      signal: context.signal,
    })
  if (!isEnvMethod(call.method))
    throw new Error(`${call.method} does not cross into a lane`)
  const args = [...call.args]
  const { update } = context
  if (call.method === "exec" && update !== undefined)
    args[1] = { ...((args[1] as object | undefined) ?? {}), onUpdate: update }
  const method = env[call.method] as (...a: unknown[]) => Promise<unknown>
  return method.apply(env, [
    ...args,
    withAbortSignal(context.signal, BACKGROUND_CONTEXT),
  ])
})
