# ADR-0185 — A message is decoded once into a union keyed by its role

- **Status:** Proposed
- **Area:** `packages/core/TECHNICAL.md`, `packages/rules/TECHNICAL.md`,
  `packages/reads/TECHNICAL.md`
- **Evidence:** S261
- **Amends:**
  - ADR-0015: the row stays flat and its payload sealed; what the reads decode
    from it is a union keyed by role, not a loose shape.

**Context.** The reads decode each stored row once (`renderableEntry`,
`@pinetrie/reads`) through rules' `renderableMessage`, which decoded the
host's own messages and passed pi's through with a cast. Core typed the
result as `AgentMessageLike`: `role?: string` and 28 optional fields, each
commented with the one role that carries it. `TranscriptMessage`, what a
reader sees, was 11 optional fields of 15, and `MessagePart` 10 of 10.
Nothing stopped a `toolCallId` on a person's message, or a person's message
with no writer, and every read of a field compared `role` with a string.
S261 measured the cost of a union: one decoder, about 60 narrowed reads in
24 production files, and no cast; the tests' errors were fixtures in
shapes the decoder never makes.

**Decision.**

- **Core's message types are unions keyed by `role`**, each variant with
  the fields its role carries, and `Role` the union of the roles.
  `MessagePart` is keyed by `type`: a text, a tool call, or an image stored
  as a blob. `EntryLike.type` is pi's `EntryType`.
- **`renderableMessage` (rules) is the one decoder.** It decodes the host's
  messages into their roles, and pi's own (`user`, `system`, `assistant`,
  `toolResult`) by schema, their parts included (`decodePiMessage`). A role
  pi does not write into a root, or a `custom` message no decoder takes, is
  no message: the entry stays in the tree with none. The reads leave out a
  row whose type is none of pi's four, as they leave out one whose thread
  is no thread's id.
- **A read names the role it means**, by narrowing on `role`, or through a
  reader that narrows once (`messageWriter`, `messageProposal`,
  `messageMerged`, `transcriptCalls`).
- **The blob sweep reads stored messages raw** (`storedImages`): an image
  in a message the decoder leaves out is still kept.

**Consequences.**

- A field read on the wrong role, or a role compared with a string no role
  has, is a compile error.
- A person's message always has its writer and send in what a reader sees,
  and an ask or an answer the thread it came from.
- A pinned card's `/blob/` link is what `save_blob` may save: the cards
  entry's text was its `content`, which the decoder empties, and the
  decoded cards are read instead.
- A new pi role, or entry type, is read only once core names it.

**Alternatives rejected.**

- **Optional fields typed `undefined` on every other variant**, so that
  `m?.proposal` still compiles across the union: it makes the impossible
  shapes unconstructible but leaves reads unnarrowed, and needs a helper
  type over every variant.
- **Only a `Role` type over the flat shape**: it types the comparisons and
  none of the fields.
