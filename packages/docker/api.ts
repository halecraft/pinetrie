// docker/api — Docker's HTTP API over the target's socket: a call costs about
// 0.2 ms, where the CLI's own start costs 11–13 ms. The CLI stays for
// what streams or builds: `buildx build`, `exec -i` and `runInImage`.

import { readFile } from "node:fs/promises"
import http from "node:http"
import type { ContainerFacts } from "@pinetrie/lanes"
import { SPEC_LABEL } from "@pinetrie/lanes"
import type { ContainerSpec, Listed } from "./plan.ts"
import type { DockerTarget } from "./target.ts"

export interface Answered {
  readonly status: number
  readonly body: string
}

/** One request to Docker's API at the target's socket. */
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

/** Docker's own words for a failed request: its `message`, else the body. */
export function apiMessage(answered: Answered): string {
  try {
    const parsed = JSON.parse(answered.body) as { message?: unknown }
    if (typeof parsed.message === "string") return parsed.message
  } catch {}
  return answered.body.trim() || `status ${answered.status}`
}

const ok = (a: Answered) => a.status >= 200 && a.status < 300

/** `request`, throwing a failure as an error naming what was asked. */
async function requestOrThrow(
  target: Pick<DockerTarget, "socket">,
  what: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  alsoFine: readonly number[] = [],
): Promise<Answered> {
  const answered = await request(target, method, path, body)
  if (!ok(answered) && !alsoFine.includes(answered.status))
    throw new Error(`${what}: ${apiMessage(answered)}`)
  return answered
}

const at = (name: string) => encodeURIComponent(name)

/** `4G`, `256m`, `1g` in bytes, as the CLI reads `-m`: units of 1024. */
export function memoryBytes(memory: string): number {
  const found = /^(\d+(?:\.\d+)?)\s*([bkmgt]?)b?$/i.exec(memory.trim())
  if (found === null) throw new Error(`not an amount of memory: ${memory}`)
  const power = "bkmgt".indexOf((found[2] || "b").toLowerCase())
  return Math.floor(Number(found[1]) * 1024 ** power)
}

/**
 * `POST /containers/create`'s body for `spec`. `seccomp=<path>` becomes the
 * profile's content, which the CLI would read from the file, and
 * `systempaths=unconfined` empties the masked and read-only paths, which is
 * what the CLI turns it into.
 */
export function createBody(
  spec: ContainerSpec,
  profileOf: (path: string) => string,
): Record<string, unknown> {
  const unconfined = spec.securityOpt.includes("systempaths=unconfined")
  const securityOpt = spec.securityOpt
    .filter(o => o !== "systempaths=unconfined")
    .map(o =>
      o.startsWith("seccomp=") && o !== "seccomp=unconfined"
        ? `seccomp=${profileOf(o.slice("seccomp=".length))}`
        : o,
    )
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
      ...(spec.machine === null
        ? {}
        : {
            PidMode: "host",
            CgroupnsMode: "host",
            ReadonlyRootfs: true,
            AutoRemove: true,
            Tmpfs: Object.fromEntries(spec.machine.tmpfs.map(t => [t, ""])),
          }),
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

/** Make the container `spec` names, then start it. An image not here is pulled first. */
export async function runContainer(
  target: Pick<DockerTarget, "socket">,
  spec: ContainerSpec,
): Promise<Answered> {
  const profiles = new Map<string, string>()
  for (const o of spec.securityOpt)
    if (o.startsWith("seccomp=") && o !== "seccomp=unconfined") {
      const file = o.slice("seccomp=".length)
      profiles.set(file, await readFile(file, "utf8"))
    }
  const body = createBody(spec, file => profiles.get(file) ?? "")
  const path = `/containers/create?name=${at(spec.name)}`
  let made = await request(target, "POST", path, body)
  if (made.status === 404 && /no such image/i.test(apiMessage(made))) {
    const { from, tag } = imageRef(spec.image)
    await requestOrThrow(
      target,
      `pulling ${spec.image}`,
      "POST",
      `/images/create?fromImage=${at(from)}&tag=${at(tag)}`,
    )
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
  const answered = await request(target, "GET", `/containers/${at(name)}/json`)
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
export const startContainer = (
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<Answered> =>
  requestOrThrow(
    target,
    `docker start ${name}`,
    "POST",
    `/containers/${at(name)}/start`,
    undefined,
    [304],
  )

/** Stop a container, as the CLI does (10 s, then killed); a missing one is fine. */
export const stopContainer = (
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<Answered> =>
  request(target, "POST", `/containers/${at(name)}/stop?t=10`)

/** Remove a container, running or not; a missing one is fine. */
export const removeContainer = (
  target: Pick<DockerTarget, "socket">,
  name: string,
): Promise<Answered> =>
  request(target, "DELETE", `/containers/${at(name)}?force=true`)

/** Every container carrying `label` (`k` or `k=v`), running or not. */
export async function listLabelled(
  target: Pick<DockerTarget, "socket">,
  label: string,
): Promise<readonly Listed[]> {
  const filters = at(JSON.stringify({ label: [label] }))
  const answered = await request(
    target,
    "GET",
    `/containers/json?all=true&filters=${filters}`,
  )
  if (!ok(answered)) return []
  try {
    const rows = JSON.parse(answered.body) as {
      Names?: string[]
      Labels?: Record<string, string> | null
    }[]
    return rows.flatMap(r => {
      const name = r.Names?.[0]?.replace(/^\//, "")
      return name === undefined ? [] : [{ name, labels: r.Labels ?? {} }]
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
