// host/settings — every setting the host reads, declared once, with the
// layers that may set it and how they combine (`@pinetrie/config`). Nothing
// else reads a config file. The packages that decide from a setting (ssh,
// lanes, jj, rules) take its settled value, typed; their value parsers are
// what the kinds here wrap, so no check is written twice.

import path from "node:path"
import {
  type ConfigReport,
  choice,
  count,
  type DecodedProject,
  decoded,
  decodeProject,
  defineTable,
  type FileRead,
  flag,
  hostCode,
  join,
  type LayerValues,
  limited,
  list,
  pick,
  projectCopy,
  type Refusal,
  readConfigFile,
  record,
  refused,
  type Settled,
  type StartLayers,
  settle,
  shaped,
  text,
} from "@pinetrie/config"
import {
  type ConfigLayer,
  ICON_SOURCES,
  PROJECT_CONFIG_FILE,
  type RepoConfig,
  type WriterId,
  writerOfPrincipal,
} from "@pinetrie/core"
import { DEFAULT_REPO, isBookmarkName } from "@pinetrie/jj"
import {
  DEFAULT_VM_SLOTS,
  isEnvName,
  type LaneAuthority,
  MAX_VM_SLOTS,
  parseMount,
  parsePort,
} from "@pinetrie/lanes"
import type { ListedFolder } from "@pinetrie/pi"
import {
  DEFAULT_BUDGET,
  DEFAULT_QUOTE_BYTES,
  type IconConfig,
  iconConfig,
  isCommandLabel,
  type ModelRef,
  modelRef,
  type TitleConfig,
} from "@pinetrie/rules"
import {
  DEFAULT_APPROVAL_SECONDS,
  type HostPatterns,
  MAX_APPROVAL_SECONDS,
  MIN_APPROVAL_SECONDS,
  type PersonalChoice,
  parseHostPatterns,
} from "@pinetrie/ssh"

// ── kinds ────────────────────────────────────────────────────────────────

const model = shaped<ModelRef | null>(json => {
  const ref = modelRef(json)
  return ref === undefined ? refused("is not provider/id") : decoded(ref)
})

const email = shaped<WriterId | null>(json => {
  const writer = typeof json === "string" ? writerOfPrincipal(json) : undefined
  return writer === undefined ? refused("is not an email") : decoded(writer)
})

const bookmark = text(
  s => (isBookmarkName(s) ? s : null),
  "is not a bookmark name",
)

/** An absolute path, or one inside the project, which never leaves it. */
const listedPath = text(
  s =>
    s !== "" &&
    (path.isAbsolute(s) || !path.posix.normalize(s).split("/").includes(".."))
      ? s
      : null,
  "is not an absolute path, nor one inside the project",
)

const absolutePath = text(
  s => (path.isAbsolute(s) ? s : null),
  "is not an absolute path",
)

// ── the table ────────────────────────────────────────────────────────────

const everywhere = ["system", "user", { project: "accepted" }, "local"] as const

export const SETTINGS = defineTable({
  owner: pick(email, {
    fallback: null,
    describe: "who approves a lane's use of your own ssh identity",
    order: ["user"],
  }),
  model: pick(model, {
    fallback: null,
    describe: "the model every run uses, as provider/id",
    order: [...everywhere, "env"],
    env: "PINETRIE_MODEL",
  }),
  packages: join(hostCode(list(absolutePath)), {
    describe:
      "pi packages, by folder: their skills, prompts and provider extensions",
    layers: ["system", "user"],
  }),
  skills: join(list(listedPath), {
    describe: "folders of skills, beside those in packages",
    layers: everywhere,
  }),
  prompts: join(list(listedPath), {
    describe: "folders of prompt templates, beside those in packages",
    layers: everywhere,
  }),
  "commands.names": join(
    record(
      text(
        s => (isCommandLabel(s) ? s : null),
        "is not a label: letters, digits, '.', '_' and '-'",
      ),
    ),
    {
      describe: "a listed package's path → the label its commands go under",
      layers: ["user"],
    },
  ),
  "icons.source": pick(choice(ICON_SOURCES), {
    fallback: "built-in",
    describe: "where a thread's icon comes from: built-in, drawn or none",
    order: ["system", "user", "local"],
  }),
  "icons.model": pick(model, {
    fallback: null,
    describe: "the image model drawn icons come from, as provider/id",
    order: ["system", "user", "local"],
  }),
  "titles.enabled": pick(flag(), {
    fallback: true,
    describe: "whether a model titles a task by itself",
    order: ["system", "user", "local"],
  }),
  "titles.model": pick(model, {
    fallback: null,
    describe: "the model titles are asked of; the run's when unset",
    order: ["system", "user", "local"],
  }),
  "digests.enabled": pick(flag(), {
    fallback: true,
    describe: "whether a model digests each long ask's work",
    order: ["system", "user", "local"],
  }),
  "shares.quoteBytes": pick(count({ min: 0 }), {
    fallback: DEFAULT_QUOTE_BYTES,
    describe:
      "how large a shared text file may be and still be quoted to the model, in bytes; 0 quotes none",
    order: ["system", "user", "local"],
  }),
  "agents.budget": limited(
    pick(count({ min: 1 }), {
      fallback: DEFAULT_BUDGET,
      describe: "the tokens agents may spend talking, per message",
      order: ["user", "local"],
    }),
    ["system"],
  ),
  "folder.history.states": pick(count({ min: 1, max: 100_000 }), {
    fallback: 200,
    describe:
      "how many of your folder's states a folder project keeps, newest first",
    order: ["user", "local"],
  }),
  "lanes.vm.slots": pick(count({ min: 1, max: MAX_VM_SLOTS }), {
    fallback: DEFAULT_VM_SLOTS,
    describe: "how many folders the lane VM shares, at most",
    order: ["system", "user"],
  }),
  "lanes.shared": join(list(text(s => s, "is not text")), {
    describe: "folders shared read-write with every lane",
    layers: ["user", { project: "lane" }, "local"],
  }),
  "lanes.nested": limited(
    pick(flag(), {
      fallback: false,
      describe: "lanes of their own inside each lane",
      order: [{ project: "lane" }],
    }),
    ["system"],
  ),
  "lanes.hostPorts": pick(
    list(
      shaped(v => {
        const port = parsePort(v)
        return port === null
          ? refused("is not a port from 1 to 65535")
          : decoded(port)
      }),
    ),
    {
      fallback: [],
      describe: "ports of the Mac's loopback lanes may reach",
      order: [{ project: "lane" }],
    },
  ),
  "lanes.env": pick(
    list(text(n => (isEnvName(n) ? n : null), "is not a variable's name")),
    {
      fallback: [],
      describe: "environment variables passed from the host",
      order: [{ project: "lane" }],
    },
  ),
  "lanes.mounts": pick(
    list(
      shaped(v => {
        const mount = parseMount(v)
        return mount === null
          ? refused("is not a source and an absolute target")
          : decoded(mount)
      }),
    ),
    {
      fallback: [],
      describe: "further read-only mounts, the source relative to the project",
      order: [{ project: "lane" }],
    },
  ),
  "lanes.ssh.personal": limited(
    pick(flag(), {
      fallback: false,
      describe:
        "whether lanes may ask for your own ssh identity: the project grants, you grant or decline",
      order: [{ project: "lane" }, "user", "local"],
    }),
    ["system"],
  ),
  "lanes.ssh.hosts": pick(
    shaped<HostPatterns>(v => {
      const patterns = parseHostPatterns(v)
      return patterns === null
        ? refused("is not a list of host patterns")
        : decoded(patterns)
    }),
    {
      fallback: "all",
      describe: "the hosts your own identity may reach",
      order: ["user", "local"],
    },
  ),
  "lanes.ssh.approvalSeconds": pick(
    count({ min: MIN_APPROVAL_SECONDS, max: MAX_APPROVAL_SECONDS }),
    {
      fallback: DEFAULT_APPROVAL_SECONDS,
      describe: "how long a lane's use of your identity waits for you",
      order: ["user", "local"],
    },
  ),
  "accepted.bookmark": pick(bookmark, {
    fallback: DEFAULT_REPO.acceptedBookmark,
    describe: "accepted work's bookmark",
    order: ["user", { project: "working" }, "local"],
  }),
  "wip.prefix": pick(
    text(
      s => (isBookmarkName(`${s}x`) ? s : null),
      "does not start a bookmark name",
    ),
    {
      fallback: DEFAULT_REPO.wipPrefix,
      describe: "the start of every WIP's bookmark",
      order: ["user", { project: "working" }, "local"],
    },
  ),
  "publish.bookmark": pick(bookmark, {
    fallback: DEFAULT_REPO.publish,
    describe: "the bookmark publish moves to accepted work",
    order: ["user", { project: "working" }, "local"],
  }),
  "publish.catchUp": pick(flag(), {
    fallback: DEFAULT_REPO.publishCatchesUp,
    describe: "whether publish catches your working copy up first",
    order: ["user", { project: "working" }, "local"],
  }),
})

export type HostSettings = typeof SETTINGS
export type HostSettled = Settled<HostSettings>
export type HostReport = ConfigReport<HostSettings>

// ── the project's copies ─────────────────────────────────────────────────

type ProjectValues = LayerValues<HostSettings, "project">

/**
 * What a copy of `pinetrie.json` lets lanes do and share, as written: a
 * mount's source resolved against the project's `root`, ports in order.
 */
export function laneAuthority(
  values: ProjectValues,
  root: string,
): LaneAuthority {
  return {
    grants: {
      ssh: values["lanes.ssh.personal"] ?? false,
      nested: values["lanes.nested"] ?? false,
      hostPorts: [...(values["lanes.hostPorts"] ?? [])].sort((a, b) => a - b),
      env: values["lanes.env"] ?? [],
      mounts: (values["lanes.mounts"] ?? []).map(m => ({
        source: path.resolve(root, m.source),
        target: m.target,
        readonly: true,
      })),
    },
    shared: values["lanes.shared"] ?? [],
  }
}

/**
 * A copy of `pinetrie.json`'s grants and its refusals: what a lane's own
 * write is told, and what an offer's review compares.
 */
export function decodeAuthority(
  root: string,
  file: string,
  text: string | null,
): {
  readonly authority: LaneAuthority
  readonly refusals: readonly Refusal[]
} {
  const read: FileRead =
    text === null ? { kind: "missing" } : { kind: "text", text }
  const decodedCopy = decodeProject(SETTINGS, projectCopy("lane", file, read))
  return {
    authority: laneAuthority(decodedCopy.values, root),
    refusals: decodedCopy.refusals,
  }
}

/**
 * The lane copy a lane runs with, as the project layer reads it: accepted
 * work's grants, less what the lane gave up (`effectiveLaneConfig`). Only
 * what it grants is set, so a grant left out is no one's choice.
 */
export function laneCopy(
  authority: LaneAuthority,
): DecodedProject<HostSettings, "lane"> {
  const { grants, shared } = authority
  const values: Record<string, unknown> = {
    ...(grants.ssh ? { "lanes.ssh.personal": true } : {}),
    ...(grants.nested ? { "lanes.nested": true } : {}),
    ...(grants.hostPorts.length > 0
      ? { "lanes.hostPorts": grants.hostPorts }
      : {}),
    ...(grants.env.length > 0 ? { "lanes.env": grants.env } : {}),
    ...(grants.mounts.length > 0
      ? {
          "lanes.mounts": grants.mounts.map(m => ({
            source: m.source,
            target: m.target,
          })),
        }
      : {}),
    ...(shared.length > 0 ? { "lanes.shared": shared } : {}),
  }
  return {
    layer: "project",
    copy: "lane",
    file: PROJECT_CONFIG_FILE,
    state: "read",
    values: values as ProjectValues,
    refusals: [],
  }
}

/** Every setting, from the start layers and the project's copies. */
export const settleHost = (
  start: StartLayers<HostSettings>,
  project: {
    readonly working?: DecodedProject<HostSettings, "working">
    readonly accepted?: DecodedProject<HostSettings, "accepted">
    readonly lane?: DecodedProject<HostSettings, "lane">
  },
): HostReport =>
  settle(SETTINGS, {
    system: start.system,
    user: start.user,
    local: start.local,
    env: start.env,
    project,
  })

// ── settled values, as the deciding packages take them ───────────────────

/** Your repo's names. */
export const repoNames = (settled: HostSettled): RepoConfig => ({
  acceptedBookmark: settled["accepted.bookmark"].value,
  wipPrefix: settled["wip.prefix"].value,
  publish: settled["publish.bookmark"].value,
  publishCatchesUp: settled["publish.catchUp"].value,
})

export const iconSettings = (settled: HostSettled): IconConfig =>
  iconConfig(settled["icons.source"].value, settled["icons.model"].value)

export const titleSettings = (settled: HostSettled): TitleConfig => ({
  enabled: settled["titles.enabled"].value,
  model: settled["titles.model"].value,
})

/**
 * `lanes.ssh`'s settled values, as `sshSettings` takes them. Refused hosts
 * are `"invalid"`: they turn personal identity off rather than widening it.
 */
export function sshChoice(report: HostReport): {
  readonly personal: PersonalChoice
  readonly hosts: HostPatterns | "invalid"
  readonly approvalSeconds: number
} {
  const { settled, refusals } = report
  const personal = settled["lanes.ssh.personal"]
  const narrowed = personal.unlimited && !personal.value
  const origin = personal.origins.at(-1)
  const layer = origin?.kind === "file" ? origin.layer : null
  return {
    personal: {
      on: personal.value,
      decider: narrowed
        ? "machine"
        : layer === "user" || layer === "local"
          ? "person"
          : layer === "project"
            ? "project"
            : "none",
    },
    hosts: refusals.some(r => r.key === "lanes.ssh.hosts")
      ? "invalid"
      : settled["lanes.ssh.hosts"].value,
    approvalSeconds: settled["lanes.ssh.approvalSeconds"].value,
  }
}

/**
 * The folders a list setting names, each with the layer that named it: the
 * start layers' and accepted work's copy's, in layer order, each folder once.
 * A relative path is inside the project: resolved against `root`.
 */
export function listedFolders(
  start: StartLayers<HostSettings>,
  accepted: LayerValues<HostSettings, "project"> | null,
  key: "skills" | "prompts",
  root: string,
): readonly ListedFolder[] {
  const layers: readonly (readonly [ConfigLayer, readonly string[]])[] = [
    ["system", start.system?.values[key] ?? []],
    ["user", start.user.values[key] ?? []],
    ["project", accepted?.[key] ?? []],
    ["local", start.local?.values[key] ?? []],
  ]
  const out: ListedFolder[] = []
  for (const [layer, paths] of layers)
    for (const p of paths) {
      const folder = path.resolve(root, p)
      if (!out.some(f => f.path === folder)) out.push({ path: folder, layer })
    }
  return out
}

/**
 * A host without lane work has no accepted work: its folder's
 * `pinetrie.json`, as it is, is every copy of the project's file.
 */
export async function folderReport(
  start: StartLayers<HostSettings>,
  folder: string | null,
): Promise<HostReport> {
  if (folder === null) return settleHost(start, {})
  const accepted = await folderCopy(folder, "accepted")
  return settleHost(start, {
    working: await folderCopy(folder, "working"),
    accepted,
    lane: laneCopy(laneAuthority(accepted.values, folder)),
  })
}

/** The `pinetrie.json` in `folder`, decoded as the project's `copy`. */
export async function folderCopy<C extends "working" | "accepted">(
  folder: string,
  copy: C,
): Promise<DecodedProject<HostSettings, C>> {
  return decodeProject(
    SETTINGS,
    projectCopy(
      copy,
      PROJECT_CONFIG_FILE,
      await readConfigFile(path.join(folder, PROJECT_CONFIG_FILE)),
    ),
  )
}
