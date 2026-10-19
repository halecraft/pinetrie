// tui/draw — a thread as a terminal draws it: lines of text, from
// `@pinetrie/interface`'s views alone. Its assembly (which views, with which
// facts) is its own, as the page's is in its components; what each line
// says is interface's. Each switch over a union interface hands it is
// exhaustive, so a new kind fails the type check until it is drawn here.

import {
  assertNever,
  type EntryId,
  type SpineNode,
  type ThreadId,
  threadLane,
  type WriterId,
} from "@pinetrie/core"
import {
  type AskRow,
  askView,
  type ColumnRow,
  type HeldView,
  lastEndedAsk,
  pathRows,
  planAskWork,
  planSend,
  projectColumns,
  readHeldLanes,
  readSessionFacts,
  type SessionFacts,
  sendButton,
  speakerWords,
} from "@pinetrie/interface"

/** Who reads, and what they are about to send. */
export interface Reader {
  readonly me: WriterId
  readonly nameOf: ReadonlyMap<WriterId, string>
  /** The composer's text. */
  readonly draft: string
}

/** The column's messages, by entry: what a message row draws. */
type Nodes = ReadonlyMap<EntryId, SpineNode>

/** One message as a line: who said it, and its text's first line. */
function messageLine(nodes: Nodes, id: EntryId, reader: Reader): string {
  const node = nodes.get(id)
  if (node === undefined) return `· ${id}`
  return `${speakerWords(node, reader.nameOf)}: ${node.text.split("\n")[0] ?? ""}`
}

/** An ask's work, as story density draws it, its digest at its anchor. */
function askLines(
  facts: SessionFacts,
  nodes: Nodes,
  row: Extract<ColumnRow, { kind: "ask" }>,
  lastEnded: EntryId | null,
  reader: Reader,
): readonly string[] {
  const view = askView({
    index: facts.index,
    asks: facts.asks,
    ask: row.ask,
    runningAsk: null,
    lastEnded,
    revisions: facts.workFacts.revisions,
    digests: facts.digests,
    releasedPath: null,
    nameOf: w => reader.nameOf.get(w) ?? w,
  })
  const draw = planAskWork(view, row.parts, { choice: null, density: "story" })
  const summary =
    draw.summary === null
      ? []
      : [
          `  ◆ ${draw.summary.headline}`,
          ...draw.summary.pointsMarkdown
            .split("\n")
            .filter(l => l !== "")
            .map(l => `    ${l}`),
        ]
  const after = draw.summary?.after
  const rows = draw.rows.flatMap((r: AskRow): readonly string[] => {
    switch (r.kind) {
      case "message":
        return [`  ${messageLine(nodes, r.id, reader)}`]
      case "fold":
        return [
          `  ▸ ${r.parts.join(" · ")}`,
          ...(after?.kind === "fold" && after.fold === r.ids[0] ? summary : []),
        ]
      case "outcome":
        return [`  ${r.text}`]
      default:
        return assertNever(r)
    }
  })
  return after === undefined || after.kind === "fold"
    ? rows
    : [...summary, ...rows]
}

/** `thread`'s column in `view`'s documents, as lines, its composer's button last. */
export function threadLines(
  view: HeldView,
  thread: ThreadId,
  reader: Reader,
): readonly string[] {
  const facts = readSessionFacts(view)
  const end = facts.index.endOf.get(thread) ?? null
  const [column] = projectColumns(facts.index, [{ anchor: end }])
  const nodes: Nodes = new Map((column?.nodes ?? []).map(n => [n.id, n]))
  const rows = pathRows(facts.index, facts.asks, [...nodes.keys()], new Set())
  const lastEnded = lastEndedAsk(rows, null)
  const drawn = rows.flatMap((row): readonly string[] => {
    switch (row.kind) {
      case "message":
        return [messageLine(nodes, row.id, reader)]
      case "ask":
        return askLines(facts, nodes, row, lastEnded, reader)
      default:
        return assertNever(row)
    }
  })
  const lane = threadLane(
    readHeldLanes(view, facts.index, [], new Set()),
    thread,
  )
  const plan = planSend({
    text: reader.draft,
    unstarted: end === null,
    lane,
    participants: [],
    agents: [],
    reader: { me: reader.me, nameOf: reader.nameOf },
    command: null,
    noModel: null,
  })
  const button = sendButton(plan, { uploading: false, sending: false })
  return [...drawn, `[${button.label}]`]
}
