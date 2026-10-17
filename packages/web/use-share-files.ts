// web/use-share-files — files shared into a card box: where each goes is
// fixed as it arrives, its bytes are uploaded, then its link goes in as one
// edit through the box, as typing is, so a bound box's binding sends it.

import { hasPosition, POSITION, type Position } from "@kyneta/schema"
import type { TextCardId } from "@pinetrie/core"
import {
  insertAt,
  type Selection,
  shareSelection,
  shareStatus,
  uploadBlob,
} from "@pinetrie/interface"
import { shareMarkdown } from "@pinetrie/rules"
import type { SessionClient } from "@pinetrie/session"
import { type RefObject, useState } from "react"

/** A box files can be shared into. */
interface ShareTarget {
  readonly box: RefObject<HTMLTextAreaElement | null>
  readonly session: SessionClient
  /** The card the box is bound to now; null while it holds only its sender's typing. */
  readonly boundTo: () => TextCardId | null
}

/** Where a share goes once its upload returns, from where it was put. */
type Anchor = (length: number) => Selection

/**
 * A place in a bound box's card text that others' edits move with: its
 * start after anything typed at it meanwhile, its end before, so the share
 * never replaces text it was not put over. A box with no card holds only its
 * sender's typing, so its offsets stand.
 */
function anchorOf(
  target: ShareTarget,
  at: Selection,
  card: TextCardId | null,
): Anchor {
  const text = card === null ? null : target.session.cardText(card).text
  if (text === null || !hasPosition(text)) return () => at
  const positions = text[POSITION]
  const start: Position = positions.createPosition(at.start, "right")
  const end: Position = positions.createPosition(at.end, "left")
  return length => {
    const s = start.resolve() ?? length
    return { start: s, end: Math.max(end.resolve() ?? length, s) }
  }
}

/**
 * Share files into `target`'s box: null shares nothing (a read-only box).
 * `uploading` holds a send back until the links are in; `status` says what
 * is uploading or what the host refused.
 */
export function useShareFiles(target: ShareTarget | null): {
  readonly share: ((files: readonly File[]) => void) | null
  readonly uploading: boolean
  readonly status: string
} {
  const [uploading, setUploading] = useState(0)
  const [refused, setRefused] = useState<readonly string[]>([])

  const shareNow = async (t: ShareTarget, files: readonly File[]) => {
    const el = t.box.current
    if (el === null) return
    const at = shareSelection({
      focused: document.activeElement === el,
      selection: { start: el.selectionStart, end: el.selectionEnd },
      length: el.value.length,
    })
    const anchor = anchorOf(t, at, t.boundTo())
    setUploading(n => n + 1)
    const uploads = await Promise.all(files.map(f => uploadBlob(f)))
    setUploading(n => n - 1)
    const snippets = uploads.flatMap((u, i) =>
      u.ok ? [shareMarkdown(files[i]?.name ?? "", u.ref)] : [],
    )
    setRefused(uploads.flatMap(u => (u.ok ? [] : [u.reason])))
    const now = t.box.current
    if (snippets.length === 0 || now === null) return
    // `insertAt` decides the text, a line of its own for each share; the
    // element is given it as one edit over the place, as typing would.
    const before = now.value
    const place = anchor(before.length)
    const start = Math.min(place.start, before.length)
    const end = Math.min(Math.max(place.end, start), before.length)
    const after = insertAt(before, place, snippets.join("\n")).text
    now.setRangeText(
      after.slice(start, after.length - (before.length - end)),
      start,
      end,
      "end",
    )
    now.dispatchEvent(new Event("input", { bubbles: true }))
  }

  return {
    share:
      target === null
        ? null
        : files => {
            if (files.length > 0) void shareNow(target, files)
          },
    uploading: uploading > 0,
    status: shareStatus({ uploading: uploading > 0, refused }),
  }
}
