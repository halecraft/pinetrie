// decode — decoding for every shape pine·trie stores inside pi. Stored values
// may come from any replica, so decoding is total: a malformed value is
// dropped, never thrown, and cannot break every client's render.

import {
  CANVAS_PATTERN,
  type CanvasId,
  type CardId,
  type CommitId,
  type EntryId,
  entryId,
  isCanvasId,
  isNoteColumnId,
  isRootId,
  isThreadId,
  type NoteColumnId,
  type PointId,
  type RootId,
  THREAD_PATTERN,
  type ThreadId,
  type ThreadName,
  type WriterId,
} from "@pinetrie/core"
import { type Static, type TSchema, Type } from "typebox"
import { Compile } from "typebox/compile"

/** Each schema's checker, compiled the first time it checks a value. */
const checkers = new WeakMap<TSchema, (value: unknown) => boolean>()

/**
 * Whether `value` matches `schema`. Compiled once per schema object, so a
 * schema must be built once, at module level: one built in a decode would
 * compile at every call, slower than not compiling. Where code cannot be
 * evaluated (a page whose content security policy forbids eval), TypeBox
 * checks without compiling, with the same answers.
 */
export function isWellFormed<S extends TSchema>(
  schema: S,
  value: unknown,
): value is Static<S> {
  let check = checkers.get(schema)
  if (check === undefined) {
    const compiled = Compile(schema)
    check = v => compiled.Check(v)
    checkers.set(schema, check)
  }
  return check(value)
}

/**
 * Check `value` against `schema`, then brand it with `build`; undefined if it
 * does not match. `build` may refuse it too, by returning undefined: a
 * schema without the branded ids below checks each lane there with
 * `isThreadId`. A history message needs no `build` (`history.ts`).
 */
export function decodeWith<S extends TSchema, T>(
  schema: S,
  value: unknown,
  build: (wire: Static<S>) => T,
): T | undefined {
  return isWellFormed(schema, value) ? build(value) : undefined
}

/**
 * `decodeWith` for a record's contents at its address. `key` is
 * the address as one of the key readers below gives it, or undefined when
 * the address is malformed, and then so is the record.
 */
export function decodeRecord<S extends TSchema, K, T>(
  schema: S,
  contents: unknown,
  key: K | undefined,
  build: (wire: Static<S>, key: K) => T | undefined,
): T | undefined {
  return key === undefined
    ? undefined
    : decodeWith(schema, contents, wire => build(wire, key))
}

// An address read as the key it names, or undefined. Never parsed: each
// only checks and brands it.

export const textKey = (key: string): string | undefined =>
  key === "" ? undefined : key

export const entryKey = (key: string): EntryId | undefined =>
  key === "" ? undefined : entryId(key)

export const writerKey = (key: string): WriterId | undefined =>
  key === "" ? undefined : (key as WriterId)

export const threadKey = (key: string): ThreadId | undefined =>
  isThreadId(key) ? key : undefined

export const rootKey = (key: string): RootId | undefined =>
  isRootId(key) ? key : undefined

export const parseCanvasKey = (key: string): CanvasId | undefined =>
  isCanvasId(key) ? key : undefined

export const noteColumnKey = (key: string): NoteColumnId | undefined =>
  isNoteColumnId(key) ? key : undefined

/** A singleton's address: only `expected` names it. */
export const fixedKey = <K extends string>(
  expected: K,
  key: string,
): K | undefined => (key === expected ? expected : undefined)

// Branded ids as stored: each schema's `Static` is the brand, so a value that
// passes `isWellFormed` is already the code's own type. A lane is checked with
// core's `THREAD_PATTERN`, the pattern `isThreadId` tests.

/** A commit id as stored: never empty. */
export const CommitSchema = Type.Unsafe<CommitId>(Type.String({ minLength: 1 }))

/** A point as stored: the same string a commit id was, never empty. */
export const PointSchema = Type.Unsafe<PointId>(Type.String({ minLength: 1 }))

/** An entry's id as stored: never empty. */
export const EntryIdSchema = Type.Unsafe<EntryId>(Type.String({ minLength: 1 }))

/** A lane's name as stored (`THREAD_PATTERN`). */
export const ThreadIdSchema = Type.Unsafe<ThreadId>(
  Type.String({ pattern: THREAD_PATTERN }),
)

/** A canvas's id as stored (`CANVAS_PATTERN`). */
export const CanvasIdSchema = Type.Unsafe<CanvasId>(
  Type.String({ pattern: CANVAS_PATTERN }),
)

/** Who wrote something, as stored: never empty. */
export const WriterIdSchema = Type.Unsafe<WriterId>(
  Type.String({ minLength: 1 }),
)

/** A thread's two-word name, as stored: never empty. */
export const ThreadNameSchema = Type.Unsafe<ThreadName>(
  Type.String({ minLength: 1 }),
)

/** A card's id, as stored: never empty. */
export const CardIdSchema = Type.Unsafe<CardId>(Type.String({ minLength: 1 }))

/** An array as the code's types hold it: its `Static` is a `readonly` array. */
export const List = <T extends TSchema>(item: T) =>
  Type.Immutable(Type.Array(item))
