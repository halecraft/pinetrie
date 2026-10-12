// web/copy — copying text to the clipboard from a button.

import { useEffect, useState } from "react"
import { writeTextByButton } from "./clipboard.ts"

/** A copy button's title just after a press. */
export const COPIED = "copied"

/**
 * Copies text to the clipboard. `copied` is true for 2s after a copy. The
 * clipboard exists only in a secure context, which an invite link over plain
 * http is not: there, or when the clipboard refuses, a press selects
 * `fallback`, from the start of its first element to the end of its last, for
 * the reader to copy. The test is for `writeText`, not `isSecureContext`, since
 * the browser suite can hide the one but not the other.
 */
export function useCopy(): {
  readonly copied: boolean
  readonly copy: (text: string, fallback: readonly Element[]) => void
} {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2_000)
    return () => clearTimeout(t)
  }, [copied])
  const copy = (text: string, fallback: readonly Element[]) => {
    const written = writeTextByButton(text)
    if (written === null) return selectContents(fallback)
    written.then(
      () => setCopied(true),
      () => selectContents(fallback),
    )
  }
  return { copied, copy }
}

function selectContents(els: readonly Element[]): void {
  const first = els[0]
  const last = els.at(-1)
  if (first === undefined || last === undefined) return
  const range = document.createRange()
  range.setStartBefore(first)
  range.setEndAfter(last)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
