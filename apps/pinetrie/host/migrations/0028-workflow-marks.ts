// host/migrations/0028-workflow-marks — the workflow's open states gain their
// marks: Topics on the state named Topics, else the first open state; Active
// on the state named Active, if it is another. Read raw, since a workflow
// with no Topics no longer decodes. A workflow with any mark is left as it
// is, so over its own output it plans nothing.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { WORKFLOW } from "@pinetrie/rules"
import { rewriteRecords } from "./rewrite.ts"

type Raw = Readonly<Record<string, unknown>>

const isRaw = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A stored workflow with its states marked; null for one marked already, or not a workflow. */
export function workflowMarksNow(contents: unknown): object | null {
  if (!isRaw(contents) || !Array.isArray(contents.open)) return null
  const open: readonly unknown[] = contents.open
  if (open.length === 0 || !open.every(isRaw)) return null
  const states = open as readonly Raw[]
  if (states.some(s => "mark" in s)) return null
  const named = (name: string) => states.findIndex(s => s.name === name)
  const topics = Math.max(named("Topics"), 0)
  const active = named("Active")
  return {
    ...contents,
    open: states.map((s, i) =>
      i === topics
        ? { ...s, mark: "topics" }
        : i === active
          ? { ...s, mark: "active" }
          : s,
    ),
  }
}

export const workflowMarks = rewriteRecords({
  name: "0028-workflow-marks",
  namespace: WORKFLOW.namespace,
  home: WORKFLOW.home,
  rewrite: workflowMarksNow,
})
