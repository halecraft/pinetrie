// host/move-history — each person's history of moves, per root (ADR-0066).
//
// Kyneta undoes only the writes its own runtime made, and the host is the one
// writer of the places document, so the stacks live here: one per writer and
// root, `moves:<writer>:<root>`, kept in the host's store, so a person's tabs
// share it and it outlives a restart (S91). Every undo is whole or refused
// (`whole: true`): without it, a step someone else's move broke would be
// skipped and an older one undone out of sight (S82). A stack is made on its
// first use, loaded from the store if it was kept, and unloaded when nobody
// can use it.

import {
  createUndoStack,
  type Exchange,
  type UndoneWhole,
  type UndoStack,
} from "@kyneta/exchange"
import {
  type MoveDirection,
  movesDocId,
  movesOfDocId,
  type RootId,
  type WriterId,
} from "@pineta/core"
import { PLACES_DOC_ID } from "@pineta/protocol/messages"
import type { Gesture } from "./places.ts"

export interface MoveHistories {
  /** One step of `writer`'s history in `root`, its stack loaded first. */
  gestureOf(writer: WriterId, root: RootId): Promise<Gesture>
  /** Undo or redo `writer`'s newest step in `root`, whole or refused. */
  step(
    writer: WriterId,
    root: RootId,
    direction: MoveDirection,
  ): Promise<UndoneWhole>
  /** The writers with a stack loaded now. */
  loaded(): readonly WriterId[]
  /** Unload every stack of these writers: their last seat left. */
  unloadWriters(writers: readonly WriterId[]): Promise<void>
  /** Unload every stack in `root`: it was archived. */
  unloadRoot(root: RootId): Promise<void>
  /** Destroy these stack documents, loaded or not (S91). */
  retire(docIds: readonly string[]): Promise<void>
  dispose(): void
}

export function createMoveHistories(exchange: Exchange): MoveHistories {
  // A stack still being made is kept as its promise, so two uses at once
  // make one.
  const stacks = new Map<string, Promise<UndoStack>>()
  const stackOf = (writer: WriterId, root: RootId): Promise<UndoStack> => {
    const docId = movesDocId(writer, root)
    const held = stacks.get(docId)
    if (held !== undefined) return held
    const made = createUndoStack({
      exchange,
      docId,
      key: "moves",
      scope: id => id === PLACES_DOC_ID,
    })
    stacks.set(docId, made)
    return made
  }
  /** Dispose these stacks, keep what they hold, and let their documents go. */
  const unload = async (docIds: readonly string[]): Promise<void> => {
    for (const docId of docIds) {
      const held = stacks.get(docId)
      stacks.delete(docId)
      ;(await held)?.dispose()
    }
    if (docIds.length === 0) return
    await exchange.flush()
    for (const docId of docIds) await exchange.unload(docId)
  }
  const held = (keep: (of: { writer: WriterId; root: RootId }) => boolean) =>
    [...stacks.keys()].filter(docId => {
      const of = movesOfDocId(docId)
      return of !== undefined && keep(of)
    })
  return {
    async gestureOf(writer, root) {
      const stack = await stackOf(writer, root)
      return write => stack.gesture(write)
    },
    async step(writer, root, direction) {
      const stack = await stackOf(writer, root)
      return direction === "undo"
        ? stack.undo({ whole: true })
        : stack.redo({ whole: true })
    },
    loaded() {
      return [
        ...new Set(
          held(() => true).flatMap(d => movesOfDocId(d)?.writer ?? []),
        ),
      ]
    },
    unloadWriters(writers) {
      return unload(held(of => writers.includes(of.writer)))
    },
    unloadRoot(root) {
      return unload(held(of => of.root === root))
    },
    async retire(docIds) {
      for (const docId of docIds) {
        const stack = stacks.get(docId)
        stacks.delete(docId)
        ;(await stack)?.dispose()
        await exchange.destroy(docId)
      }
    },
    dispose() {
      for (const stack of stacks.values()) void stack.then(s => s.dispose())
      stacks.clear()
    },
  }
}
