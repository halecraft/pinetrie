// pi/lane-helper — the guest side of a lane's channel.
//
// The host starts this once per running lane, through its runtime's
// `docker exec -i` (`helperCommand`):
// `<runtime loader> … node /pinetrie/packages/pi/lane-helper.ts`. It serves
// `lane-protocol.ts`'s calls over `@pinetrie/channel`:
// - pi's own `NodeExecutionEnv`, so pi's tools run in the lane unchanged.
//   Every `exec` is a run, launched with its number in its environment
//   (`observer.ts`); its events reach the host from the machine's observer;
// - `run` calls, the host's own jj and git, with no shell (`runCommand`),
//   never runs: they are pine·trie's, not a tool call's;
// - `runs`, what this helper knows of its runs since the last drain: each
//   launched, with its command; the write tools' paths, and
//   the read and write tools' accesses of shared files (`LaneDrain`);
//   `present`, which paths exist, for the host's fold; `hashes`, cached by
//   stamp; `checkRecipes`; and `firstSymlinks`, for `git check-ignore`.
// - `observerRelay`: the machine's observer served at `OBSERVER_SOCKET` to a
//   host inside the lane while the host relays it (`observer.ts`).
// Calls are handled concurrently: pi runs a turn's tool calls in parallel
// (`toolExecution` defaults to `"parallel"`). `{ abort }` cancels one.
//
// It runs on the lane runtime's Node through its bundled loader, so
// `process.execPath` is the loader, not Node: nothing here may re-execute
// it. The host closes the channel by ending stdin: killing the `exec`
// process does not reach the guest.

import { createHash } from "node:crypto"
import { createReadStream, lstatSync, mkdirSync } from "node:fs"
import { lstat } from "node:fs/promises"
import path from "node:path"
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/pi-agent-core/harness/context"
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import { runCommand, serve } from "@pinetrie/channel"
import {
  type FileHashes,
  isUnderAny,
  LANE_HOME,
  type LaneDrain,
  OBSERVER_SOCKET,
  type Recipe,
  type RecipeCheck,
  SHARED_ENV,
  type SharedAccess,
  type Stamp,
  statStamp,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import { checkRecipe } from "@pinetrie/rules"
import {
  type EnvMethod,
  isEnvMethod,
  type LaneCall,
  type LaneHello,
  type RelayReply,
} from "./lane-protocol.ts"
import { launchOptions, serveRelay } from "./observer.ts"

const cwd = process.env.PINETRIE_WORKSPACE_ROOT ?? WORKSPACE_ROOT
const env = new NodeExecutionEnv({ cwd })

// Created here rather than by a lane step: every container start opens the
// channel before any tool runs.
if (process.env.HOME === LANE_HOME) mkdirSync(LANE_HOME, { recursive: true })

const relative = (p: string): string | null => {
  const rel = path.relative(cwd, path.resolve(cwd, p))
  return rel === "" ||
    rel === ".." ||
    rel.startsWith("../") ||
    path.isAbsolute(rel)
    ? null
    : rel
}

const shared = (process.env[SHARED_ENV] ?? "").split("\n").filter(d => d !== "")
const sharedInside = shared.flatMap(d => relative(d) ?? [])

const launched: { run: string; command: string }[] = []
const toolWrites = new Set<string>()
/** The read and write tools' accesses of shared files, as a run's events carry them. */
const toolShared: SharedAccess[] = []
/** Each tool access's own process id, below any real one, so a write's open pairs with its release. */
let toolPid = 0
/** The kernel's monotonic clock in µs, as a run's events': libuv reads CLOCK_MONOTONIC. */
const monotonicUs = () => Number(process.hrtime.bigint() / 1000n)

/**
 * Each run's number: this helper's own count, from a start no earlier
 * helper of the lane reached, since a daemon of an earlier helper's run
 * may still report under its number. Within a safe integer for 280 years.
 */
let nextRun = Date.now() * 1024
const runId = () => String(nextRun++)

const isPresent = (p: string): boolean => {
  try {
    lstatSync(path.join(cwd, p))
    return true
  } catch {
    return false
  }
}

/**
 * Each of `paths` that runs through a symlink, and the first symlink on its
 * way: `git check-ignore` refuses a whole batch over one path beyond a
 * symlink, and can be asked about the symlink instead. A path that is
 * itself a symlink is left out, and a missing directory ends the search.
 */
async function firstSymlinks(
  paths: readonly string[],
): Promise<Record<string, string>> {
  /** Per directory, within one call: a turn's paths share theirs. */
  type Kind = "link" | "other" | "missing"
  const kinds = new Map<string, Promise<Kind>>()
  const dirKind = (dir: string): Promise<Kind> => {
    const known = kinds.get(dir)
    if (known !== undefined) return known
    const kind = lstat(path.join(cwd, dir)).then(
      (st): Kind => (st.isSymbolicLink() ? "link" : "other"),
      (): Kind => "missing",
    )
    kinds.set(dir, kind)
    return kind
  }
  const out: Record<string, string> = {}
  for (const p of paths) {
    const segments = p.split("/")
    for (let i = 1; i < segments.length; i++) {
      const dir = segments.slice(0, i).join("/")
      const kind = await dirKind(dir)
      if (kind === "missing") break
      if (kind === "link") {
        out[p] = dir
        break
      }
    }
  }
  return out
}

/** Everything this helper knows of its runs and tools since the last drain. */
function drain(): LaneDrain {
  const writes = [...toolWrites].sort()
  toolWrites.clear()
  return {
    root: cwd,
    shared: sharedInside,
    launched: launched.splice(0),
    toolWrites: writes,
    toolShared: toolShared.splice(0),
  }
}

/**
 * A file's stamp, in core's form (`statStamp`), as a run's events carry it:
 * a recipe that read a shared file holds while the two agree. Null for no
 * regular file.
 */
async function fileStamp(p: string): Promise<Stamp | null> {
  const st = await lstat(path.join(cwd, p), { bigint: true }).catch(() => null)
  return st?.isFile() ? statStamp(st) : null
}

/** sha256 of each file, cached by its stamp. */
const hashCache = new Map<string, { stamp: Stamp; hash: string }>()
async function hashes(paths: readonly string[]): Promise<FileHashes> {
  const out: Record<string, string | null> = {}
  for (const p of paths) {
    const at = path.join(cwd, p)
    const version = await fileStamp(p)
    if (version === null) {
      out[p] = null
      continue
    }
    const cached = hashCache.get(p)
    if (cached?.stamp === version) {
      out[p] = cached.hash
      continue
    }
    const hash = await new Promise<string | null>(resolve => {
      const h = createHash("sha256")
      createReadStream(at)
        .on("data", d => h.update(d))
        .on("end", () => resolve(h.digest("hex")))
        .on("error", () => resolve(null))
    })
    if (hash !== null) hashCache.set(p, { stamp: version, hash })
    out[p] = hash
  }
  return out
}

/** Each recipe's key against the disk now, its inputs hashed by stamp. */
async function checkRecipes(
  recipes: readonly Recipe[],
): Promise<RecipeCheck[]> {
  const inputs = [...new Set(recipes.flatMap(r => Object.keys(r.key.inputs)))]
  const looked = [...new Set(recipes.flatMap(r => r.key.missing))]
  const sharedFiles = [
    ...new Set(recipes.flatMap(r => Object.keys(r.key.shared))),
  ]
  const now = {
    hashes: await hashes(inputs),
    present: new Set(looked.filter(isPresent)),
    stamps: Object.fromEntries(
      await Promise.all(
        sharedFiles.map(async p => [p, await fileStamp(p)] as const),
      ),
    ),
  }
  return recipes.map(r => checkRecipe(r, now))
}

/** How an environment call touches a file: it reads, writes or appends to the one at `path`. */
interface FileAccess {
  readonly kind: "read" | "write" | "append"
  readonly path: (args: readonly unknown[]) => unknown
}

const firstArg = (a: readonly unknown[]) => a[0]

/**
 * How each environment method touches a file: keyed by `EnvMethod`, so a
 * method added to the protocol must say. A rename writes its destination; a
 * removal writes nothing. `exec`'s are its run's, from its events.
 */
const FILE_ACCESS: Readonly<Record<EnvMethod, FileAccess | null>> = {
  absolutePath: null,
  joinPath: null,
  readTextFile: { kind: "read", path: firstArg },
  readTextLines: { kind: "read", path: firstArg },
  readBinaryFile: { kind: "read", path: firstArg },
  writeFile: { kind: "write", path: firstArg },
  appendFile: { kind: "append", path: firstArg },
  renameFile: { kind: "write", path: a => a[1] },
  fileInfo: null,
  listDir: null,
  canonicalPath: null,
  exists: null,
  createDir: { kind: "write", path: firstArg },
  remove: null,
  createTempDir: null,
  createTempFile: null,
  exec: null,
}

/** The file `method` touches, relative to the lane, and how; null for none, or one outside. */
const fileAccess = (method: EnvMethod, args: readonly unknown[]) => {
  const access = FILE_ACCESS[method]
  const at = access?.path(args)
  const p = typeof at === "string" ? relative(at) : null
  return access === null || p === null ? null : { kind: access.kind, path: p }
}

/** The host's answers to the relay it holds open, if it does. */
let relayReply: ((reply: RelayReply) => void) | null = null

/** The observer relayed until the host aborts the call; one relay at a time. */
async function relay(context: {
  readonly signal: AbortSignal
  readonly update: ((update: unknown) => void) | undefined
}): Promise<null> {
  const { update, signal } = context
  if (update === undefined) throw new Error("observerRelay asks for updates")
  const reply = serveRelay({ socket: OBSERVER_SOCKET, request: update, signal })
  relayReply = reply
  await new Promise<void>(resolve =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  )
  if (relayReply === reply) relayReply = null
  return null
}

serve<LaneHello, LaneCall, unknown, unknown>(
  { cwd, shared },
  async (call, context) => {
    // Before any await: the host's answers to one call arrive in order.
    if ("observerReply" in call) {
      relayReply?.(call.observerReply)
      return null
    }
    if ("observerRelay" in call) return relay(context)
    if ("run" in call)
      return runCommand(call.run, {
        cwd: call.cwd ?? cwd,
        bytes: call.bytes,
        signal: context.signal,
        ...(call.stdin == null ? {} : { stdin: call.stdin }),
      })
    if ("runs" in call) return drain()
    if ("present" in call) return call.present.filter(isPresent)
    if ("hashes" in call) return hashes(call.hashes)
    if ("firstSymlinks" in call) return firstSymlinks(call.firstSymlinks)
    if ("checkRecipes" in call) return checkRecipes(call.checkRecipes)
    if (!isEnvMethod(call.method))
      throw new Error(`${call.method} does not cross into a lane`)
    const args = [...call.args]
    const { update } = context
    const method = env[call.method] as (...a: unknown[]) => Promise<unknown>
    const signal = withAbortSignal(context.signal, BACKGROUND_CONTEXT)
    if (call.method === "exec") {
      if (update !== undefined)
        args[1] = {
          ...((args[1] as object | undefined) ?? {}),
          onUpdate: update,
        }
      const run = runId()
      launched.push({ run, command: String(args[0]) })
      args[1] = launchOptions(run, args[1] as object | undefined)
      return method.apply(env, [...args, signal])
    }
    const touched = fileAccess(call.method, args)
    if (touched === null) return method.apply(env, [...args, signal])
    const { kind, path: p } = touched
    if (kind !== "read") toolWrites.add(p)
    if (!isUnderAny(p, sharedInside))
      return method.apply(env, [...args, signal])
    const pid = --toolPid
    const before = await fileStamp(p)
    const at = monotonicUs()
    if (kind === "read") {
      // A read of a shared file: what the agent knows of it, which its later
      // writes are based on, as a run's open is.
      toolShared.push({
        path: p,
        kind: "open",
        writable: false,
        append: false,
        at,
        pid,
        stamp: before,
      })
      return method.apply(env, [...args, signal])
    }
    // A write: its stamp before and after, as a run's open and release would
    // carry them.
    const append = kind === "append"
    const result = await method.apply(env, [...args, signal])
    const after = await fileStamp(p)
    toolShared.push(
      { path: p, kind: "open", writable: true, append, at, pid, stamp: before },
      {
        path: p,
        kind: "release",
        writable: true,
        append,
        at: monotonicUs(),
        pid,
        left: { kind: "stamp", stamp: after },
      },
    )
    return result
  },
)
