// ssh/resolve — what the host's own ssh config says of a name, from
// `ssh -G`'s answer: where the broker connects, and the name ssh checks a
// host's key under. Both read the file of `Include`s `writeCombinedConfig`
// makes.

import { writeFile } from "node:fs/promises"
import path from "node:path"
import { knownHostsName } from "./lane-files.ts"
import type { SshName, SshPort } from "./names.ts"

declare const combinedBrand: unique symbol
/**
 * The file of `Include`s `ssh -G` resolves with. Only `writeCombinedConfig`
 * makes one, so nothing resolves a name before the file is written.
 */
export type CombinedConfig = string & { readonly [combinedBrand]: true }

/**
 * The combined file's text: the service config first, since ssh keeps a
 * setting's first value, then the person's. ssh reads only the last `-F`,
 * so two configs are combined by `Include`.
 */
export const combinedConfigText = (files: {
  readonly service: string | null
  readonly personal: string | null
}): string =>
  [
    ...(files.service === null ? [] : [`Include ${files.service}`]),
    ...(files.personal === null ? [] : [`Include ${files.personal}`]),
    "",
  ].join("\n")

export async function writeCombinedConfig(
  dir: string,
  text: string,
): Promise<CombinedConfig> {
  const file = path.join(dir, "combined")
  await writeFile(file, text)
  return file as CombinedConfig
}

/** What `ssh -G` says of a name, as far as the host uses it. */
export interface ResolvedHost {
  readonly hostname: string
  /** 1 to 65535. */
  readonly port: number
  readonly hostKeyAlias: string | null
  /** Null for none, which `ssh -G` prints as `none` or leaves out. */
  readonly proxyCommand: string | null
}

/**
 * `ssh -G`'s output, `keyword value` a line, the first of a keyword
 * winning; null without a host name or with a port outside 1 to 65535.
 */
export function parseResolved(text: string): ResolvedHost | null {
  const values = new Map<string, string>()
  for (const line of text.split("\n")) {
    const at = line.indexOf(" ")
    if (at <= 0) continue
    const key = line.slice(0, at)
    if (!values.has(key)) values.set(key, line.slice(at + 1).trim())
  }
  const hostname = values.get("hostname")
  const port = Number(values.get("port"))
  if (hostname === undefined || !Number.isInteger(port)) return null
  if (port < 1 || port > 65535) return null
  const command = values.get("proxycommand")
  return {
    hostname,
    port,
    hostKeyAlias: values.get("hostkeyalias") ?? null,
    proxyCommand: command === undefined || command === "none" ? null : command,
  }
}

type BrokerTarget =
  | { readonly kind: "connect"; readonly host: string; readonly port: number }
  /** The host's config runs a program for this name, which a lane may not. */
  | { readonly kind: "refused"; readonly why: "proxycommand" | "unresolved" }

/**
 * Where to connect. A `ProxyCommand` is refused: it would run on the host
 * for the lane. A `ProxyJump` is the lane's own ssh's to follow, since the
 * lane's config carries it, so the broker only ever opens a direct
 * connection.
 */
export function brokerTarget(resolved: ResolvedHost | null): BrokerTarget {
  if (resolved === null) return { kind: "refused", why: "unresolved" }
  if (resolved.proxyCommand !== null)
    return { kind: "refused", why: "proxycommand" }
  return { kind: "connect", host: resolved.hostname, port: resolved.port }
}

/**
 * The name ssh checks a host's key under: its `HostKeyAlias`, with no
 * port, else its host name, bracketed with its port off 22. `ssh -G`
 * prints both in lowercase, as ssh records them.
 */
export const checkedHostName = (resolved: ResolvedHost): string =>
  resolved.hostKeyAlias ?? knownHostsName(resolved.hostname, resolved.port)

/**
 * The argv that resolves `name` with the combined config. `port` is the
 * one the lane's ssh connects to; null leaves out `-p`, which would
 * override the config's own `Port`.
 */
export const resolveArgv = (
  config: CombinedConfig,
  name: SshName,
  port: SshPort | null,
): readonly string[] => [
  "ssh",
  "-G",
  "-F",
  config,
  ...(port === null ? [] : ["-p", String(port)]),
  "--",
  name,
]
