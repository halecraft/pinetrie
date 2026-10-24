// docker/api — Docker's HTTP API over the target's socket: a call costs about
// 0.2 ms, where the CLI's own start costs 11–13 ms. The CLI stays for
// what streams or builds (`buildx build`, `exec -i` and `runInImage`), but
// for the events stream, a `GET` whose body never ends.

import { readFile } from "node:fs/promises"
import http from "node:http"
import { parseSize } from "@pinetrie/core"
import { SERVICES_CGROUP } from "@pinetrie/lanehost"
import type { ContainerFacts } from "@pinetrie/lanes"
import { SPEC_LABEL } from "@pinetrie/lanes"
import {
  CONTAINER_LIMITS,
  type ContainerLimits,
  type ContainerSpec,
  type Listed,
  type ListedImage,
  OBSERVER_GRANT,
  systemTimeNanos,
} from "./plan.ts"
import type { DockerTarget } from "./target.ts"

export interface Answered {
  readonly status: number
  readonly body: string
}

/**
 * One request to Docker's API at the target's socket, on a connection of
 * its own: the socket is local, so keeping one buys nothing, and one the
 * lane VM's proxy reset would be used again.
 */
export function request(
  target: Pick<DockerTarget, "socket">,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Answered> {
  const data = body === undefined ? undefined : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: target.socket,
        agent: false,
        method,
        path,
        headers:
          data === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
              },
      },
      res => {
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => {
          text += chunk
        })
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: text }),
        )
        res.on("error", reject)
      },
    )
    req.on("error", reject)
    if (data !== undefined) req.write(data)
    req.end()
  })
}

/** A connection that ended under a request: reset, closed to a write, or closed before an answer. */
function isConnectionDropped(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const { code } = error as NodeJS.ErrnoException
  return (
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    error.message === "socket hang up"
  )
}

/**
 * `request`, for one that changes nothing when repeated (a list, an
 * inspect, a stop, a wait, a start, a removal): tried once more when its
 * connection dropped, as the lane VM's proxy drops some just after the VM
 * boots. The second try's error is the one thrown.
 */
export async function requestRetried(
  target: Pick<DockerTarget, "socket">,
  method: "GET" | "POST" | "DELETE",
  path: string,
): Promise<Answered> {
  try {
    return await request(target, method, path)
  } catch (error) {
    if (!isConnectionDropped(error)) throw error
    return request(target, method, path)
  }
}

/** The events the host follows: a container's kill for memory, and nothing else. */
const OOM_EVENTS = JSON.stringify({ type: ["container"], event: ["oom"] })

/**
 * Docker's events from `since` (`eventsSince`), replayed from its ring and
 * then as they come, each line to `onLine`. `ended` resolves when the
 * stream ends or fails, never rejecting. Its socket is unref'd: a stream
 * held for the host's life must not keep the host from exiting.
 */
export function followEvents(
  target: Pick<DockerTarget, "socket">,
  since: string,
  onLine: (line: string) => void,
): { readonly ended: Promise<void>; close(): void } {
  let req: http.ClientRequest | null = null
  const ended = new Promise<void>(resolve => {
    req = http.request(
      {
        socketPath: target.socket,
        method: "GET",
        path: `/events?since=${since}&filters=${at(OOM_EVENTS)}`,
      },
      res => {
        if (res.statusCode !== 200) {
          res.resume()
          resolve()
          return
        }
        let rest = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => {
          const lines = (rest + chunk).split("\n")
          rest = lines.pop() ?? ""
          for (const line of lines) if (line !== "") onLine(line)
        })
        res.on("close", () => resolve())
        res.on("error", () => resolve())
      },
    )
    req.on("error", () => resolve())
    req.on("socket", socket => socket.unref())
    req.end()
  })
  return { ended, close: () => req?.destroy() }
}

/** The daemon's clock, in nanoseconds (`/info`'s `SystemTime`); null when it does not answer. */
export async function daemonTime(
  target: Pick<DockerTarget, "socket">,
): Promise<bigint | null> {
  const answered = await request(target, "GET", "/info").catch(() => null)
  if (answered === null || !ok(answered)) return null
  try {
    const info = JSON.parse(answered.body) as { SystemTime?: unknown }
    return typeof info.SystemTime === "string"
      ? systemTimeNanos(info.SystemTime)
      : null
  } catch {
    return null
  }
}

/** Docker's own words for a failed request: its `message`, else the body. */
export function apiMessage(answered: Answered): string {
  try {
    const parsed = JSON.parse(answered.body) as { message?: unknown }
    if (typeof parsed.message === "string") return parsed.message
  } catch {}
  return answered.body.trim() || `status ${answered.status}`
}

const ok = (a: Answered) => a.status >= 200 && a.status < 300

/** Whether a container's create was refused because its image is not here. */
export const isCreateRefusedForMissingImage = (answered: Answered): boolean =>
  answered.status === 404 && /no such image/i.test(apiMessage(answered))

/**
 * Whether an image's removal needs nothing more: done, gone already (404), or
 * refused because a container uses it (409). The last two happen when another
 * host acted after the listing the removal was planned from.
 */
export const isImageRemovalSettled = (answered: Answered): boolean =>
  ok(answered) || answered.status === 404 || answered.status === 409

/** `request`, throwing a failure as an error naming what was asked. */
async function requestOrThrow(
  target: Pick<DockerTarget, "socket">,
  what: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Answered> {
  const answered = await request(target, method, path, body)
  if (!ok(answered)) throw new Error(`${what}: ${apiMessage(answered)}`)
  return answered
}

const at = (name: string) => encodeURIComponent(name)

/** A container's memory limit in bytes; throws on one that is no size. */
export function memoryBytes(memory: string): number {
  const bytes = parseSize(memory)
  if (bytes === null) throw new Error(`not an amount of memory: ${memory}`)
  return bytes
}

/**
 * `POST /containers/create`'s body for `spec`. `seccomp=<path>` becomes the
 * profile's content, which the CLI would read from the file, and
 * `systempaths=unconfined` empties the masked and read-only paths, which is
 * what the CLI turns it into. Its process count, CPU share and OOM priority
 * are its kind's (`CONTAINER_LIMITS`); a service goes under the services'
 * parent only where the target has one.
 */
export function createBody(
  spec: ContainerSpec,
  profileOf: (path: string) => string,
  target: Pick<DockerTarget, "hasServicesParent">,
): Record<string, unknown> {
  const unconfined = spec.securityOpt.includes("systempaths=unconfined")
  const securityOpt = spec.securityOpt
    .filter(o => o !== "systempaths=unconfined")
    .map(o =>
      o.startsWith("seccomp=") && o !== "seccomp=unconfined"
        ? `seccomp=${profileOf(o.slice("seccomp=".length))}`
        : o,
    )
  const limits: ContainerLimits = CONTAINER_LIMITS[spec.kind]
  return {
    Image: spec.image,
    Cmd: spec.cmd,
    ...(spec.hostname === null ? {} : { Hostname: spec.hostname }),
    ...(spec.workingDir === null ? {} : { WorkingDir: spec.workingDir }),
    Env: spec.env,
    Labels: spec.labels,
    HostConfig: {
      Init: true,
      NetworkMode: spec.network,
      Memory: memoryBytes(spec.memory),
      // `memory.high` has no field, `MemoryReservation` protects nothing
      // under Docker's own parent, and `io.weight` does nothing under the
      // lane VM's disk's scheduler: none is set.
      PidsLimit: limits.processesMax,
      CpuShares: limits.cpuShares,
      OomScoreAdj: limits.oomScoreAdj,
      ...(limits.parent === "services" && target.hasServicesParent
        ? { CgroupParent: `/${SERVICES_CGROUP}` }
        : {}),
      Mounts: spec.mounts.map(m => ({
        Type: "bind",
        Source: m.source,
        Target: m.target,
        ReadOnly: m.readonly,
      })),
      CapAdd: spec.capAdd,
      CapDrop: spec.capDrop,
      SecurityOpt: securityOpt,
      Devices: spec.devices.map(d => ({
        PathOnHost: d,
        PathInContainer: d,
        CgroupPermissions: "rwm",
      })),
      ...(unconfined ? { MaskedPaths: [], ReadonlyPaths: [] } : {}),
      // The observer's alone: the loader reads the machine's pids.
      ...(spec.kind === "observer"
        ? {
            PidMode: "host",
            ReadonlyRootfs: true,
            AutoRemove: true,
            Tmpfs: Object.fromEntries(OBSERVER_GRANT.tmpfs.map(t => [t, ""])),
          }
        : {}),
    },
  }
}

/** The image's name and tag, for a pull: `alpine:3.23` → `alpine`, `3.23`. */
function imageRef(image: string): { from: string; tag: string } {
  const slash = image.lastIndexOf("/")
  const colon = image.lastIndexOf(":")
  return colon > slash
    ? { from: image.slice(0, colon), tag: image.slice(colon + 1) }
    : { from: image, tag: "latest" }
}

/**
 * Make the container `spec` names, then start it. An image not here is built
 * by `buildMissing` when it knows how (it answers true), else pulled.
 */
export async function runContainer(
  target: Pick<DockerTarget, "socket" | "hasServicesParent">,
  spec: ContainerSpec,
  buildMissing: (image: string) => Promise<boolean> = async () => false,
): Promise<Answered> {
  const profiles = new Map<string, string>()
  for (const o of spec.securityOpt)
    if (o.startsWith("seccomp=") && o !== "seccomp=unconfined") {
      const file = o.slice("seccomp=".length)
      profiles.set(file, await readFile(file, "utf8"))
    }
  const body = createBody(spec, file => profiles.get(file) ?? "", target)
  const path = `/containers/create?name=${at(spec.name)}`
  let made = await request(target, "POST", path, body)
  if (isCreateRefusedForMissingImage(made)) {
    if (!(await buildMissing(spec.image))) {
      const { from, tag } = imageRef(spec.image)
      await requestOrThrow(
        target,
        `pulling ${spec.image}`,
        "POST",
        `/images/create?fromImage=${at(from)}&tag=${at(tag)}`,
      )
    }
    made = await request(target, "POST", path, body)
  }
  if (!ok(made)) return made
  return request(target, "POST", `/containers/${at(spec.name)}/start`)
}

/** A container's state and spec label; missing when it is not there. */
export async function inspectContainer(
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<ContainerFacts> {
  const answered = await requestRetried(
    target,
    "GET",
    `/containers/${at(name)}/json`,
  )
  if (!ok(answered)) return { state: "missing", label: null }
  try {
    const found = JSON.parse(answered.body) as {
      State?: { Running?: boolean }
      Config?: { Labels?: Record<string, unknown> | null }
    }
    const value = found.Config?.Labels?.[SPEC_LABEL]
    return {
      state: found.State?.Running === true ? "running" : "stopped",
      label: typeof value === "string" ? value : null,
    }
  } catch {
    return { state: "missing", label: null }
  }
}

/**
 * A running container's first process, in the pid namespace of Docker's
 * machine; null when it is not running.
 */
export async function containerPid(
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<number | null> {
  const answered = await request(target, "GET", `/containers/${at(name)}/json`)
  if (!ok(answered)) return null
  try {
    const pid = (JSON.parse(answered.body) as { State?: { Pid?: unknown } })
      .State?.Pid
    return typeof pid === "number" && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/** Start a container; one already running is fine. */
export async function startContainer(
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<Answered> {
  const answered = await requestRetried(
    target,
    "POST",
    `/containers/${at(name)}/start`,
  )
  if (!ok(answered) && answered.status !== 304)
    throw new Error(`docker start ${name}: ${apiMessage(answered)}`)
  return answered
}

/**
 * Stop a container: `SIGTERM`, then `SIGKILL` after `timeoutSeconds` (0 kills
 * at once); a missing or stopped one is fine.
 */
export const stopContainer = (
  target: Pick<DockerTarget, "socket">,
  name: string,
  timeoutSeconds: number,
): Promise<Answered> =>
  requestRetried(
    target,
    "POST",
    `/containers/${at(name)}/stop?t=${timeoutSeconds}`,
  )

/**
 * Settles once the container is not running: at once for one stopped, and a
 * missing one (404) is settled too. Any other answer throws.
 */
export async function waitContainer(
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<void> {
  const answered = await requestRetried(
    target,
    "POST",
    `/containers/${at(name)}/wait?condition=not-running`,
  )
  if (!ok(answered) && answered.status !== 404)
    throw new Error(`docker wait ${name} failed: ${apiMessage(answered)}`)
}

/** Remove a container, running or not; a missing one is fine. */
export const removeContainer = (
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<Answered> =>
  requestRetried(target, "DELETE", `/containers/${at(name)}?force=true`)

/** Every container carrying `label` (`k` or `k=v`), running or not. */
export async function listLabelled(
  target: Pick<DockerTarget, "socket">,
  label: string,
): Promise<readonly Listed[]> {
  const filters = at(JSON.stringify({ label: [label] }))
  const answered = await requestRetried(
    target,
    "GET",
    `/containers/json?all=true&filters=${filters}`,
  )
  return ok(answered) ? parseListed(answered.body) : []
}

/** The container named `name` exactly, as listed; none when there is none. */
export async function listNamed(
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<readonly Listed[]> {
  // Docker matches `name` as a regular expression against `/<name>`: anchored, one container.
  const filters = at(JSON.stringify({ name: [`^/${name}$`] }))
  const answered = await request(
    target,
    "GET",
    `/containers/json?all=true&filters=${filters}`,
  )
  return ok(answered) ? parseListed(answered.body) : []
}

/** The API's container list as `Listed`; an answer that is not one lists nothing. */
export function parseListed(body: string): readonly Listed[] {
  try {
    const rows = JSON.parse(body) as {
      Id?: string
      State?: string
      Names?: string[]
      Labels?: Record<string, string> | null
      Mounts?: { Source?: string }[] | null
    }[]
    return rows.flatMap(r => {
      const name = r.Names?.[0]?.replace(/^\//, "")
      if (name === undefined) return []
      const binds = (r.Mounts ?? []).flatMap(m =>
        typeof m.Source === "string" ? [m.Source] : [],
      )
      return [
        {
          id: r.Id ?? "",
          name,
          state: r.State ?? "",
          labels: r.Labels ?? {},
          binds,
        },
      ]
    })
  } catch {
    return []
  }
}

export const imageExists = async (
  target: Pick<DockerTarget, "socket">,
  tag: string,
): Promise<boolean> =>
  ok(await request(target, "GET", `/images/${at(tag)}/json`))

/** Every image, with its tags; an answer that is not a list lists nothing. */
export async function listImages(
  target: Pick<DockerTarget, "socket">,
): Promise<readonly ListedImage[]> {
  const answered = await request(target, "GET", "/images/json")
  return ok(answered) ? parseImages(answered.body) : []
}

/** The API's image list as `ListedImage`s. */
export function parseImages(body: string): readonly ListedImage[] {
  try {
    const rows = JSON.parse(body) as {
      Id?: unknown
      RepoTags?: unknown[] | null
    }[]
    return rows.flatMap(r =>
      typeof r.Id === "string"
        ? [
            {
              id: r.Id,
              tags: (r.RepoTags ?? []).filter(
                (t): t is string => typeof t === "string",
              ),
            },
          ]
        : [],
    )
  } catch {
    return []
  }
}

/**
 * The image ids every container, running or stopped, was made from. Null when
 * Docker does not answer with a list: then nothing may be removed, since any
 * image could be in use.
 */
export async function containerImageIds(
  target: Pick<DockerTarget, "socket">,
): Promise<ReadonlySet<string> | null> {
  const answered = await request(target, "GET", "/containers/json?all=true")
  if (!ok(answered)) return null
  try {
    const rows = JSON.parse(answered.body) as { ImageID?: unknown }[]
    return new Set(
      rows.flatMap(r => (typeof r.ImageID === "string" ? [r.ImageID] : [])),
    )
  } catch {
    return null
  }
}

/** Remove one tag, without force: Docker refuses one a container uses. */
export const removeImage = (
  target: Pick<DockerTarget, "socket">,
  tag: string,
): Promise<Answered> => request(target, "DELETE", `/images/${at(tag)}`)

/** An image's own environment (`Config.Env`); throws when it is not here. */
export async function imageEnv(
  target: Pick<DockerTarget, "socket">,
  tag: string,
): Promise<readonly string[] | null> {
  const answered = await requestOrThrow(
    target,
    `docker image inspect ${tag}`,
    "GET",
    `/images/${at(tag)}/json`,
  )
  const found = JSON.parse(answered.body) as {
    Config?: { Env?: string[] | null }
  }
  return found.Config?.Env ?? null
}

export const networkExists = async (
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<boolean> => ok(await request(target, "GET", `/networks/${at(name)}`))

/** Make a network with labels; returns the response, which may say it exists. */
export const createNetwork = (
  target: Pick<DockerTarget, "socket">,
  name: string,
  labels: Readonly<Record<string, string>>,
): Promise<Answered> =>
  request(target, "POST", "/networks/create", { Name: name, Labels: labels })

/** A network's first subnet, as a CIDR; throws when it is not here. */
export async function networkSubnet(
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<string> {
  const answered = await requestOrThrow(
    target,
    `docker network inspect ${name}`,
    "GET",
    `/networks/${at(name)}`,
  )
  const found = JSON.parse(answered.body) as {
    IPAM?: { Config?: { Subnet?: string }[] | null }
  }
  return found.IPAM?.Config?.[0]?.Subnet ?? ""
}

/** Remove a network; a missing one is fine. */
export const removeNetwork = (
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<Answered> => request(target, "DELETE", `/networks/${at(name)}`)

/** `docker info`'s cgroup driver (`cgroupfs`, `systemd`, `none`); null when it does not say. */
export async function cgroupDriver(
  target: Pick<DockerTarget, "socket">,
): Promise<string | null> {
  const answered = await request(target, "GET", "/info")
  if (!ok(answered)) return null
  try {
    const found = JSON.parse(answered.body) as { CgroupDriver?: unknown }
    return typeof found.CgroupDriver === "string" ? found.CgroupDriver : null
  } catch {
    return null
  }
}

/** `docker info`'s security options. */
export async function securityOptions(
  target: Pick<DockerTarget, "socket">,
): Promise<readonly string[]> {
  const answered = await request(target, "GET", "/info")
  if (!ok(answered)) return []
  try {
    const found = JSON.parse(answered.body) as { SecurityOptions?: unknown }
    return Array.isArray(found.SecurityOptions)
      ? found.SecurityOptions.filter((o): o is string => typeof o === "string")
      : []
  } catch {
    return []
  }
}
