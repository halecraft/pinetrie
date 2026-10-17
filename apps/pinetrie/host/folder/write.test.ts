import { spawnSync } from "node:child_process"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type AcceptWrite,
  pointId,
  threadIdFor,
  type WriteJournal,
  writeAsideDir,
  writeStageDir,
} from "@pinetrie/core"
import {
  checkStage,
  journalPaths,
  planWriteSteps,
  shownMergeId,
} from "@pinetrie/folder"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { scanFolder } from "./scan.ts"
import {
  type AllLinked,
  executeWriteSteps,
  recoverWrite,
  walkStage,
} from "./write.ts"
import { extractTar } from "./writes.ts"

const ID = "0190-accept"
const LANE = threadIdFor("1")
const L1 = pointId("line-1")
const TIP = pointId("turn-1")

let root = ""
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pinetrie-write-"))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function put(files: Record<string, string>, under = root) {
  for (const [p, v] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(under, p)), { recursive: true })
    await writeFile(path.join(under, p), v)
  }
}

const read = (p: string) =>
  readFile(path.join(root, p), "utf8").catch(() => null)

/**
 * An accept planned over the folder as it is now: the read's stamps from a
 * scan, `shown` staged as the tar would, the steps and the journal. A
 * value null in `shown` deletes the path; `->x` is a symlink to x.
 */
async function planned(shown: Record<string, string | null>) {
  const scan = await scanFolder({ root, own: "" })
  const writes: AcceptWrite[] = Object.entries(shown).map(([p, v]) => ({
    path: p,
    expected: scan.get(p) ?? null,
    to:
      v === null
        ? null
        : v.startsWith("->")
          ? { kind: "symlink", target: v.slice(2) }
          : { kind: "file" },
  }))
  const stage = writeStageDir(ID)
  await mkdir(path.join(root, stage))
  await put(
    Object.fromEntries(
      Object.entries(shown).flatMap(([p, v]) =>
        v === null || v.startsWith("->") ? [] : [[p, v]],
      ),
    ),
    path.join(root, stage),
  )
  const checked = checkStage(await walkStage(path.join(root, stage)), writes)
  if (checked.kind !== "staged") throw new Error(JSON.stringify(checked))
  const steps = planWriteSteps(writes, stage)
  const journal: WriteJournal = {
    id: ID,
    record: {
      id: shownMergeId(L1, TIP),
      parents: [L1, TIP],
      made: { kind: "accept", lane: LANE },
      at: 0,
      by: null,
    },
    paths: journalPaths(steps, checked.files, ID),
    status: "open",
  }
  return { steps, journal }
}

describe("executeWriteSteps", () => {
  test("writes, links, deletes and keeps each replaced file aside", async () => {
    await put({ "a.txt": "old", "gone.txt": "x", "d/e.txt": "e" })
    const { steps, journal } = await planned({
      "a.txt": "new",
      "b.txt": "b",
      "gone.txt": null,
      "d/e.txt": null,
      l: "->a.txt",
    })
    const saved: WriteJournal[] = []
    const { done } = await executeWriteSteps({
      root,
      journal,
      steps,
      save: async j => {
        saved.push(j)
      },
    })
    expect(done.kind).toBe("linked")
    expect(await read("a.txt")).toBe("new")
    expect(await read("b.txt")).toBe("b")
    expect(await read("gone.txt")).toBeNull()
    expect(await readlink(path.join(root, "l"))).toBe("a.txt")
    expect(await read(`${writeAsideDir(ID)}/a.txt`)).toBe("old")
    // A directory a delete leaves empty goes.
    await expect(stat(path.join(root, "d"))).rejects.toThrow()
    expect(saved.at(-1)?.paths.every(p => p.linked)).toBe(true)
  })

  test("a save by rename between the check and the move aside is caught by the aside's check, and kept", async () => {
    await put({ "a.txt": "old", "b.txt": "b-old" })
    const { steps, journal } = await planned({ "a.txt": "new", "b.txt": "b" })
    const { done, journal: after } = await executeWriteSteps({
      root,
      journal,
      steps,
      save: async j => {
        const b = j.paths[1]
        if (b?.moved !== null && b?.linked === false) {
          await writeFile(path.join(root, "b.tmp"), "yours")
          await rename(path.join(root, "b.tmp"), path.join(root, "b.txt"))
        }
      },
    })
    expect(done).toMatchObject({ kind: "failed", path: "b.txt" })
    expect((await recoverWrite(root, after)).kind).toBe("put-back")
    expect(await read("a.txt")).toBe("old")
    expect(await read("b.txt")).toBe("yours")
  })

  test("a file changed since the read is refused before it moves, and what was linked is put back", async () => {
    await put({ "a.txt": "old", "z.txt": "z-old" })
    const { steps, journal } = await planned({ "a.txt": "new", "z.txt": "z" })
    await writeFile(path.join(root, "z.txt"), "yours, since")
    let last = journal
    const { done, journal: after } = await executeWriteSteps({
      root,
      journal,
      steps,
      save: async j => {
        last = j
      },
    })
    expect(done).toMatchObject({ kind: "failed", path: "z.txt" })
    expect(await read("a.txt")).toBe("new")
    const recovered = await recoverWrite(root, after)
    expect(recovered.kind).toBe("put-back")
    expect(await read("a.txt")).toBe("old")
    expect(await read("z.txt")).toBe("yours, since")
    expect(last.status).toBe("open")
  })
})

describe("recoverWrite", () => {
  test("a put back never unlinks a file written in place since its link", async () => {
    await put({ "a.txt": "old", "z.txt": "z-old" })
    const { steps, journal } = await planned({ "a.txt": "new", "z.txt": "z" })
    await writeFile(path.join(root, "z.txt"), "yours, since")
    const { journal: after } = await executeWriteSteps({
      root,
      journal,
      steps,
      save: async () => {},
    })
    // An app writes through a.txt by its path after the link.
    await writeFile(path.join(root, "a.txt"), "yours, in place")
    await recoverWrite(root, after)
    expect(await read("a.txt")).toBe("yours, in place")
    expect((await lstat(path.join(root, "z.txt"))).isFile()).toBe(true)
  })
})

test("extractTar takes a stream whose tail tar never reads", async () => {
  const src = path.join(root, "src")
  await put({ "a.txt": "a" }, src)
  const archive = spawnSync("tar", ["-cf", "-", "-C", src, "a.txt"]).stdout
  async function* stream() {
    yield new Uint8Array(archive)
    // More than tar reads past its end marker: it closes its input first.
    for (let i = 0; i < 64; i++) yield new Uint8Array(64 * 1024)
  }
  const into = path.join(root, "into")
  await mkdir(into)
  await extractTar(stream(), into)
  expect(await readFile(path.join(into, "a.txt"), "utf8")).toBe("a")
})

test("only the executor makes an AllLinked, and it takes no recovery step", () => {
  // @ts-expect-error: the brand is write.ts's own, so no literal is one.
  const forged: AllLinked = { write: ID }
  const steps = (s: Parameters<typeof executeWriteSteps>[0]["steps"]) => s
  // @ts-expect-error: a recovery step is never a write step.
  steps([{ kind: "drop-stage", id: ID }])
  expect(forged.write).toBe(ID)
})
