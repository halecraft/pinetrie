// web/title-field — the field a title is edited in: a root's, in the sidebar,
// and a note column's. `planTitle` decides what a save sends.

import { planTitle, renameKey, SIDEBAR_WORDS } from "@pinetrie/interface"
import { MAX_TITLE } from "@pinetrie/threads"
import { useLayoutEffect, useRef, useState } from "react"

/**
 * A field holding a title while it is renamed: a root's in the sidebar, a
 * note column's in its head. Enter and leaving the field save, and Escape
 * cancels.
 */
export function TitleField({
  stored,
  placeholder,
  onSend,
  onEnd,
  label = SIDEBAR_WORDS.titleField,
}: {
  stored: string | null
  placeholder: string
  /** The field's accessible name. */
  label?: string
  onSend: (title: string | null) => void
  /** The field is done; `focusItem` when the keyboard ended it. */
  onEnd: (focusItem: boolean) => void
}) {
  const [text, setText] = useState(stored ?? "")
  const [invalid, setInvalid] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // Every way out comes here once. Removing a focused field can fire a blur
  // after Enter or Escape, which must not save again, or save a cancel.
  const done = useRef(false)
  useLayoutEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const finish = (save: boolean, focusItem: boolean) => {
    if (done.current) return
    if (save) {
      const plan = planTitle(text, stored)
      if (plan.kind === "refuse") {
        setInvalid(true)
        return
      }
      if (plan.kind === "send") onSend(plan.title)
    }
    done.current = true
    onEnd(focusItem)
  }
  return (
    <input
      aria-invalid={invalid}
      aria-label={label}
      className="open-title-input"
      maxLength={MAX_TITLE}
      onBlur={() => finish(true, false)}
      onChange={e => {
        setText(e.target.value)
        setInvalid(false)
      }}
      onKeyDown={e => {
        const step = renameKey(e.key)
        if (step === null) return
        e.preventDefault()
        finish(step.save, step.refocus)
      }}
      placeholder={placeholder}
      ref={input}
      value={text}
    />
  )
}
