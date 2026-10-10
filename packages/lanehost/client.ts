// lanehost/client — the host's side of lanehost: one held channel per role,
// opened on its first call, each call sent to the role that serves its
// module (S147: a message instead of a `docker exec` per call). How a role's
// channel is opened is the runtime's (`open`): lanehost knows nothing of
// Docker.

import type { Channel } from "@pinetrie/channel"
import type { LanehostCall, LanehostHello, LanehostResult } from "./protocol.ts"
import { moduleOf, planRoles, type Role, type RoleFacts } from "./roles.ts"

export type LanehostChannel = Channel<
  LanehostHello,
  LanehostCall,
  never,
  unknown
>

export interface Lanehost {
  call<C extends LanehostCall>(call: C): Promise<LanehostResult<C>>
  /** Close every channel: the next call opens one again. */
  reset(): void
}

/** The words of a call in the log: its kind, and a disk operation's. */
const callWords = (call: LanehostCall): string =>
  call.kind === "disk" ? `disk ${call.op.kind}` : call.kind

export function lanehostClient(input: {
  /** A role's channel, its container made first if need be. */
  readonly open: (role: Role) => Promise<LanehostChannel>
  /** What the machine grants, asked once. */
  readonly facts: () => Promise<RoleFacts>
  readonly log?: (line: string) => void
}): Lanehost {
  const open = new Map<Role, Promise<LanehostChannel>>()
  let roles: Promise<ReadonlyMap<string, Role>> | null = null

  function channelOf(role: Role): Promise<LanehostChannel> {
    const held = open.get(role)
    if (held !== undefined) return held
    const opening = input.open(role).then(async channel => {
      // A channel that ends is opened again at the next call.
      void channel.closed.then(() => {
        if (open.get(role) === opening) open.delete(role)
      })
      await channel.ready
      return channel
    })
    open.set(role, opening)
    opening.catch(() => {
      if (open.get(role) === opening) open.delete(role)
    })
    return opening
  }

  async function roleOf(call: LanehostCall): Promise<Role> {
    roles ??= input.facts().then(planRoles)
    roles.catch(() => {
      roles = null
    })
    const role = (await roles).get(moduleOf(call))
    if (role === undefined) throw new Error(`no role serves ${call.kind}`)
    return role
  }

  return {
    async call(call) {
      const role = await roleOf(call)
      const started = performance.now()
      let ok = false
      try {
        const result = (await (
          await channelOf(role)
        ).call(call)) as LanehostResult<typeof call>
        ok = true
        return result
      } finally {
        input.log?.(
          `[lanehost] ${role} ${callWords(call)} ${(performance.now() - started).toFixed(1)} ms${ok ? "" : " failed"}`,
        )
      }
    },
    reset() {
      for (const opening of open.values())
        void opening.then(channel => channel.close()).catch(() => {})
      open.clear()
      roles = null
    },
  }
}
