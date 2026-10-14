import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { build, type Rollup } from "vite"
import { afterEach, expect, test } from "vitest"
import { isStampFresh, stampInputs } from "./stamp.ts"

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

test("a stamp is fresh until an input changes, goes, or the mode differs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-stamp-"))
  dirs.push(dir)
  const a = path.join(dir, "a.ts")
  const b = path.join(dir, "b.ts")
  await writeFile(a, "a")
  await writeFile(b, "b")
  const stamp = stampInputs([a, b], "production")
  expect(isStampFresh(stamp, "production")).toBe(true)
  expect(isStampFresh(stamp, "development")).toBe(false)
  await writeFile(a, "a, changed")
  expect(isStampFresh(stamp, "production")).toBe(false)
  await writeFile(a, "a")
  await rm(b)
  expect(isStampFresh(stamp, "production")).toBe(false)
})

test("the built page holds one React", async () => {
  const out = (await build({
    configFile: path.join(import.meta.dirname, "vite.config.ts"),
    mode: "production",
    logLevel: "silent",
    build: { write: false },
  })) as Rollup.RollupOutput
  const reacts = new Set(
    out.output.flatMap(o =>
      o.type === "chunk"
        ? Object.keys(o.modules).flatMap(
            m =>
              /node_modules\/\.pnpm\/(react@[^/]+)\/node_modules\/react\//.exec(
                m,
              )?.[1] ?? [],
          )
        : [],
    ),
  )
  expect([...reacts]).toHaveLength(1)
}, 60_000)
