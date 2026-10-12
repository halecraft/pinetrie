// reach — where a thread is, for another thread's agent to be asked there, to
// answer there, or for a link to open it.

import type {
  ArchivedTask,
  Away,
  CardRecord,
  Reach,
  TaskId,
  ThreadId,
  ThreadName,
  WriterId,
} from "@pinetrie/core"
import type { CanvasCard } from "./task.ts"

/** `thread`'s reach now, from its card's place and the archive. */
export function threadReach(
  thread: ThreadId,
  facts: {
    readonly cards: readonly CardRecord[]
    readonly archived: ReadonlyMap<TaskId, ArchivedTask>
  },
): Reach {
  const place = facts.cards.find(c => c.id === thread)?.place
  if (place?.kind === "inventory") return { kind: "held", by: place.holder }
  if (place?.kind === "trash" && place.left.kind === "canvas")
    return { kind: "trashed", task: place.left.task }
  if (place?.kind !== "canvas") return { kind: "gone" }
  const record = facts.archived.get(place.task)
  return record === undefined
    ? { kind: "open", task: place.task }
    : { kind: "archived", task: place.task, record }
}

/**
 * Every named thread on an open task's canvas, in each canvas's order: the
 * other threads' agents a message may name (`agentCandidates`, core). The
 * host and the page build their candidates from it alike.
 */
export function reachableAgents(input: {
  readonly canvases: ReadonlyMap<TaskId, readonly CanvasCard[]>
  readonly archived: { readonly has: (task: TaskId) => boolean }
  readonly names: ReadonlyMap<ThreadId, ThreadName>
}): readonly {
  readonly thread: ThreadId
  readonly name: ThreadName
  readonly task: TaskId
}[] {
  return [...input.canvases].flatMap(([task, cards]) =>
    input.archived.has(task)
      ? []
      : cards.flatMap(c => {
          if (c.kind !== "thread") return []
          const name = input.names.get(c.id)
          return name === undefined ? [] : [{ thread: c.id, name, task }]
        }),
  )
}

/** Why `name` is out of reach, as a sentence. */
export function reachWords(
  name: string,
  reach: Away,
  nameOf: (w: WriterId) => string,
): string {
  switch (reach.kind) {
    case "archived":
      return `${name}'s task was archived by ${nameOf(reach.record.by)}`
    case "held":
      return `${nameOf(reach.by)} has ${name}`
    case "trashed":
      return `${name} is in the trash`
    case "gone":
      return `${name} is no longer on any task`
  }
}

/** Why a member is away, in a few words after its name. */
export function awayWords(
  reach: Away,
  nameOf: (w: WriterId) => string,
): string {
  switch (reach.kind) {
    case "archived":
      return `archived by ${nameOf(reach.record.by)}`
    case "held":
      return `${nameOf(reach.by)} has it`
    case "trashed":
      return "in the trash"
    case "gone":
      return "gone"
  }
}
