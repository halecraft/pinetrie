// ssh/resolve — what the broker does with a name, from `ssh -G`'s answer:
// the host's own config resolves it, on the host.

import type { SshName, SshPort } from "./names.ts"

type BrokerTarget =
  | { readonly kind: "connect"; readonly host: string; readonly port: number }
  /** The host's config runs a program for this name, which a lane may not. */
  | { readonly kind: "refused"; readonly why: "proxycommand" | "unresolved" }

/** `ssh -G`'s output, `keyword value` a line, as a map; the first of a keyword wins. */
export function parseResolved(text: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split("\n")) {
    const at = line.indexOf(" ")
    if (at <= 0) continue
    const key = line.slice(0, at)
    if (!out.has(key)) out.set(key, line.slice(at + 1).trim())
  }
  return out
}

/**
 * Where to connect. A `ProxyCommand` is refused: it would run on the host
 * for the lane. A `ProxyJump` is the lane's own ssh's to follow, since the
 * lane's config carries it, so the broker only ever opens a direct
 * connection.
 */
export function brokerTarget(
  resolved: ReadonlyMap<string, string>,
): BrokerTarget {
  const command = resolved.get("proxycommand")
  if (command !== undefined && command !== "none")
    return { kind: "refused", why: "proxycommand" }
  const host = resolved.get("hostname")
  const port = Number(resolved.get("port"))
  return host === undefined ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
    ? { kind: "refused", why: "unresolved" }
    : { kind: "connect", host, port }
}

/** The argv that resolves `name` with the host's combined config. */
export const resolveArgv = (
  config: string,
  name: SshName,
  port: SshPort,
): readonly string[] => [
  "ssh",
  "-G",
  "-F",
  config,
  "-p",
  String(port),
  "--",
  name,
]
