// Decoding for every shape Pineta stores inside pi.
//
// Stored values are `Schema.any()` in the document and may come from any
// replica, so decoding is total: a malformed value is dropped, never thrown.
// One bad value must not break every client's render.

import {
  type EntryId,
  entryId,
  isLaneName,
  isRootId,
  type LaneName,
  type RootId,
  type WriterId,
} from "@pineta/core"
import { type Static, type TSchema, Type } from "typebox"
import { Value } from "typebox/value"

/**
 * Check `value` against `schema`, then brand it with `build`; undefined if it
 * does not match. `build` may refuse it too, by returning undefined: each
 * lane is checked there with `isLaneName`.
 */
export function decodeWith<S extends TSchema, T>(
  schema: S,
  value: unknown,
  build: (wire: Static<S>) => T,
): T | undefined {
  return Value.Check(schema, value) ? build(value as Static<S>) : undefined
}

/**
 * `decodeWith` for a record's contents at its address (ADR-0062). `key` is
 * the address as one of the key readers below gives it, or undefined when
 * the address is malformed, and then so is the record.
 */
export function decodeAt<S extends TSchema, K, T>(
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

export const laneKey = (key: string): LaneName | undefined =>
  isLaneName(key) ? key : undefined

export const rootKey = (key: string): RootId | undefined =>
  isRootId(key) ? key : undefined

/** A singleton's address: only `expected` names it. */
export const fixedKey = <K extends string>(
  expected: K,
  key: string,
): K | undefined => (key === expected ? expected : undefined)

/** A commit id as a record stores it: never empty. */
export const CommitSchema = Type.String({ minLength: 1 })
