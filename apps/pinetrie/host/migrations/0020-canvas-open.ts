// host/migrations/0020-canvas-open — a person's open list names canvases:
// its `tasks` is `canvases`, so its schema's hash moves. Each person's list
// moves with it, each canvas at its order key, so the sidebar keeps what it
// held, in its order.
//
// A stored document keeps each field under a key hashed from its schema, so
// the old field cannot be read through the new schema: it is read from a
// snapshot opened under the old one (`OpenDocBeforeCanvas`). Delete this
// file, its test and `OpenDocBeforeCanvas` once Duane's store has run it.

import { batch, createDoc, exportEntirety } from "@kyneta/schema"
import {
  OpenDoc,
  OpenDocBeforeCanvas,
  type OpenDocHandle,
} from "@pinetrie/schema"
import type { Migration } from "./index.ts"

/** The canvases to write: each old key the new field does not already hold. */
export const planCanvasOpen = (
  old: Readonly<Record<string, string>>,
  now: Readonly<Record<string, string>>,
): readonly (readonly [string, string])[] =>
  Object.entries(old).filter(([canvas, key]) => now[canvas] !== key)

/** `doc`'s open list as the old schema stored it. */
export const storedTasks = (
  doc: OpenDocHandle,
): Readonly<Record<string, string>> =>
  createDoc(OpenDocBeforeCanvas, exportEntirety(doc)).tasks()

export const canvasOpen: Migration = {
  name: "0020-canvas-open",
  kind: "open",
  from: OpenDocBeforeCanvas.schemaHash,
  async run({ exchange, docIds, hydrated }) {
    const planned: {
      doc: OpenDocHandle
      writes: readonly (readonly [string, string])[]
    }[] = []
    for (const docId of docIds) {
      const doc = exchange.get(docId, OpenDoc)
      await hydrated(docId)
      planned.push({
        doc,
        writes: planCanvasOpen(storedTasks(doc), doc.canvases()),
      })
    }
    return async () => {
      for (const { doc, writes } of planned)
        if (writes.length > 0)
          batch(doc, d => {
            for (const [canvas, key] of writes) d.canvases.set(canvas, key)
          })
    }
  },
}
