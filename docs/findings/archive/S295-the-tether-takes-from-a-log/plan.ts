// S295's pure core: what a tether takes from a thread's intent log, framed
// by what each writer had seen, and one thread drawn from the log and the
// agent's record. No I/O: the shell (`probe.ts`) gathers both and carries
// the plan out.

/** One record of a thread's log, as its writer appended it: never edited in place. */
export type Intent =
  | {
      readonly kind: "message"
      readonly id: string
      readonly author: string
      readonly authorName: string
      readonly seq: number
      /** What the writer saw as the thread's end: an intent's id or an agent reply's entry id. */
      readonly parent: string | null
      readonly text: string
    }
  | {
      readonly kind: "edit"
      readonly id: string
      readonly author: string
      readonly seq: number
      /** The message it edits. */
      readonly of: string
      readonly before: string
      readonly text: string
    }

export type Message = Extract<Intent, { kind: "message" }>

/** The agent's record as the tether reads it from pi's tree: its thread, in order. */
export type RecordItem =
  /** A person's message the tether took; `intent` is its log id (`sendId`). */
  | { readonly kind: "person"; readonly intent: string; readonly entry: string }
  /** What the agent said. */
  | { readonly kind: "agent"; readonly entry: string; readonly text: string }

/** How a taken message is framed, decided by what its writer had seen. */
export type Framing =
  /** Its parent is the thread's end: as written. */
  | { readonly kind: "as-written" }
  /** Since its parent, only people's messages came, none answered: the same turn. */
  | { readonly kind: "same-time"; readonly with: readonly string[] }
  /** An agent reply came after its parent, which its writer had not seen. */
  | { readonly kind: "before-reply"; readonly reply: string; readonly to: string | null }

export type Take = { readonly intent: Message; readonly framing: Framing }

export type Plan =
  /** The agent is replying: nothing is taken until it has. */
  | { readonly kind: "wait-for-run" }
  | {
      readonly kind: "take"
      /** One turn, in order: all but the last are appended, the last runs. */
      readonly takes: readonly Take[]
      /** What is not taken, and why. */
      readonly left: readonly { readonly id: string; readonly why: Why }[]
    }

export type Why =
  | "taken"
  | "edit"
  /** Its parent is in neither the record nor the log: it has not arrived yet. */
  | "parent-not-arrived"

/** The position of `id` in the thread: a person's message by its intent, a reply by its entry. */
const idOf = (item: RecordItem): string =>
  item.kind === "person" ? item.intent : item.entry

/** How `parent` stands in `record`: what its writer had not seen since. */
export function framingAfter(
  record: readonly RecordItem[],
  parent: string | null,
): Framing {
  const at = parent === null ? -1 : record.findIndex(i => idOf(i) === parent)
  const since = record.slice(at + 1)
  if (since.length === 0) return { kind: "as-written" }
  const reply = since.findIndex(i => i.kind === "agent")
  if (reply === -1)
    return {
      kind: "same-time",
      with: since.flatMap(i => (i.kind === "person" ? [i.intent] : [])),
    }
  const replyItem = since[reply]
  // The message the unseen reply answered: the last one before it.
  const before = record.slice(0, at + 1 + reply)
  const answered = [...before].reverse().find(i => i.kind === "person")
  return {
    kind: "before-reply",
    reply: replyItem?.kind === "agent" ? replyItem.entry : "",
    to: answered?.kind === "person" ? answered.intent : null,
  }
}

/**
 * What the tether takes now, from its record and the whole log. Every
 * message not in the record whose parent is in the record, or is a message
 * taken earlier in this plan, is taken, in log order, each framed by the
 * record as it will stand when it is taken. The log's order converges but
 * is not causal, so a message waits for its parent, which may come later
 * in the list.
 */
export function planTake(input: {
  readonly record: readonly RecordItem[]
  readonly log: readonly Intent[]
  readonly running: boolean
}): Plan {
  if (input.running) return { kind: "wait-for-run" }
  const taken = new Set(
    input.record.flatMap(i => (i.kind === "person" ? [i.intent] : [])),
  )
  const known = new Set(input.record.map(idOf))
  const record = [...input.record]
  const takes: Take[] = []
  const left: { id: string; why: Why }[] = []
  let pending = input.log.filter(
    (i): i is Message => i.kind === "message" && !taken.has(i.id),
  )
  for (const i of input.log) {
    if (i.kind === "edit") left.push({ id: i.id, why: "edit" })
    else if (taken.has(i.id)) left.push({ id: i.id, why: "taken" })
  }
  // A pass takes every message whose parent is known; one that names a
  // message taken in this pass is taken in the next.
  for (;;) {
    // List order converges but is not causal: a pass is ordered by the
    // records' own ids, which a writer mints in time order.
    const ready = pending
      .filter(m => m.parent === null || known.has(m.parent))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
    if (ready.length === 0) break
    for (const m of ready) {
      takes.push({ intent: m, framing: framingAfter(record, m.parent) })
      record.push({ kind: "person", intent: m.id, entry: "" })
      known.add(m.id)
    }
    pending = pending.filter(m => !ready.includes(m))
  }
  for (const m of pending) left.push({ id: m.id, why: "parent-not-arrived" })
  return { kind: "take", takes, left }
}

/** What the model reads of a taken message: its framing, then its words as written. */
export function framedContent(
  take: Take,
  names: (intent: string) => string,
): string {
  const said = `${take.intent.authorName}: ${take.intent.text}`
  switch (take.framing.kind) {
    case "as-written":
      return said
    case "same-time":
      return `(${take.intent.authorName} wrote this at the same time as ${take.framing.with.map(names).join(" and ")}, before you answered.)\n${said}`
    case "before-reply":
      return `(${take.intent.authorName} wrote this before seeing your reply${take.framing.to === null ? "" : ` to ${names(take.framing.to)}`}. It may be out of date.)\n${said}`
  }
}

/** One thread as the page draws it. */
export type ThreadRow =
  | {
      readonly kind: "person"
      readonly intent: string
      readonly author: string
      /** As the log holds it now, with its edits. */
      readonly text: string
      /** As the agent took it, when it differs: an edit came after the take. */
      readonly agentRead: string | null
      /** Null until the tether takes it. */
      readonly framing: Framing | null
    }
  | { readonly kind: "agent"; readonly entry: string; readonly text: string }

/**
 * The agent's record, in its order, each person's message drawn from the
 * log with its edits; then the log's messages not taken yet, each with the
 * framing it would have if taken now. What the agent said comes from its
 * record alone, so an edit of it in the log never shows as what it said.
 */
export function projectThread(input: {
  readonly record: readonly RecordItem[]
  readonly log: readonly Intent[]
  /** What the agent read of each taken message: its `details.text`. */
  readonly read: ReadonlyMap<string, string>
}): readonly ThreadRow[] {
  const messages = new Map<string, Message>()
  const latest = new Map<string, string>()
  for (const i of input.log)
    if (i.kind === "message") {
      messages.set(i.id, i)
      latest.set(i.id, i.text)
    }
  for (const i of input.log)
    if (i.kind === "edit" && messages.get(i.of)?.author === i.author)
      latest.set(i.of, i.text)
  const rows: ThreadRow[] = []
  for (const [n, item] of input.record.entries()) {
    if (item.kind === "agent") {
      rows.push(item)
      continue
    }
    const m = messages.get(item.intent)
    const text = latest.get(item.intent) ?? input.read.get(item.intent) ?? ""
    const read = input.read.get(item.intent) ?? null
    rows.push({
      kind: "person",
      intent: item.intent,
      author: m?.authorName ?? "",
      text,
      agentRead: read !== null && read !== text ? read : null,
      framing: framingAfter(input.record.slice(0, n), m?.parent ?? null),
    })
  }
  const plan = planTake({ record: input.record, log: input.log, running: false })
  if (plan.kind === "take")
    for (const t of plan.takes)
      rows.push({
        kind: "person",
        intent: t.intent.id,
        author: t.intent.authorName,
        text: latest.get(t.intent.id) ?? t.intent.text,
        agentRead: null,
        framing: null,
      })
  return rows
}
