// tui/inbox — a client with no canvas, as a chat app or a notifier would be:
// what needs you, the messages that mention you, and where a reply goes. It
// plans no intent: `planIntent` reads the page's layout, which such a client
// has none of, so it acts through the session, as `planSend` decides.

import type { EntryId, MessageAt, ThreadId, WriterId } from "@pinetrie/core"
import {
  attentionItems,
  attentionWords,
  inboxMentions,
  type planSend,
} from "@pinetrie/interface"

/** What needs you, a line each: the thread, and why, in interface's words. */
export const needsYouLines = (
  input: Parameters<typeof attentionItems>[0],
  nameOf: (writer: WriterId) => string,
): readonly string[] =>
  attentionItems(input).map(
    item => `${item.lane}: ${attentionWords(item.raised, nameOf)}`,
  )

/** The messages that mention you, a line each: who, and what they said. */
export const mentionLines = (
  input: Parameters<typeof inboxMentions>[0],
  nameOf: (writer: WriterId) => string,
): readonly string[] =>
  inboxMentions(input).map(m => `${nameOf(m.by)}: ${m.text}`)

/**
 * Where a reply typed at `thread`, whose end you saw as `end`, goes: its
 * end, when `plan` replies. Null when it would branch or queue: both name a
 * place on a canvas, which this client has none of.
 */
export const replyTarget = (
  plan: Pick<ReturnType<typeof planSend>, "mode">,
  thread: ThreadId,
  end: EntryId,
): MessageAt | null =>
  plan.mode === "reply" ? { kind: "end", thread, seen: end } : null
