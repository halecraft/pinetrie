# S261 — A message type keyed by role costs one decoder and about 60 narrowed reads, and needs no cast

- **Status:** Answered
- **Led to:** ADR-0185

**Question.** `AgentMessageLike` (`packages/core/tree.ts`) is `role?: string`
and 28 optional fields, each commented with the one role that carries it;
`TranscriptMessage` is 11 optional of 15; `MessagePart` is 10 optional of
10. Made a union keyed by role, with `MessagePart` keyed by `type`, what
does it cost: where is a stored message decoded, which pi roles reach it,
how many reads stop compiling, and does any of them need a cast or a
change of behaviour rather than a narrowing?

**Kill criterion.** If a read can only be kept with a cast, or the stored
row would have to change (ADR-0015 keeps it flat, and S17 found no row
change migratable), keep the flat types and make only the role a `Role`.

**Throw away.** The probe's tallies. The candidate types became
`packages/core/messages.ts`.

## Answers

1. **There is one edge already.** `@pinetrie/reads` decodes each stored row
   once (`renderableEntry`, cached by row) through rules'
   `renderableMessage`, which decodes the host's custom messages into
   their roles and passes pi's own through with `message as
   AgentMessageLike`, unchecked. The union needs only that pass-through to
   become a decoder; the row stays as it is.
2. **The roles pi can store are four.** pine·trie runs pi-agent-core's
   harness (`@earendil-works/pi-coding-agent` is imported only by a
   fixture), whose `AgentMessage` is `system`, `user`, `assistant`,
   `toolResult`, and the `custom` role pine·trie writes its history
   messages with (`packages/rules/history.ts`). pi-coding-agent's
   `bashExecution`, `branchSummary` and `compactionSummary` never reach a
   root. A `custom` message no decoder takes is one stored in an older
   shape: core already shows it as nothing (`renderableMessage` there
   drops a role it does not know). Decoding it to no message keeps that.
3. **Entry types are pi's four** (`EntryType` in pi-agent-core's
   `harness/session/types.d.ts`: `message`, `compaction`, `branch_summary`,
   `custom`). Core reads only `message` and `compaction`.
4. **What stops compiling.** With the union in place and nothing else
   changed, `tsc` reports 175 errors (an interface cannot extend a
   union: `SpineNode` becomes a type, which removes 95 cascading ones).
   42 are in `core/tree.ts`'s own projection and part readers, which the
   change rewrites; about 55 are reads in 24 production files; about 80
   are tests and fixtures. The reads are property accesses that exist on
   one role only: `toolCalls` 17, `writer` 11, `proposal` 9, `merged` 6,
   `author` and `compelled` 5 each, and every other field fewer.
5. **Every such read names a role it means.** `proposal`, `asked` and a
   tool's `merged` are a `toolResult`'s; `writer`, `sendId`, `asks` and
   `invites` a person's; `stopped`, `member` and `detail` a fact's;
   `pinned`, `canvasPinned` and `canvas` their own roles'. None needs a
   cast: each becomes a narrowing on `role`, or a reader in core that
   narrows once (`messageWriter`, `messageProposal`, `messageMerged`,
   `transcriptCalls`). Built, the change added no cast to production
   code.
6. **The tests' errors are the impossible states.** Fixtures build a
   person's message with no writer or send, a `{ content }` with no role,
   a role typed as `string`, and a transcript `answer` with images. Each is
   a shape the decoder never produces.
7. **What a person's and an ask's fields become.** The decoder always sets a
   person's `writer` and `sendId`, and a relay's or answer's details, so
   in `TranscriptMessage` a person's `writer` and `sendId` and a relay's or
   answer's `from` are required, not optional.

## Evidence

- The probe: `packages/core/messages.ts` with the union, `SpineNode` as a
  type, then `tsc --noEmit -p .`; errors tallied by code, property and
  file, production apart from tests.
- Read, not run: pi-ai's `Message` (`dist/types.d.ts`), pi-agent-core's
  `AgentMessage` and `EntryType`, pi-coding-agent's
  `CustomAgentMessages` (`dist/core/messages.d.ts`), `packages/pi`'s
  imports.
