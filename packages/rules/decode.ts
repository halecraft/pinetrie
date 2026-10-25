// decode — decoding for every shape pine·trie stores inside pi. Stored values
// may come from any replica, so decoding is total: a malformed value is
// dropped, never thrown, and cannot break every client's render.

import {
  type AgentId,
  CANVAS_PATTERN,
  type CanvasId,
  type CommitId,
  type EntryId,
  entryId,
  isCanvasId,
  isRootId,
  isThreadId,
  type PointId,
  pointId,
  type RootId,
  THREAD_PATTERN,
  type ThreadId,
  type ThreadName,
  type WriterId,
} from "@pinetrie/core"
import {
  type CardId,
  isTitledCardId,
  parseCardId,
  type TitledCardId,
} from "@pinetrie/threads"
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
 * A record's contents at its address -> the record, or undefined when either
 * is malformed. It carries the schema it checks with, so a spec's type names
 * that schema, and its `encode` must return the same schema's type
 * (`RecordSpec`).
 */
export interface RecordDecoder<R, S extends TSchema> {
  (contents: unknown, key: string): R | undefined
  readonly schema: S
}

/**
 * A record's decoder: `readKey` reads the address, with one of the key
 * readers below, and undefined there drops the record; `build` makes the
 * record from contents `schema` accepted, and may refuse them too.
 */
export function recordDecoder<S extends TSchema, A, R>(
  schema: S,
  readKey: (key: string) => A | undefined,
  build: (wire: Static<S>, key: A) => R | undefined,
): RecordDecoder<R, S> {
  const decode = (contents: unknown, key: string): R | undefined => {
    const address = readKey(key)
    return address === undefined
      ? undefined
      : decodeWith(schema, contents, wire => build(wire, address))
  }
  return Object.assign(decode, { schema })
}

// An address read as the key it names, or undefined. Never parsed: each
// only checks and brands it.

export const textKey = (key: string): string | undefined =>
  key === "" ? undefined : key

export const entryKey = (key: string): EntryId | undefined =>
  key === "" ? undefined : entryId(key)

export const pointKey = (key: string): PointId | undefined =>
  key === "" ? undefined : pointId(key)

export const writerKey = (key: string): WriterId | undefined =>
  key === "" ? undefined : (key as WriterId)

export const threadKey = (key: string): ThreadId | undefined =>
  isThreadId(key) ? key : undefined

export const rootKey = (key: string): RootId | undefined =>
  isRootId(key) ? key : undefined

export const parseCanvasKey = (key: string): CanvasId | undefined =>
  isCanvasId(key) ? key : undefined

export const titledCardKey = (key: string): TitledCardId | undefined => {
  const card = parseCardId(key)
  return card !== undefined && isTitledCardId(card) ? card : undefined
}

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

/**
 * Who wrote a title, as stored: a person or the agent (`isAgentId` tells
 * them apart), never empty.
 */
export const AuthorSchema = Type.Unsafe<WriterId | AgentId>(
  Type.String({ minLength: 1 }),
)

/** A thread's two-word name, as stored: never empty. */
export const ThreadNameSchema = Type.Unsafe<ThreadName>(
  Type.String({ minLength: 1 }),
)

/**
 * A closed set's schema, from the `as const` list its type is built from
 * too, so the stored shape and the type cannot accept different values.
 * A union built from an array, not a tuple, has `never` for its `Static`,
 * which takes any value the type checker meets, so its `Static` is given.
 */
export const choiceSchema = <V extends string>(values: readonly V[]) =>
  Type.Unsafe<V>(Type.Union(values.map(v => Type.Literal(v))))

/** A card's id, as stored: never empty. */
export const CardIdSchema = Type.Unsafe<CardId>(Type.String({ minLength: 1 }))

/** An array as the code's types hold it: its `Static` is a `readonly` array. */
export const List = <T extends TSchema>(item: T) =>
  Type.Immutable(Type.Array(item))
