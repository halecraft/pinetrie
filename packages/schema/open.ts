// schema/open — the canvases a person has open, in their order: a Yjs document
// per person, written only by that person's tabs.
//
// A canvas maps to an order key, not a place in a list: two devices reordering
// at once merge per canvas, and a list could hold a canvas twice.

import { type BoundSchema, type DocRef, Schema } from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"
import { type CanvasId, isCanvasId } from "@pinetrie/core"

/** Each open canvas's id to its order key. A closed canvas has no key. */
export const OpenDoc = yjs.bind(
  Schema.struct({ canvases: Schema.record(Schema.string()) }),
)

/** An open-canvases document, as the Exchange gives it. */
export type OpenDocHandle =
  typeof OpenDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

/** Each open canvas and its order key, as stored; a key that is no canvas is left out. */
export const readOpenKeys = (
  doc: OpenDocHandle,
): ReadonlyMap<CanvasId, string> =>
  new Map(
    Object.entries(doc.canvases()).flatMap(([canvas, key]) =>
      isCanvasId(canvas) ? [[canvas, key] as const] : [],
    ),
  )
