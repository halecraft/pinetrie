// host/save-blob — the host's side of `save_blob`: the bytes of a blob some
// message on the lane's path showed its model, or why not. The tool writes
// them into the lane itself, through its environment, so the helper counts
// the write as the agent's.

import type { BlobStore, ThreadId } from "@pinetrie/core"
import type { BlobAnswer } from "@pinetrie/pi"
import { readTreeIndex } from "@pinetrie/reads"
import { planSaveBlob, readableBlobs } from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import { ancestry } from "@pinetrie/threads"
import type { RunDocs } from "./runs.ts"

/** A lane's `save_blob` asks: gather its path, plan, then read the bytes. */
export const createReadBlob =
  (deps: {
    /** A tool is called in a run, whose lease holds its lane's root. */
    readonly runs: RunDocs
    readonly blobs: Pick<BlobStore, "get">
  }) =>
  async (lane: ThreadId, arg: string): Promise<BlobAnswer> => {
    // gather: every message on the lane's path, as its model read them
    const doc = deps.runs.docOf(lane)
    const tip = doc === null ? null : readLaneTip(doc, lane)
    if (doc === null || tip === null)
      return { kind: "refused", text: "This call reached no thread." }
    const index = readTreeIndex(doc)
    const messages = ancestry(index, tip).path.map(
      id => index.entries[id]?.message,
    )
    // plan
    const planned = planSaveBlob(readableBlobs(messages), arg)
    if (planned.kind === "refused") return planned
    // read
    const blob = deps.blobs.get(planned.sha256)
    return blob === undefined
      ? {
          kind: "refused",
          text: `${arg} is no longer stored: ask the person to share it again.`,
        }
      : { kind: "blob", sha256: planned.sha256, bytes: blob.bytes }
  }
