// schema/open — the roots a person has open, in their order (ADR-0085): a
// Yjs document per person, written only by that person's tabs, so the list is
// the same on every device of theirs. The host stores and relays it, shared
// with its person only (host/policy.ts), and never writes it; its id and who
// may write it are the protocol's (`personDocId`, `@pinetrie/protocol/writers`).
//
// A root maps to an order key, not a place in a list: two devices reordering
// at once merge per root, and a list could hold a root twice.

import {
  type BoundSchema,
  createDoc,
  type DocRef,
  Schema,
} from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"
import { isRootId, type RootId } from "@pinetrie/core"

/** Each open root's id to its order key. A closed root has no key. */
export const OpenDoc = yjs.bind(
  Schema.struct({ roots: Schema.record(Schema.string()) }),
)

/** An open-roots document, as the Exchange gives it. */
export type OpenDocHandle =
  typeof OpenDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

/** An open-roots document on its own, with no Exchange: for tests. */
export const newOpenDoc = (): OpenDocHandle => createDoc(OpenDoc)

/** Each open root and its order key, as stored; a key that is no root is left out. */
export const readOpenKeys = (doc: OpenDocHandle): ReadonlyMap<RootId, string> =>
  new Map(
    Object.entries(doc.roots()).flatMap(([root, key]) =>
      isRootId(root) ? [[root, key] as const] : [],
    ),
  )
