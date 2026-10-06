// Checkpoints stored as text, and which model is picked. Co-located in
// packages/pi because both concern pi's shapes (ADR-0003).

import {
  BACKGROUND_CONTEXT,
  StorageBackedSession,
  value,
} from "@earendil-works/pi-agent-core"
import { newRootDoc } from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import {
  CHECKPOINT_NAMESPACE,
  sealCheckpoint,
  unsealCheckpoint,
} from "./checkpoint.ts"
import { pickModel } from "./config.ts"
import { KynetaStorage } from "./storage.ts"

const output = (text: string) => ({
  content: [{ type: "text", text }],
  details: { truncation: undefined },
})

describe("sealCheckpoint", () => {
  test("one text part is taken out, and put back exactly", () => {
    const v = output("line 1\nline 2\n")
    const sealed = sealCheckpoint(v)
    expect(sealed?.text).toBe("line 1\nline 2\n")
    expect(JSON.stringify(sealed?.shell)).not.toContain("line 1")
    expect(unsealCheckpoint(sealed?.shell, sealed?.text ?? "")).toEqual(v)
  })
  test("any other shape is stored whole", () => {
    expect(sealCheckpoint({ content: [] })).toBeUndefined()
    expect(sealCheckpoint("text")).toBeUndefined()
    expect(
      sealCheckpoint({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBeUndefined()
  })
})

describe("KynetaStorage: a growing checkpoint is stored as text edits", () => {
  test("each write reads back exactly; the record keeps only a shell", async () => {
    const doc = newRootDoc()
    const session = new StorageBackedSession(
      { id: "t", createdAt: 1, storageVersion: 1 },
      new KynetaStorage({ doc, peerId: "t" }),
      {},
    )
    const at = value(CHECKPOINT_NAMESPACE, "op-1:call-1")
    const lines = (from: number, to: number) =>
      Array.from(
        { length: to - from + 1 },
        (_, k) => `line ${from + k}\n`,
      ).join("")
    for (const text of [lines(1, 50), lines(1, 90), lines(40, 130)]) {
      await session.setValue(at, output(text), BACKGROUND_CONTEXT)
      const read = await session.getValue(at, BACKGROUND_CONTEXT)
      expect(read?.value).toEqual(output(text))
    }
    const key = Object.keys(doc.values()).find(k => k.includes("op-1:call-1"))
    expect(key).toBeDefined()
    const record = doc.values.get(key ?? "") as {
      value: unknown
      sealed?: true
    }
    expect(record.sealed).toBe(true)
    expect(JSON.stringify(record.value).length).toBeLessThan(200)
    expect(doc.checkpointText.at(key ?? "")?.()).toBe(lines(40, 130))
    await session.deleteValue(at, BACKGROUND_CONTEXT)
    expect(doc.checkpointText.at(key ?? "")).toBeUndefined()
  })
})

test("pickModel: per field, the override, else the project's settings, else the global settings, each named as the source", () => {
  const global = {
    file: "/g/settings.json",
    provider: "anthropic",
    model: "claude-opus-5-5",
  }
  const project = { file: "/p/.pi/settings.json", model: "claude-fable-5-1" }
  const fromGlobal = { kind: "settings", file: global.file }
  expect(pickModel({ global, project: { file: project.file } }, {})).toEqual({
    provider: "anthropic",
    model: "claude-opus-5-5",
    origin: { kind: "configured", provider: fromGlobal, model: fromGlobal },
  })
  expect(pickModel({ global, project }, {})).toEqual({
    provider: "anthropic",
    model: "claude-fable-5-1",
    origin: {
      kind: "configured",
      provider: fromGlobal,
      model: { kind: "settings", file: project.file },
    },
  })
  expect(pickModel({ global, project }, { model: "claude-x" })).toEqual({
    provider: "anthropic",
    model: "claude-x",
    origin: {
      kind: "configured",
      provider: fromGlobal,
      model: { kind: "override" },
    },
  })
  expect(
    pickModel(
      { global: { file: global.file }, project: { file: project.file } },
      { provider: "cerebras" },
    ),
  ).toBeUndefined()
})
