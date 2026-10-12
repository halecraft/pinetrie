// lanehost/grants — one project's `lanes.hostPorts` in the lane VM's
// firewall, from the privileged role on the VM's own network with
// `NET_ADMIN`: the host, which holds Docker's socket, may; a lane never can.
// Gathered (the rules jumping to the project's chain now), planned as one
// `iptables-restore` input, and applied all at once, so the chain is never
// seen half-written.

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { runCommand } from "@pinetrie/channel"
import { isProjectKey } from "./layout.ts"

/** One project's grant: ports of the host's loopback its network may reach. */
export interface Grant {
  readonly project: string
  /** The project's network, as a CIDR; empty when only its rules go. */
  readonly subnet: string
  /** Where lanes reach the host's loopback (gvproxy's host address). */
  readonly hostAddress: string
  readonly ports: readonly number[]
}

/** The firewall chain of one project's grant. */
export const grantChain = (project: string): string => `PT-${project}`

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/
const CIDR = /^(\d{1,3})(\.\d{1,3}){3}\/\d{1,2}$/

/** Throws on a grant whose values could be anything but what they say. */
function checked(grant: Grant): Grant {
  if (!isProjectKey(grant.project))
    throw new Error(`not a project's key: ${JSON.stringify(grant.project)}`)
  if (grant.subnet !== "" && !CIDR.test(grant.subnet))
    throw new Error(`not a subnet: ${JSON.stringify(grant.subnet)}`)
  if (!IPV4.test(grant.hostAddress))
    throw new Error(`not an address: ${JSON.stringify(grant.hostAddress)}`)
  if (!grant.ports.every(p => Number.isInteger(p) && p >= 1 && p <= 65535))
    throw new Error(`not ports: ${JSON.stringify(grant.ports)}`)
  if (grant.ports.length > 0 && grant.subnet === "")
    throw new Error("ports granted to no network")
  return grant
}

/**
 * The grant as one `iptables-restore --noflush` input, from the rules in
 * `DOCKER-USER` now (`iptables -S DOCKER-USER`). The project's chain is
 * declared and flushed, its jumps from `DOCKER-USER` deleted, then each
 * granted port accepted only from the project's network, to the host's
 * address, over TCP, above the VM's fence, which rejects the rest
 * (`packages/vm/image/init`). With no ports, the chain goes too.
 */
export function planGrant(grant: Grant, current: readonly string[]): string {
  const { project, subnet, hostAddress, ports } = checked(grant)
  const chain = grantChain(project)
  const stale = current
    .filter(l => l.startsWith("-A DOCKER-USER ") && l.endsWith(` -j ${chain}`))
    .map(l => `-D ${l.slice("-A ".length)}`)
  const rules =
    ports.length === 0
      ? [`-X ${chain}`]
      : [
          ...ports.map(
            p => `-A ${chain} -d ${hostAddress} -p tcp --dport ${p} -j ACCEPT`,
          ),
          `-I DOCKER-USER -s ${subnet} -j ${chain}`,
        ]
  return [
    "*filter",
    `:${chain} - [0:0]`,
    `-F ${chain}`,
    ...stale,
    ...rules,
    "COMMIT",
    "",
  ].join("\n")
}

const signal = () => new AbortController().signal

/** Gather, plan and apply a grant in this process's network namespace. */
export async function applyGrant(grant: Grant): Promise<void> {
  const listed = await runCommand(["iptables", "-S", "DOCKER-USER"], {
    cwd: "/",
    bytes: false,
    signal: signal(),
  })
  if (listed.code !== 0)
    throw new Error(`iptables -S DOCKER-USER: ${String(listed.stderr).trim()}`)
  const input = planGrant(grant, String(listed.stdout).split("\n"))
  const dir = await mkdtemp(path.join(tmpdir(), "grant-"))
  try {
    const file = path.join(dir, "rules")
    await writeFile(file, input)
    const ran = await runCommand(["iptables-restore", "--noflush", file], {
      cwd: "/",
      bytes: false,
      signal: signal(),
    })
    if (ran.code !== 0)
      throw new Error(`iptables-restore: ${String(ran.stderr).trim()}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
