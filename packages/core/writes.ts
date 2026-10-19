// core/writes — where a host record's write goes (`Target`, `Home`) and the
// write itself (`ValueWrite`), which packages below the commands carry out.

import type { RootId } from "./ids.ts"

/** A namespace of the host's own records. pi's are `pi.`, and never the host's to write. */
export type HostNamespace = `pinetrie.${string}`
/** Which document a host record is written to: the session's, or a root's. */
export type Target =
  | { readonly kind: "session" }
  | { readonly kind: "root"; readonly root: RootId }

/** Which document a record lives in: the session's, or a root's. */
export type Home = Target["kind"]

/** A target in `H`. */
type TargetIn<H extends Home> = Extract<Target, { readonly kind: H }>

export const SESSION_TARGET: TargetIn<"session"> = { kind: "session" }

/**
 * One write to a pi value at its address, in its document, as the host decides
 * it and pi's session carries it out. Built by `setRecord` and `deleteRecord`
 * (`@pinetrie/rules`), which take the target from the record's home, and say
 * it in `H`: a write into a root is reached only through a step's documents.
 */
export type ValueWrite<H extends Home = Home> =
  | {
      readonly kind: "set"
      readonly target: TargetIn<H>
      readonly namespace: HostNamespace
      readonly key: string
      readonly value: unknown
    }
  | {
      readonly kind: "delete"
      readonly target: TargetIn<H>
      readonly namespace: HostNamespace
      readonly key: string
    }
