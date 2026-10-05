# ADR-0017 — References are pi values in a pine·trie namespace

**Status:** Superseded by ADR-0043 (references are withdrawn). Accepted. Realises ADR-0006. Roadmap step 4.

**Context.** ADR-0006 fixed a reference as a semantic pointer, stored apart
from the causal `parentId` graph. The question was where. pi has no reference
concept, but it has two extensible places: custom entries and namespaced values.
Checked in pi's source: namespaces are open (only empty or NUL is rejected);
`Session.setValue` is public and usable outside a turn; JSONL storage appends
every write, values included; and only custom entries can enter a model's
context, through a registered `entryProjectors[customType]`.

**Decision.** A reference is a pi **value** in `pinetrie.reference`, keyed by its
own id, written only through `Agent.addReference`.

- **Values, not custom entries.** A custom entry has a `parentId`, so it would
  join the causal graph, contradicting ADR-0006, and appending one would move
  the author's lane tip. Values stay out of the causal graph and out of every
  model's context.
- **One schema, TypeBox, in `packages/marginalia`** (named `packages/references`
  when this was decided). pine·trie owns the reference
  shape, so this schema is the single authority, not a mirror of pi's. It is
  the TypeBox version pi pins, so one copy is installed. Decoding is total: a
  malformed value is dropped, never thrown.
- **Backlinks are derived** by `indexReferences`, one pass in both directions.
  A stored backlink list per target is the S18 shape.
- **Attached where the author is reading, authored by the transport's peer
  id.** *Amended by ADR-0018:* this was "the author's lane tip", but once people
  chat, someone who only ever asks the agent has no lane. The reference names
  the entry being read, or the author's tip. Refused while the author's turn
  runs.
- **Spans are UTF-16 code units over `messageText`.** Only committed entries
  are citable. *Amended by S27:* this said "which is what the client renders".
  The client now renders it as markdown, so `**bold**` shows as "bold" and a
  selection's DOM offsets are not source offsets. Each rendered run of text
  carries the source range it came from, and a selection reaches the source
  through them (`packages/client/markdown.ts`). The offsets themselves are
  unchanged.

**Consequences.** References travel in pi's JSONL. A pi extension can reach
them once pine·trie supplies an API through the embedder-provided `toolContext`;
that is added with the first extension that needs it. TypeBox ships to the
browser: +42 kB raw, +12 kB gzipped. Proven: two writers citing one entry
concurrently both survive, and keying by target id instead loses one.

**Alternatives rejected.** A pine·trie-owned document field (invisible to pi); pi
custom entries (causal graph, lane tip); a stored backlink list (S18); Zod
(TypeBox matches pi's tool parameters). Deferred: routing the namespace to a
typed Kyneta row inside `KynetaStorage`, the ADR-0015 pattern, until references
need more than backlinks.
