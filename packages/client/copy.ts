// client/copy — copying text to the clipboard from a button.

import { useCallback, useEffect, useState } from "react"

/** A copy button's title just after a press. */
export const COPIED = "copied"

/**
 * Copies text to the clipboard. `copied` is true for 2s after a copy. The
 * clipboard exists only in a secure context, which an invite link over plain
 * http is not: there, or when the clipboard refuses, a press selects
 * `fallback`'s contents for the reader to copy. The test is for `writeText`,
 * not `isSecureContext`, since the browser suite can hide the one (S68) but
 * not the other.
 */
export function useCopy(): {
  readonly copied: boolean
  readonly copy: (text: string, fallback: Element | null) => void
} {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2_000)
    return () => clearTimeout(t)
  }, [copied])
  const copy = useCallback((text: string, fallback: Element | null) => {
    const clipboard = navigator.clipboard as Clipboard | undefined
    if (clipboard?.writeText === undefined) return selectContents(fallback)
    clipboard.writeText(text).then(
      () => setCopied(true),
      () => selectContents(fallback),
    )
  }, [])
  return { copied, copy }
}

function selectContents(el: Element | null): void {
  if (el === null) return
  const range = document.createRange()
  range.selectNodeContents(el)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
