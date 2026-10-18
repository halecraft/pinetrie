// web/thread-preview — a thread in your inventory, opened: its path read only,
// each message with who wrote it. It takes a `ThreadPreview`, which no
// composer, dock or queue takes, so nothing here sends. To work in it, put it
// on a canvas.

import type { ThreadPreview } from "@pinetrie/interface"
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
