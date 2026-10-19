// The only globals pure code may name: `tsconfig.pure.json` type-checks every
// pure package against this file, with no DOM and no Node types, so `fetch`,
// `globalThis.fetch`, `process`, `Buffer`, timers and storage do not exist
// there. "Cannot find name" for one of them means take it from the caller, as
// the session takes `fetch` and the `WebSocket` constructor: never add it
// here. A global joins only as a decision, with the line before it naming a
// file under the pure config that needs it (`scripts/pure-globals.test.ts`).
// Each declares only the members that code uses.

/** `packages/core/images.ts`, `packages/rules/review.ts`: text measured and stored as UTF-8 bytes. */
declare class TextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer>
}

/** `packages/rules/shares.ts`: a shared file's bytes read as UTF-8, or refused as binary. */
declare class TextDecoder {
  constructor(
    label?: string,
    options?: { readonly fatal?: boolean; readonly ignoreBOM?: boolean },
  )
  decode(input?: ArrayBufferView | ArrayBuffer): string
}

/** `packages/rules/review.ts`: a review's request, parsed from the host's URL. */
interface URL {
  readonly pathname: string
  readonly searchParams: URLSearchParams
}

/** `packages/rules/review.ts`: a review's query, written and read. */
declare class URLSearchParams {
  constructor(init?: Readonly<Record<string, string>>)
  get(name: string): string | null
  toString(): string
}

/** `packages/core/runs.ts`: a call to the observer, given up when its caller stops. */
interface AbortSignal {
  readonly aborted: boolean
}
