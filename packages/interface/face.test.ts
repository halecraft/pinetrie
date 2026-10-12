import {
  type CardPlace,
  cardIdOfKind,
  NO_CONTENT,
  type NoteColumnCard,
  type TextCard,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { NoteCard } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import type { Column } from "./columns.ts"
import {
  DETAIL_ON,
  type Detail,
  detailOf,
  type FaceFacts,
  faceOf,
  textFaceWords,
} from "./face.ts"
import { tree } from "./fixtures.ts"
import { foldedMark, foldedView, foldedWords } from "./folded-column-view.ts"
import { gridView } from "./grid-view.ts"
import { type ThreadFace, threadFace } from "./thread-face.ts"
import { builtInIconUrl, threadIcon } from "./thread-icon.ts"

const ADA = writerId("ada@x.test")
const BEA = writerId("bea@x.test")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const T = threadIdFor("t")
const N = cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000aa")
const C = cardIdFor("c1")

const text: TextCard = {
  kind: "text",
  id: C,
  owner: BEA,
  placer: BEA,
  place: { kind: "inventory", holder: ADA },
  content: { command: "bring-up-to-date", unsent: null, origin: null },
}
const note: NoteCard = {
  ...text,
  place: {
    kind: "note",
    column: cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000aa"),
    order: "a",
  },
}
const notes: NoteColumnCard = {
  kind: "note-column",
  id: N,
  owner: ADA,
  placer: ADA,
  place: { kind: "canvas", task: TASK, order: "a", width: 1 },
  content: NO_CONTENT,
}
const threadFaceOfT: ThreadFace = threadFace({
  thread: T,
  index: tree({ "1-r": null }),
  lanes: [],
  names: new Map([[T, "amber-fox" as never]]),
  iconFor: () => null,
})
const facts: FaceFacts = {
  tone: "inventory",
  key: "1",
  texts: new Map([[C, "\n\none\ntwo\nthree\nfour"]]),
  threads: new Map([[T, threadFaceOfT]]),
  notes: new Map([
    [N, { column: N, title: "Ideas", titled: "Ideas", notes: [note, note] }],
  ]),
}

describe("faceOf", () => {
  test("a text card: its first three lines, a short command chip, whose", () => {
    const face = faceOf(text, facts)
    expect(face).toEqual({
      kind: "text",
      card: C,
      tone: "inventory",
      owner: BEA,
      command: "bring-up-to-date",
      lines: "one\ntwo\nthree",
      key: "1",
    })
    expect(
      face.kind === "text" &&
        textFaceWords(face, { me: ADA, nameOf: new Map([[BEA, "Bea"]]) }),
    ).toEqual({ command: "catch up", owner: "Bea" })
  })

  test("a thread: its face; one this tab has not read, its id alone", () => {
    const card = {
      kind: "thread",
      id: T,
      owner: ADA,
      placer: ADA,
      place: { kind: "inventory", holder: ADA },
      content: NO_CONTENT,
    } as const
    expect(faceOf(card, facts)).toBe(threadFaceOfT)
    expect(faceOf(card, { ...facts, threads: new Map() })).toMatchObject({
      kind: "thread",
      thread: T,
      name: null,
    })
  })

  test("a note column: its title and how many notes it holds; unread, none", () => {
    expect(faceOf(notes, facts)).toEqual({
      kind: "note-column",
      card: N,
      title: "Ideas",
      notes: 2,
    })
    expect(faceOf(notes, { ...facts, notes: new Map() })).toMatchObject({
      notes: null,
    })
  })

  test("a folded column draws the face a grid's cell draws for the same card", () => {
    const cell = (card: typeof notes) =>
      gridView({
        grid: { width: 1, rows: 1 },
        tone: "inventory",
        placed: new Map([[0, card]]),
        selected: 0,
        texts: new Map(),
        threads: facts.threads,
        notes: facts.notes,
      }).cells[0]?.face
    const folded = foldedView(
      { kind: "notes", card: N, folded: true, width: 1 },
      { threadFaceOf: () => threadFaceOfT, notes: facts.notes },
    )
    expect(folded).toEqual(cell(notes))
    const thread = foldedView(
      { kind: "thread", card: T, column: {} as Column, folded: true, width: 1 },
      { threadFaceOf: () => threadFaceOfT, notes: facts.notes },
    )
    expect(thread).toBe(threadFaceOfT)
    expect(thread === null ? null : foldedWords(thread)).toEqual({
      title: "amber-fox",
      detail: null,
    })
    expect(folded === null ? null : foldedWords(folded)).toEqual({
      title: "Ideas",
      detail: "2 notes",
    })
  })
})

test("a thread's face carries its icon, a conversation's with no lane included", () => {
  const names = new Map([[T, "amber-fox" as never]])
  const face = threadFace({
    thread: T,
    index: tree({ "1-r": null }),
    lanes: [],
    names,
    iconFor: thread =>
      threadIcon({
        thread,
        names,
        banners: new Map(),
        icons: { source: "built-in" },
      }),
  })
  expect(face.icon).toEqual({
    kind: "built-in",
    url: builtInIconUrl("fox"),
  })
})

describe("foldedMark", () => {
  test("a thread's strip draws its icon, or ✦ without one; a note column's draws none", () => {
    expect(
      foldedMark({
        ...threadFaceOfT,
        icon: { kind: "banner", url: "/blob/a" },
      }),
    ).toEqual({
      kind: "thread",
      icon: { kind: "banner", url: "/blob/a", fade: false },
    })
    expect(foldedMark(threadFaceOfT)).toEqual({ kind: "thread", icon: null })
    const folded = foldedView(
      { kind: "notes", card: N, folded: true, width: 1 },
      { threadFaceOf: () => threadFaceOfT, notes: facts.notes },
    )
    expect(folded === null ? null : foldedMark(folded)).toEqual({
      kind: "none",
    })
  })
})

describe("detailOf", () => {
  test("a canvas draws whole, a dock or a list normal, an inventory faces; a fold is a face", () => {
    expect(detailOf("canvas", false)).toBe("whole")
    expect(detailOf("canvas", true)).toBe("face")
    expect(detailOf("queued", false)).toBe("normal")
    expect(detailOf("note", false)).toBe("normal")
    expect(detailOf("inventory", false)).toBe("face")
  })

  test("the table is total over places", () => {
    // @ts-expect-error: a place left out does not compile
    const missing: Record<CardPlace["kind"], Detail> = {
      composing: "normal",
    }
    expect(Object.keys(DETAIL_ON).length).toBeGreaterThan(
      Object.keys(missing).length,
    )
  })
})
