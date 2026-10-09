// web/thread-preview — a thread in your inventory, opened (ADR-0124): its
// path read only, each message with who wrote it. It takes a
// `ThreadPreview`, which no composer, dock or queue takes, so nothing here
// sends. To work in it, put it on a canvas.

import {
  faceStatus,
  type ThreadFace,
  type ThreadPreview,
} from "@pinetrie/interface"
import type { ReactNode } from "react"
import { MessageText } from "./message-text.tsx"

export function ThreadPreviewView(p: {
  preview: ThreadPreview
  /** Below the path: its put. */
  foot: ReactNode
}) {
  return (
    <section
      aria-label="the thread, read only"
      className="thread-preview"
      data-thread={p.preview.thread}
    >
      <ol className="thread-preview-path">
        {p.preview.rows.map(row => (
          <li data-entry={row.id} key={row.id}>
            <span className="thread-preview-who">{row.who}</span>
            <MessageText mode="committed" text={row.text} />
          </li>
        ))}
      </ol>
      <div className="thread-preview-foot">{p.foot}</div>
    </section>
  )
}

/** A thread's card in a slot (ADR-0124): known at a glance. */
export function ThreadFaceView({ face }: { face: ThreadFace }) {
  const status = faceStatus(face)
  return (
    <span className="thread-face" data-thread={face.thread}>
      <span className="thread-face-head">
        {face.sprite !== null && (
          <img alt="" className="thread-face-sprite" src={face.sprite} />
        )}
        <span className="thread-face-name">{face.name ?? "a thread"}</span>
      </span>
      <span className="thread-face-first">{face.first}</span>
      {face.last !== null && (
        <span className="thread-face-last">… {face.last}</span>
      )}
      {status !== null && <span className="thread-face-status">{status}</span>}
    </span>
  )
}
