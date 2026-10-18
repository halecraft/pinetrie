// core/mentions — obligation: who a message names with `@`, whom it compels
// to answer (`address`), what a relay between threads' agents carries, and a
// person's display name.

import {
  type AgentId,
  type EntryId,
  THE_AGENT,
  type ThreadId,
  type WriterId,
} from "./ids.ts"
import { isThreadNameHandle, type ThreadName } from "./thread-names.ts"

/**
 * An `@` in a message. Mentioning the agent COMPELS it to reply. Mentioning a
 * person addresses them, and so leaves the agent out; nobody can make a human
 * answer. A person mention counts only if it names a participant (`address`).
 */
export type Mention =
  | { readonly kind: "agent"; readonly agent: AgentId }
  | { readonly kind: "person"; readonly name: string }

/**
 * Who must answer a message. Only an agent can be compelled, so this type has
 * no way to say "compel a person".
 */
export type Responder =
  | { readonly kind: "none" }
  | { readonly kind: "agent"; readonly agent: AgentId }

export const NOBODY: Responder = { kind: "none" }

/**
 * The characters of a mention's handle: any letter or digit, in any script,
 * and `_` or `-`. `parseMentions` and `mentionHandle` share it, so every name that
 * can be shown can be typed as a mention.
 */
const HANDLE_CHARS = "\\p{L}\\p{N}_\\-"

/** A mention's `@`: it starts a word, so an e-mail address holds none. */
const MENTION_AT = `(?<![${HANDLE_CHARS}@])@`

/**
 * `text` with its code blanked out, each character a space and each line break
 * kept: fenced blocks
 * (``` or ~~~, to their closing fence or the end) and inline code spans (a run of backticks to the next run as long). A four-space indented block is left as it is: it needs the block's context, which a line scan does not have.
 */
function withoutCode(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ")
  const fenced = text.replace(
    /^([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]{0,3}\2[`~]*[ \t]*$|(?![\s\S]))/gm,
    blank,
  )
  return fenced.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, blank)
}

/** A mention in a text: its `@` at `start`, its handle running to `end`. */
interface MentionSpan {
  readonly start: number
  readonly end: number
  /** Empty for a bare `@`. */
  readonly handle: string
}

/**
 * Every `@` in `text` that starts a mention, with the handle after it, outside
 * code (`withoutCode`): a handle in a code span or a fenced block is text. A
 * handle starts a word, so an e-mail address holds none. The one reading of
 * mentions, for what is sent (`parseMentions`) and what is being typed
 * (`typedMention`) alike.
 */
function mentionSpans(text: string): readonly MentionSpan[] {
  const pattern = new RegExp(`${MENTION_AT}([${HANDLE_CHARS}]*)`, "gu")
  // `withoutCode` keeps every offset, so its indices are the text's.
  return [...withoutCode(text).matchAll(pattern)].map(m => ({
    start: m.index,
    end: m.index + m[0].length,
    handle: m[1] ?? "",
  }))
}

/**
 * Every `@handle` in `text`, in order, without repeats (`mentionSpans`).
 * `@agent` is the agent; any other handle is read as a person here, and
 * `address` finds whom it names.
 */
export function parseMentions(text: string): Mention[] {
  const seen = new Set<string>()
  const out: Mention[] = []
  for (const { handle } of mentionSpans(text)) {
    if (handle === "" || seen.has(handle)) continue
    seen.add(handle)
    out.push(
      handle === THE_AGENT
        ? { kind: "agent", agent: THE_AGENT }
        : { kind: "person", name: handle },
    )
  }
  return out
}

/** A mention being typed: its `@` at `start`, its handle running to `end`. */
export interface TypedMention {
  readonly start: number
  readonly end: number
  /** What is typed of its handle before the caret; empty after a bare `@`. */
  readonly typed: string
}

/**
 * The mention the caret at `caret` is in (`mentionSpans`), null where it is
 * in none. Its handle runs on past the caret, so a choice replaces the whole
 * word.
 */
export function typedMention(text: string, caret: number): TypedMention | null {
  const span = mentionSpans(text).find(m => m.start < caret && caret <= m.end)
  return span === undefined
    ? null
    : {
        start: span.start,
        end: span.end,
        typed: span.handle.slice(0, caret - span.start - 1),
      }
}

/**
 * A display name as a mention must spell it: lower case, composed (NFC), handle
 * characters only. "Ada Lovelace" is `@adalovelace`, "O'Brien" is `@obrien`,
 * "José" is `@josé`, "日本" is `@日本`.
 */
export const mentionHandle = (name: string): string =>
  name
    .normalize("NFC")
    .toLowerCase()
    .replace(new RegExp(`[^${HANDLE_CHARS}]`, "gu"), "")

/** Who asked another thread's agent: a person, or a thread's agent. */
export type Asker =
  | { readonly kind: "person"; readonly writer: WriterId }
  | { readonly kind: "agent"; readonly thread: ThreadId }

/**
 * An ask relayed into another thread, the asked agent's prompt: where it was
 * asked, by whom, and what. `budget` is the person's message whose budget the
 * chain spends (its run spends from it only when an agent asked); `by` is the
 * person behind the chain, who a stop, a card or a run's author names.
 */
export interface RelayDetails {
  readonly from: ThreadId
  readonly fromName: string
  /** The chat, or the agent's message calling `ask`, in `from`. */
  readonly source: EntryId
  readonly asker: Asker
  readonly askerName: string
  readonly text: string
  readonly budget: EntryId
  readonly by: WriterId
}

/**
 * An asked agent's answer, in the thread that asked: its last message of the
 * run its relay started. `wakes` says whether it started a run of the asking
 * agent.
 */
export interface AnswerDetails {
  /** The answering thread. */
  readonly from: ThreadId
  readonly fromName: string
  /** The relay, in `from`, whose run this answers. */
  readonly relay: EntryId
  /** The asking thread's entry the relay came from (`RelayDetails.source`). */
  readonly source: EntryId
  readonly text: string
  readonly wakes: boolean
  readonly budget: EntryId
  readonly by: WriterId
}

/**
 * What an asked agent heard of the thread that asked: those entries' ids,
 * newest last. Their text is the heard entry's `content`.
 */
export interface HeardDetails {
  readonly from: ThreadId
  readonly fromName: string
  readonly entries: readonly EntryId[]
}

/**
 * Another thread's agent a mention may reach: a thread on the open canvas's
 * canvas other than the one written in, by its name. `member` says whether it
 * was invited into the thread written in already.
 */
export interface AgentCandidate {
  readonly thread: ThreadId
  readonly name: ThreadName
  readonly member: boolean
}

/** Who a message is for. */
export interface Recipients {
  /** This thread's own agent, if it must answer: a run. */
  readonly compels: Responder
  /** Participants the message names, by display name. Never compelled. */
  readonly people: readonly string[]
  /** Members, other threads' agents, that it asks: each runs. */
  readonly asks: readonly ThreadId[]
  /** Other threads' agents it invites: they become members, asked or not. */
  readonly invites: readonly ThreadId[]
}

/** Whom a handle in a mention names. */
export type MentionTarget =
  | { readonly kind: "agent" }
  | { readonly kind: "thread"; readonly agent: AgentCandidate }
  | { readonly kind: "person"; readonly name: string }

/**
 * Every handle a mention can name, and whom: `@agent`, this thread's agent;
 * each candidate agent by its thread's name; each participant by their
 * name's handle. A handle names one target: a thread's agent before a person,
 * and of two people with one handle, the later in `participants`. In the
 * order first named: the agent, the threads, the people. `address` resolves
 * by it and the composer offers it, so it offers only what a send would
 * reach.
 */
export function mentionTargets(
  participants: readonly string[],
  agents: readonly AgentCandidate[],
): ReadonlyMap<string, MentionTarget> {
  const targets = new Map<string, MentionTarget>([
    [THE_AGENT, { kind: "agent" }],
  ])
  for (const agent of agents)
    targets.set(mentionHandle(agent.name), { kind: "thread", agent })
  for (const name of participants) {
    const handle = mentionHandle(name)
    if (targets.get(handle)?.kind !== "thread")
      targets.set(handle, { kind: "person", name })
  }
  return targets
}

/**
 * Who a message is for, each handle resolved by `mentionTargets`: another
 * thread's agent, before any person: a member is asked, any other invited. `@agent`
 * compels this thread's agent. Otherwise a message naming participants or
 * asking members is for them, and the agent is left out; an invite alone leaves
 * the message where it would have gone. Otherwise the thread decides: the agent
 * where it is the default (a thread with a lane),
 * nobody where it is not. A message that then compels nobody, names no one and
 * asks no member asks the agents it invites, since nobody else would answer.
 *
 * A handle that names no participant and no candidate is ignored, so
 * `@types/node` in an agent thread still asks the agent. The composer and the host
 * both call it.
 */
export function address(input: {
  readonly mentions: readonly Mention[]
  /** Every participant's display name, as shown. */
  readonly participants: readonly string[]
  /** Other threads' agents on open canvases. */
  readonly agents: readonly AgentCandidate[]
  readonly agentByDefault: boolean
}): Recipients {
  const targets = mentionTargets(input.participants, input.agents)
  const people: string[] = []
  const asks: ThreadId[] = []
  const invites: ThreadId[] = []
  for (const m of input.mentions) {
    // Only `@agent` as typed names the agent (`parseMentions`).
    if (m.kind !== "person") continue
    const target = targets.get(mentionHandle(m.name))
    if (target?.kind === "thread") {
      const { member, thread } = target.agent
      const into = member ? asks : invites
      if (!into.includes(thread)) into.push(thread)
    } else if (target?.kind === "person") people.push(target.name)
  }
  const agent = input.mentions.find(m => m.kind === "agent")
  const compels: Responder =
    agent !== undefined
      ? { kind: "agent", agent: agent.agent }
      : people.length > 0 || asks.length > 0 || !input.agentByDefault
        ? NOBODY
        : { kind: "agent", agent: THE_AGENT }
  const nobodyElse =
    compels.kind === "none" && people.length === 0 && asks.length === 0
  return nobodyElse
    ? { compels, people, asks: invites, invites }
    : { compels, people, asks, invites }
}

/** A display name's longest form, in UTF-16 code units. */
export const MAX_NAME_LENGTH = 40

/**
 * A display name as typed -> the stored one, or undefined if unusable: empty,
 * too long, or one no mention could reach (no letter or digit, spelled
 * `@agent`, which is always the agent, or a thread's name, which is always that
 * thread's agent).
 */
export function normalizeName(name: string): string | undefined {
  const n = name.trim()
  const handle = mentionHandle(n)
  return n.length === 0 ||
    n.length > MAX_NAME_LENGTH ||
    handle === "" ||
    handle === THE_AGENT ||
    isThreadNameHandle(handle)
    ? undefined
    : n
}
