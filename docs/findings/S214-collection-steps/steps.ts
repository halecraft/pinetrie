// Count Map/Set iteration steps by patching their prototypes; run the real
// functions and their mutants at two sizes.

import { unattributed } from "../../../packages/rules/disk.ts"

type Proto = Record<PropertyKey, unknown>
export function collectionSteps<T>(f: () => T): { result: T; steps: number } {
  let steps = 0
  const saved: [Proto, PropertyKey, unknown][] = []
  const wrapIter = (proto: Proto, key: PropertyKey) => {
    const orig = proto[key] as (this: unknown) => Iterator<unknown>
    saved.push([proto, key, orig])
    proto[key] = function* (this: unknown) {
      for (const v of { [Symbol.iterator]: () => orig.call(this) }) {
        steps++
        yield v
      }
    }
  }
  const wrapForEach = (proto: Proto) => {
    const orig = proto.forEach as (
      this: unknown,
      cb: (...a: unknown[]) => void,
      t?: unknown,
    ) => void
    saved.push([proto, "forEach", orig])
    proto.forEach = function (
      this: unknown,
      cb: (...a: unknown[]) => void,
      t?: unknown,
    ) {
      orig.call(this, (...a: unknown[]) => {
        steps++
        cb.apply(t, a)
      })
    }
  }
  for (const proto of [Map.prototype, Set.prototype] as unknown as Proto[]) {
    for (const k of ["keys", "values", "entries", Symbol.iterator])
      wrapIter(proto, k)
    wrapForEach(proto)
  }
  try {
    return { result: f(), steps }
  } finally {
    for (const [p, k, o] of saved) p[k] = o
  }
}

const written = (...paths: string[]) => ({
  classes: new Map(paths.map(p => [p, "local" as const])),
  made: [],
  roots: new Map(),
  gone: [],
  unignored: [],
  leftovers: [],
})
const diffOf = (...paths: string[]) => ({
  changes: paths.map(path => ({
    path,
    change: "added" as const,
    kind: "file" as const,
  })),
})
for (const n of [1000, 2000]) {
  const paths = Array.from(
    { length: n },
    (_, i) => `node_modules/.pnpm/p${i % 50}/f${i}`,
  )
  const { steps, result } = collectionSteps(() =>
    unattributed(
      written(...[...paths].reverse()) as never,
      diffOf(...paths, "stray") as never,
      [],
    ),
  )
  console.log("disk", n, steps, JSON.stringify(result))
}
// a hand mutant shaped as the mutation list's: a scan of the Set per path
const mutantScan = (ws: Set<string>, ps: string[]) =>
  ps.filter(p => ![...ws].some(w => w === p))
for (const n of [1000, 2000]) {
  const ws = new Set(Array.from({ length: n }, (_, i) => `w${i}`))
  console.log(
    "mutant-spread",
    n,
    collectionSteps(() => mutantScan(ws, [...ws])).steps,
  )
  const m = new Map([...ws].map(w => [w, 1]))
  console.log(
    "mutant-keys-filter",
    n,
    collectionSteps(() =>
      [...ws].map(p => [...m.keys()].filter(k => k.startsWith(p)).length),
    ).steps,
  )
  console.log("new Set(set)", n, collectionSteps(() => new Set(ws)).size)
  console.log(
    "new Set(set) steps",
    n,
    collectionSteps(() => new Set(ws)).steps,
    "Array.from",
    collectionSteps(() => Array.from(m)).steps,
    "for-of",
    collectionSteps(() => {
      let c = 0
      for (const _ of m) c++
      return c
    }).steps,
    "forEach",
    collectionSteps(() => {
      let c = 0
      m.forEach(() => {
        c++
      })
      return c
    }).steps,
  )
}
