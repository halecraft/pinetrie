// docker/seccomp-nested — the seccomp profile of a lane that runs lanes:
// Docker's default, with the namespace and mount calls a user namespace
// needs allowed. `socket`'s rules are the default's, so AF_VSOCK stays
// refused.
//
//   node packages/docker/seccomp-nested.ts          rewrite seccomp-nested.json
//   node packages/docker/seccomp-nested.ts --fetch  fetch the default at UPSTREAM first

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

/** `moby/profiles`' default, at the commit `seccomp-default.json` was fetched from. */
const UPSTREAM =
  "https://raw.githubusercontent.com/moby/profiles/6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef/seccomp/default.json"

/** The calls a user namespace, its mounts and rootless Docker need. */
export const NESTED_CALLS = [
  "clone",
  "clone3",
  "unshare",
  "setns",
  "mount",
  "umount",
  "umount2",
  "mount_setattr",
  "move_mount",
  "open_tree",
  "fsconfig",
  "fsmount",
  "fsopen",
  "fspick",
  "pivot_root",
  "sethostname",
  "setdomainname",
] as const

export interface Rule {
  readonly names: readonly string[]
  readonly action: string
  readonly args?: readonly unknown[]
  readonly includes?: { readonly caps?: readonly string[] }
  readonly excludes?: { readonly caps?: readonly string[] }
  readonly [key: string]: unknown
}

export interface Profile {
  readonly syscalls: readonly Rule[]
  readonly [key: string]: unknown
}

/**
 * The rules that refuse `clone` with namespace flags, and `clone3`, to a
 * container without `CAP_SYS_ADMIN`: allowed with an argument mask, or
 * refused outright, only when that capability is excluded.
 */
const refusesNamespaces = (r: Rule): boolean =>
  r.names.length === 1 &&
  (r.names[0] === "clone" || r.names[0] === "clone3") &&
  (r.excludes?.caps ?? []).includes("CAP_SYS_ADMIN")

/** The default profile, without the clone rules, with one rule allowing `NESTED_CALLS`. */
export function nestedProfile(base: Profile): Profile {
  return {
    ...base,
    syscalls: [
      ...base.syscalls.filter(r => !refusesNamespaces(r)),
      {
        names: [...NESTED_CALLS],
        action: "SCMP_ACT_ALLOW",
        comment:
          "pine·trie: a lane that runs lanes makes user namespaces and mounts in them",
      },
    ],
  }
}

const here = import.meta.dirname
export const NESTED_PROFILE = path.join(here, "seccomp-nested.json")
const DEFAULT_PROFILE = path.join(here, "seccomp-default.json")

if (import.meta.filename === process.argv[1]) {
  if (process.argv.includes("--fetch")) {
    const res = await fetch(UPSTREAM)
    if (!res.ok) throw new Error(`${UPSTREAM}: ${res.status}`)
    await writeFile(DEFAULT_PROFILE, await res.text())
  }
  const base = JSON.parse(await readFile(DEFAULT_PROFILE, "utf8")) as Profile
  await writeFile(
    NESTED_PROFILE,
    `${JSON.stringify(nestedProfile(base), null, 2)}\n`,
  )
}
