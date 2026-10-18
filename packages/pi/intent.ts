// pi/intent — which tools take an `intent`, what the model is told it is, and
// the wrapper that requires it and keeps it from pi's own `execute`.

import {
  ASK_TOOL,
  BANNER_TOOL,
  BASH_TOOL,
  CATCH_UP_TOOL,
  CONFLICT_TOOL,
  EDIT_TOOL,
  FIND_TOOL,
  GREP_TOOL,
  LEAVE_TOOL,
  PROPOSE_TOOL,
  READ_TOOL,
  RESOLVE_TOOL,
  SAVE_BLOB_TOOL,
  SPLIT_TOOL,
  type ToolId,
  WRITE_TOOL,
} from "@pinetrie/core"

/**
 * Whether each tool takes a required `intent`: a record of every tool, so a
 * tool added later does not compile until someone decides. Those whose call
 * a person cannot read take one; `read`, `grep` and `find` already say in
 * plain words what they touched.
 */
export const TAKES_INTENT: Readonly<Record<ToolId, boolean>> = {
  [BASH_TOOL]: true,
  [EDIT_TOOL]: true,
  [WRITE_TOOL]: true,
  [READ_TOOL]: false,
  [GREP_TOOL]: false,
  [FIND_TOOL]: false,
  [CONFLICT_TOOL]: false,
  [CATCH_UP_TOOL]: false,
  [SPLIT_TOOL]: false,
  [BANNER_TOOL]: false,
  [ASK_TOOL]: false,
  [LEAVE_TOOL]: false,
  [RESOLVE_TOOL]: false,
  [SAVE_BLOB_TOOL]: false,
  [PROPOSE_TOOL]: false,
}

/** The argument's name, and what the model is told it is. */
export const INTENT_FIELD = "intent"
const INTENT_SCHEMA = {
  type: "string",
  description:
    'What this call is for, in a few plain words a person who is not a programmer can follow, e.g. "Run the unit tests" or "Find where tokens are refreshed". Shown in place of the call.',
} as const

/** A tool as pi makes it: what the wrapper reads and replaces. */
interface Wrapped {
  readonly parameters: {
    readonly properties?: Readonly<Record<string, unknown>>
    readonly required?: readonly string[]
  }
  readonly execute: (...args: never[]) => Promise<unknown>
}

/**
 * `tool` with a required `intent` first among its parameters, so a call
 * streams its intent before what it does. Its `execute` drops the intent
 * before pi's runs, so pi's tool sees only its own arguments. Its name,
 * description and everything else of pi's stay as they are. The schema is
 * written as plain JSON Schema: rebuilding pi's with TypeBox would mark its
 * optional parameters required.
 */
export function requireIntent<T extends Wrapped>(tool: T): T {
  const execute = tool.execute as (...args: unknown[]) => Promise<unknown>
  const { properties = {}, required = [] } = tool.parameters
  return {
    ...tool,
    parameters: {
      ...tool.parameters,
      properties: { [INTENT_FIELD]: INTENT_SCHEMA, ...properties },
      required: [INTENT_FIELD, ...required],
    },
    async execute(id: unknown, params: unknown, ...rest: unknown[]) {
      const { [INTENT_FIELD]: _, ...own } = (params ?? {}) as Record<
        string,
        unknown
      >
      return execute(id, own, ...rest)
    },
  }
}
