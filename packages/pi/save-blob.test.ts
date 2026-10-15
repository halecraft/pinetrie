// `save_blob` against a local helper process, as a lane's tools reach theirs.

import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context"
import { type Sha256, threadIdFor } from "@pinetrie/core"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { type LaneChannel, laneEnv, openChannel } from "./lane-env.ts"
import { drainLaneRuns } from "./lane-runs.ts"
import type { ToolContext } from "./lanes.ts"
import { type BlobAnswer, saveBlobTool } from "./save-blob.ts"
import { threadContext } from "./thread-context.ts"

const HELPER = path.join(import.meta.dirname, "lane-helper.ts")
const SHA = "a".repeat(64) as Sha256
const LANE = threadIdFor("save")
/** Bytes no text path would carry: a NUL and a byte that is not UTF-8. */
const BYTES = new Uint8Array([0, 0xff, 1, 2, 0x80])

describe("save_blob", () => {
  let dir: string
  let channel: LaneChannel
  beforeAll(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "pinetrie-save-")))
    channel = openChannel([
      "env",
      `PINETRIE_WORKSPACE_ROOT=${dir}`,
      process.execPath,
      HELPER,
    ])
    await channel.ready
  })
  afterAll(async () => {
    channel.close()
    await channel.closed
    await rm(dir, { recursive: true, force: true })
  })

  const run = async (
    answer: BlobAnswer,
    params: { blob: string; path: string },
  ) => {
    const asked: string[] = []
    const tool = saveBlobTool(async (_lane, blob) => {
      asked.push(blob)
      return answer
    })
    const toolContext = {
      env: laneEnv(dir, () => Promise.resolve(channel)),
      dir,
    } as ToolContext
    const result = await tool.execute(
      "c1",
      params,
      undefined,
      toolContext,
      undefined,
      threadContext(LANE, BACKGROUND_CONTEXT),
    )
    return { asked, text: result.content[0]?.text ?? "" }
  }

  test("writes the blob's bytes into the lane, as a tool's write", async () => {
    const { asked, text } = await run(
      { kind: "blob", sha256: SHA, bytes: BYTES },
      { blob: `/blob/${SHA}`, path: "assets/logo.bin" },
    )
    expect(asked).toEqual([`/blob/${SHA}`])
    expect(text).toBe(`Saved 5 bytes to ${dir}/assets/logo.bin.`)
    expect([...(await readFile(path.join(dir, "assets/logo.bin")))]).toEqual([
      ...BYTES,
    ])
    const drained = await drainLaneRuns(channel, {
      drain: async d => (await d(new Map())).result,
    })
    expect(drained.toolWrites).toContain("assets/logo.bin")
  })

  test("a refusal is the answer, and nothing is written", async () => {
    const { text } = await run(
      { kind: "refused", text: "No message in this thread shares it." },
      { blob: "nope", path: "nope.bin" },
    )
    expect(text).toBe("No message in this thread shares it.")
    await expect(readFile(path.join(dir, "nope.bin"))).rejects.toThrow()
  })
})
