// web/card-box — the shell of a box that makes its card at the first input
// worth keeping: your message's (`CardEditor`) and a new card's
// (`NewCardBox`). `editorState` (`@pinetrie/interface`) decides each step;
// this hook carries its acts out on one textarea for the box's whole life,
// so no keystroke falls between the card existing and the element being
// bound, and focus and the caret never move.

import { attach } from "@kyneta/react"
import { subscribe } from "@kyneta/schema"
import type { CardId, TextCardId } from "@pinetrie/core"
import {
  type EditorEvent,
  type EditorState,
  editorState,
  type Prefill,
  shownBy,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import { type RefObject, useEffect, useRef, useState } from "react"

/**
 * Bind a box to a card's text, its undo reaching only that card's steps, and
 * tell `onText` the text now and at every change, others' edits included.
 * Returns the unbinding.
 */
export function bindText(
  session: SessionClient,
  id: TextCardId,
  el: HTMLTextAreaElement,
  onText: (text: string) => void,
): () => void {
  const doc = session.cardText(id)
  const off = attach(el, doc.text, { undo: session.undoFor(id) })
  onText(doc.text())
  const stop = subscribe(doc, () => onText(doc.text()))
  return () => {
    off()
    stop()
  }
}

interface CardBox {
  /** The textarea: give it as its `ref`. */
  readonly box: RefObject<HTMLTextAreaElement | null>
  readonly state: EditorState
  /** The state as the handlers last left it, read synchronously between renders. */
  readonly current: RefObject<EditorState>
  /** The box's text, as shown: the element's while local, the card's while bound. */
  readonly text: string
  /** Set the shown text from an `input` event, which the binding does not see while local. */
  readonly setText: (text: string) => void
  /** The card the element is bound to now, or null. */
  readonly boundTo: () => TextCardId | null
  /** One step of `editorState`, its acts carried out in order. */
  readonly step: (event: EditorEvent) => void
}

export function useCardBox(p: {
  session: SessionClient
  /** The card the box is bound to as it mounts, if any. */
  start: TextCardId | undefined
  /** The text it shows as it mounts, unbound. */
  startText: string
  prefill: Prefill | undefined
  /**
   * The card the box's place holds now, as the caller finds it from what the
   * box is, or undefined: the box finds it, or finds its own card gone.
   */
  found: (state: EditorState) => TextCardId | undefined
  /** The caller's box is read-only; a send in flight makes it so too. */
  readOnly: boolean
  /** Make card `card` holding `text`; false when it cannot be made. */
  make: (card: TextCardId, text: string) => boolean
}): CardBox {
  const { session } = p
  const box = useRef<HTMLTextAreaElement>(null)
  const [state, setState] = useState<EditorState>(() =>
    p.start === undefined
      ? { kind: "local" }
      : { kind: "bound", card: p.start },
  )
  const current = useRef(state)
  const [text, setText] = useState(p.startText)
  const detach = useRef<(() => void) | null>(null)

  /** Bind the box to a card's text, keeping the caret where it is. */
  const bind = (id: TextCardId) => {
    const el = box.current
    if (el === null) return
    detach.current?.()
    const { selectionStart, selectionEnd } = el
    detach.current = bindText(session, id, el, setText)
    el.setSelectionRange(selectionStart, selectionEnd)
  }
  /**
   * Unbind the box, and empty it. Kyneta's detach puts back the `readOnly`
   * the box had when it was bound, which React then no longer knows of: a
   * box bound while it was read-only would stay so. So it is set again from
   * what the box is now.
   */
  const unbind = () => {
    detach.current?.()
    detach.current = null
    const el = box.current
    if (el !== null) {
      el.value = ""
      el.readOnly = p.readOnly || current.current.kind === "sending"
    }
    setText("")
  }
  /** A card that cannot be made ends the step: nothing is bound to it. */
  const step = (event: EditorEvent): void => {
    const next = editorState(current.current, event, p.prefill)
    current.current = next.state
    setState(next.state)
    for (const act of next.acts)
      switch (act) {
        case "create": {
          const el = box.current
          if (
            el === null ||
            next.state.kind !== "bound" ||
            !p.make(next.state.card, el.value)
          )
            return
          break
        }
        case "attach":
          if (next.state.kind === "bound") bind(next.state.card)
          break
        case "detach":
          unbind()
          break
      }
  }

  // The card as the caller finds it: found, or gone. Gone only once it was
  // seen: a card just created is not in the records until they redraw. A box
  // left empty finds the card the caller gives it then: one put there while
  // this one was being written.
  const seen = useRef<CardId | null>(null)
  const held = p.found(state)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the card's coming and going, and the box coming free
  useEffect(() => {
    const now = current.current
    const found = held
    if (found !== undefined) {
      if (now.kind === "bound" && now.card === found) {
        seen.current = found
        if (detach.current === null) bind(found)
      } else if (now.kind === "bound") {
        // Another card took its place: a card dropped here, whose swap
        // took the one it showed away (`planPut`).
        step({ kind: "gone" })
        seen.current = found
        step({ kind: "found", card: found })
      } else if (now.kind === "local") {
        seen.current = found
        step({ kind: "found", card: found })
      }
    } else if (now.kind === "bound" && seen.current === now.card) {
      step({ kind: "gone" })
    }
  }, [held, state.kind === "local"])
  // Unbound on unmount. StrictMode mounts twice, so the handle is cleared
  // too: the second mount binds again.
  useEffect(
    () => () => {
      detach.current?.()
      detach.current = null
    },
    [],
  )
  const boundTo = () =>
    detach.current === null ? null : shownBy(current.current)
  return { box, state, current, text, setText, boundTo, step }
}
