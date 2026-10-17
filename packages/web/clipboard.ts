// web/clipboard — the one file that touches the clipboard: the page's `copy`,
// `cut` and `paste` events, a paste's files, and a button's copy. Each
// handler gathers (focus, the selection, what was pasted), asks a pure planner
// in `@pinetrie/interface` (`clipOfFocus`, `planCopy`, `readPaste`,
// `targetOfFocus`), and carries out what it says. It decides nothing.
// `clipboard-boundary.test.ts` keeps every other file off `clipboardData` and
// `navigator.clipboard`.
//
// What this rests on: the events fire on a focused element
// that is no text box, with nothing selected, in Chromium, Firefox, WebKit
// and Safari, with no workaround; `setData` counts only inside the event;
// WebKit writes `text/html` again in its own form, so the attribute is read
// by parsing, never by matching; and a keydown comes before its paste, so
// Shift held for Cmd+Shift+V is known by then.

import {
  CLIP_ATTRIBUTE,
  CLIP_MIME,
  type ClipFacts,
  clipOfFocus,
  type Intent,
  imageFiles,
  pastedFiles,
  planCopy,
  readPaste,
  targetOfFocus,
} from "@pinetrie/interface"
import { AT_INVENTORY, atColumn } from "@pinetrie/session"
import { useEffect } from "react"
import { type FocusContext, focusFacts } from "./focus.ts"
import { useStable } from "./use-stable.ts"

/**
 * Listen for the page's copy, cut and paste for as long as the page is
 * mounted. `context` and `facts` are read at each event, so they never go
 * stale; `onIntent` takes what the planners decided.
 */
export function useClipboard(p: {
  readonly context: () => FocusContext
  readonly facts: () => ClipFacts
  readonly onIntent: (intent: Intent) => void
}): void {
  const context = useStable(p.context)
  const facts = useStable(p.facts)
  const onIntent = useStable(p.onIntent)
  useEffect(() => {
    const host = window.location.origin
    // Whether the next paste is Cmd+Shift+V's, text alone: its keydown comes
    // first.
    let plainOnly = false
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "v") plainOnly = e.shiftKey
    }
    const onCopy = (cut: boolean) => (e: ClipboardEvent) => {
      const data = e.clipboardData
      if (data === null) return
      // gather
      const focus = focusFacts(context())
      // plan
      const plan = clipOfFocus(focus, facts(), cut)
      if (plan.kind === "browser") return
      const fragment = plan.clip.kind === "text" ? selectionHtml() : null
      const write = planCopy(plan.clip, fragment, {
        nonce: crypto.randomUUID(),
        host,
      })
      // execute
      data.setData("text/plain", write.plain)
      data.setData("text/html", write.html)
      data.setData(CLIP_MIME, write.custom)
      e.preventDefault()
      onIntent({ kind: "copied", clip: plan.clip })
      if (cut && plan.clip.kind === "card")
        onIntent({
          kind: "discard",
          card: plan.clip.of.card,
          at:
            focus.inPanel || focus.column === null
              ? AT_INVENTORY
              : atColumn(focus.column),
        })
    }
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData
      // A pasted image is the box's own, handled on it first.
      if (e.defaultPrevented || data === null) return
      // gather
      const focus = focusFacts(context())
      const received = {
        custom: data.getData(CLIP_MIME),
        attribute: carrierAttribute(data.getData("text/html")),
        plain: data.getData("text/plain"),
        plainOnly,
      }
      plainOnly = false
      // plan
      const target = targetOfFocus(focus)
      const clip = readPaste(received, host)
      if (target === null || (clip.kind === "text" && clip.text === "")) return
      // execute
      e.preventDefault()
      onIntent({ kind: "paste", clip, target })
      // What was pasted is what the clipboard holds: the cell shows it.
      onIntent({ kind: "copied", clip })
    }
    const copy = onCopy(false)
    const cut = onCopy(true)
    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("copy", copy)
    document.addEventListener("cut", cut)
    document.addEventListener("paste", onPaste)
    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("copy", copy)
      document.removeEventListener("cut", cut)
      document.removeEventListener("paste", onPaste)
    }
  }, [context, facts, onIntent])
}

/** The selection's own HTML, as the browser would copy it. */
function selectionHtml(): string | null {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  const holder = document.createElement("div")
  holder.append(selection.getRangeAt(0).cloneContents())
  return holder.innerHTML
}

/** `data-pinetrie` on the first element carrying it in `html`, parsed; null for none. */
function carrierAttribute(html: string): string | null {
  if (html === "") return null
  return (
    new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector(`[${CLIP_ATTRIBUTE}]`)
      ?.getAttribute(CLIP_ATTRIBUTE) ?? null
  )
}

/** Every file a paste brings (`pastedFiles`): what a card box shares. */
export const eventPastedFiles = (e: {
  readonly clipboardData: DataTransfer | null
}): File[] => (e.clipboardData === null ? [] : pastedFiles(e.clipboardData))

/** The image files a paste brings (`imageFiles`): what a picture field takes. */
export const pastedImages = (e: {
  readonly clipboardData: DataTransfer | null
}): File[] => (e.clipboardData === null ? [] : imageFiles(e.clipboardData))

/**
 * Write `text` from a button (`useCopy`), which has no copy event: the
 * clipboard's own call, or null where the page has no clipboard (plain
 * http, or a browser that hides it), for the caller's fallback.
 */
export function writeTextByButton(text: string): Promise<void> | null {
  const clipboard = navigator.clipboard as Clipboard | undefined
  return clipboard?.writeText === undefined ? null : clipboard.writeText(text)
}
