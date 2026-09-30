// host/notes — each note's text (ADR-0025), held for the life of the process,
// and every edit to it attributed.

import { type Exchange, whenHydrated } from "@kyneta/exchange"
import { unwrap } from "@kyneta/schema"
import type { NoteId, NoteRecord } from "@pineta/core"
import { planNoteEdit } from "@pineta/marginalia"
import { readNotes } from "@pineta/reads"
import {
  NoteDoc,
  type NoteDocHandle,
  noteAuthors,
  noteDocId,
  type SessionDocHandle,
} from "@pineta/schema"
import type { Serial } from "./queue.ts"

export interface NoteTexts {
  /**
   * Hold a note's text, seeded with `seed` if it is new, and attribute every
   * later edit.
   */
  hold(id: NoteId, seed: string | null): Promise<NoteDocHandle>
  /** A held note's text; undefined for a note not held. */
  text(id: NoteId): string | undefined
  /** Stop attributing edits: the host's shutdown. */
  release(): void
}

export function startNoteTexts(input: {
  readonly exchange: Exchange
  readonly doc: SessionDocHandle
  readonly serial: Serial
  readonly setNote: (note: NoteRecord) => Promise<void>
}): NoteTexts {
  const { exchange, doc, serial } = input
  const notes = new Map<NoteId, { doc: NoteDocHandle; release: () => void }>()

  /**
   * Each change's `clientID`s whose clocks moved, and the person behind each
   * connected seat's `clientID`, are gathered as the edit arrives, while its
   * sender is certainly connected: by the serial step, it may have gone.
   * `planNoteEdit` decides, and a changed record is written in that step.
   * The operations themselves say which seat wrote them (S26 addendum,
   * ADR-0037).
   */
  async function hold(id: NoteId, seed: string | null): Promise<NoteDocHandle> {
    const held = notes.get(id)
    if (held !== undefined) return held.doc
    const note = exchange.get(noteDocId(id), NoteDoc)
    // A stored note is loaded first, so its history is not taken for new edits.
    await whenHydrated(note)
    if (seed !== null && seed !== "") note.text.insert(0, seed)
    const ydoc = unwrap(note)
    const onChange = (tr: {
      beforeState: Map<number, number>
      afterState: Map<number, number>
    }) => {
      const changed = [...tr.afterState].flatMap(([client, clock]) =>
        clock > (tr.beforeState.get(client) ?? 0) ? [client] : [],
      )
      if (changed.length === 0) return
      const authors = noteAuthors(exchange.peers.current.values())
      void serial.run(async () => {
        const record = readNotes(doc).find(n => n.id === id)
        if (record === undefined) return
        const next = planNoteEdit(record, { changed, authors })
        if (next !== null) await input.setNote(next)
      })
    }
    ydoc.on("afterTransaction", onChange)
    notes.set(id, {
      doc: note,
      release: () => ydoc.off("afterTransaction", onChange),
    })
    return note
  }

  return {
    hold,
    text: id => notes.get(id)?.doc.text(),
    release() {
      for (const n of notes.values()) n.release()
    },
  }
}
