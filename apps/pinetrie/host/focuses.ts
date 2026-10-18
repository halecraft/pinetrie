// host/focuses — each thread's focus, asked of a model once its run's end has
// settled (`RunEndSettled`, `digests.ts`), so the request reads the run's
// final headline. `planFocus` and `focusToWrite` decide, and `parseFocus`
// reads the reply; this carries them out, the step and the answer each a late
// write (`later.ts`), so none lands in a thread archived or gone meanwhile.
//
// No request is held per thread: a run that ends while another's focus is out
// asks too, and `focusToWrite` keeps the newer ask's.

import { indexAsks } from "@pinetrie/core"
import type { PiSetup } from "@pinetrie/pi"
import { readDigests, readFocuses, readTreeIndex } from "@pinetrie/reads"
import {
  FOCUS,
  focusRequest,
  focusToWrite,
  parseFocus,
  planFocus,
  setRecord,
} from "@pinetrie/rules"
import { askModel, oneAnswer } from "./ask-model.ts"
import type { Basics } from "./basics.ts"
import type { RunEndSettled } from "./digests.ts"
import type { Later } from "./later.ts"

/** A focus request's size: the skill aside, the focus, the first ask and the newest. */
const FOCUS_BUDGET = 12_000

/** A failure goes to `failed`, never to the caller. */
export interface Focuses {
  /** That run's end has settled: its thread's focus, asked when due. */
  ended(settled: RunEndSettled, failed: (error: unknown) => void): Promise<void>
}

export function createFocuses(deps: {
  readonly basics: Pick<Basics, "session" | "log" | "now">
  readonly later: Later
  /** The model a focus is asked of, and its skill. */
  readonly piSetup: Pick<PiSetup, "complete" | "skill">
  /** The settled `digests.enabled`: a focus reads its asks' headlines. */
  readonly enabled: boolean
  /** Tokens a request for `ask`'s run spent, as a digest's are counted. */
  readonly spent?: (ask: RunEndSettled["ask"], tokens: number) => void
}): Focuses {
  const { basics, later } = deps
  const { session } = basics

  const ended = (settled: RunEndSettled, failed: (error: unknown) => void) => {
    const { root, lane, ask } = settled
    const scope = { kind: "thread", thread: lane } as const
    return later
      .step(scope, "a thread's focus", async roots => {
        const doc = await roots.root(root)
        const index = readTreeIndex(doc)
        const plan = planFocus({
          enabled: deps.enabled,
          index,
          asks: indexAsks(index),
          thread: lane,
          digests: readDigests(doc),
          settled: { ask, digest: settled.digest },
          stored: readFocuses(session).get(lane),
        })
        if (plan === null) return null
        void later.outside({
          scope,
          what: "a thread's focus",
          failed,
          request: async () => {
            const { value, tokens } = await askModel(
              { piSetup: deps.piSetup, log: basics.log },
              {
                skill: "pinetrie:skill:thread-focus",
                request: skill =>
                  focusRequest({ skill, plan, budget: FOCUS_BUDGET }),
                parse: oneAnswer(parseFocus, "focus"),
              },
            )
            deps.spent?.(ask, tokens)
            return value ?? null
          },
          plan: reply => {
            const record = focusToWrite({
              stored: readFocuses(session).get(lane),
              reply,
              thread: lane,
              ask,
              at: basics.now(),
            })
            return record === null
              ? null
              : { records: [setRecord(FOCUS, record)] }
          },
        })
        return null
      })
      .catch(failed)
  }

  return { ended }
}
