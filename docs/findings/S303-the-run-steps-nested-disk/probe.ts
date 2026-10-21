// S303's probe: what `run`'s `nested-disk` call (no lane to clone from)
// changes on a nested disk that a data-root step has just made, for each
// way that step can leave it. Runs the disks role in this process, on btrfs.
//   node docs/findings/S303-the-run-steps-nested-disk/probe.ts <lanes dir on btrfs>
import { execFileSync } from "node:child_process"
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { disksInProcess } from "../../../packages/lanehost/fixtures.ts"
import { projectDisks } from "../../../packages/lanehost/layout.ts"

const lanesDir = process.argv[2] ?? "/var/lib/pinetrie-lanes/s290"
const KEY = "5290529052905290"
const disks = projectDisks(lanesDir, KEY)

/** Every entry under `at`: inode, owner, mode, and whether it is a subvolume. */
async function state(at: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (rel: string) => {
    const s = await stat(path.join(at, rel), { bigint: true })
    out[rel || "."] = `ino=${s.ino} uid=${s.uid} gid=${s.gid} mode=${s.mode.toString(8)} ctime=${s.ctimeNs}`
    if (s.isDirectory())
      for (const n of await readdir(path.join(at, rel))) await walk(rel ? `${rel}/${n}` : n)
  }
  await walk("")
  return out
}

const differences = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).map(k => `${k}: ${a[k] ?? "absent"} -> ${b[k] ?? "absent"}`)

const sh = (cmd: string) => execFileSync("sh", ["-c", cmd], { stdio: "pipe" }).toString()
const clean = () => {
  try { sh(`for d in $(find ${lanesDir} -xdev -inum 256 -type d 2>/dev/null | sort -r); do btrfs property set -f "$d" ro false 2>/dev/null; btrfs subvolume delete "$d" >/dev/null 2>&1; done`) } catch {}
  return rm(lanesDir, { recursive: true, force: true })
}

await clean()
await mkdir(path.join(lanesDir, "folder"), { recursive: true })
const call = disksInProcess({ lanesDir, folder: path.join(lanesDir, "folder") })
const nestedDisk = (lane: string, cloneFromLane: string | null) =>
  call({ kind: "nested-disk", project: KEY, lane, cloneFromLane })

const cases: { name: string; first: () => Promise<unknown>; lane: string }[] = [
  { name: "kept: no data root before", lane: "t-a", first: () => nestedDisk("t-a", null) },
  {
    name: "kept: a plain docker/ directory before",
    lane: "t-b",
    first: async () => {
      await mkdir(path.join(disks.nested("t-b"), "docker", "image"), { recursive: true })
      await nestedDisk("t-b", null)
    },
  },
  {
    name: "cloned from another lane's data root",
    lane: "t-c",
    first: async () => {
      await nestedDisk("t-src", null)
      await writeFile(path.join(disks.innerDockerDataRoot("t-src"), "built"), "an image\n")
      await nestedDisk("t-c", "t-src")
    },
  },
  {
    name: "a source named whose data root is gone",
    lane: "t-d",
    first: () => nestedDisk("t-d", "t-gone"),
  },
]

for (const c of cases) {
  await c.first()
  const before = await state(disks.nested(c.lane))
  await nestedDisk(c.lane, null) // what `run` calls next
  const after = await state(disks.nested(c.lane))
  const d = differences(before, after)
  console.log(`${c.name}: ${Object.keys(before).length} entries, ${d.length} changed`)
  for (const line of d) console.log(`  ${line}`)
}

// The base scratch lane: no data-root step before its run. What `run`'s call makes.
await rm(disks.nested("base-scratch"), { recursive: true, force: true })
const missing = await stat(disks.nested("base-scratch")).then(() => false, () => true)
await nestedDisk("base-scratch", null)
const made = await state(disks.nested("base-scratch"))
console.log(`base scratch lane: nested disk absent before run's call: ${missing}; after it: ${JSON.stringify(Object.keys(made))}, subvolume ${(await stat(disks.nested("base-scratch"))).ino === 256 ? "yes" : "no"}`)
await clean()
