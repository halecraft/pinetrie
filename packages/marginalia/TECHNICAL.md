# `@pineta/marginalia` — technical notes

The notes and links people write in the margins of the agent's work. Each shape
is stored in pi's extension slots and typed here, by Pineta, which is its single
authority. Every module decodes through `decodeWith` (`decode.ts`), which is
total: a malformed value is dropped, never thrown.

Namespaces are stored data and name the owner, `pineta.`, following pi's own
`pi.` convention. They deliberately do not follow the package name: renaming a
package must never require changing stored data. This package was
`@pineta/references`; its namespace is still `pineta.reference`.

# Chat (`chat.ts`)

A human message is a pi `CustomMessage`, `customType: "pineta.chat"` (ADR-0018).
`content` is the attributed text the model reads ("Alice: …"); `details` hold
the author (a `WriterId`, from the transport), the display name as written, the
text, and the `Responder` it compels. `encodeChat` and the total `decodeChat`
are the only code that builds or reads the shape.

- **`planChat` decides what a message does** (ADR-0020), over what the host
  gathers in one serial step, and names exactly where to write:

  | a message… | no lane | idle lane | busy lane (running, or messages waiting) |
  |---|---|---|---|
  | plain | `appendToTree` at the end | `appendToLane` | `hold` |
  | compelled `reply`, not raced | `createAndRun` at the end | `run` | `conflict` |
  | compelled `reply`, raced | `conflict` | `conflict` | `conflict` |
  | compelled `queue` | `createAndRun` | `run` | `hold` |
  | `branch` | plain: `appendToTree` at `at`; compelled: `createAndRun` at `at` | a reply | a new lane |

  A race is another writer's compelled message below what the sender saw
  (`raceSince`); plain remarks and agent replies are not. `branch` at an idle
  lane's own tip is a reply: there is nothing to fork. At a *running* lane's tip
  it is a new lane: a running lane's tip equals a branch point only in the
  moment after it was created there, before its prompt commits.
- **`entryText` is the one definition of an entry's citable text**: a chat's
  own `text`, never its attributed `content`, so a span covers exactly what its
  author wrote. The host's citation path reads through it.
- **`renderableMessage`** turns a stored chat into role `chat` with its author
  and whether it compelled the agent, for `core`'s projections, which only
  admit the role and so need no schema library.
- **Names are labels, never identities.** `pineta.participant` values, keyed by
  writer id. The name is copied into each message, so a rename never rewrites what
  the agent already read, nor invalidates the provider's prompt cache.

# The outbox (`outbox.ts`)

A thread's lane is never written while it runs (S21), so every message for a
busy thread waits in `pineta.outbox`, keyed by its own id (ADR-0016), with a
total decoder like every shape here. Ids are uuidv7, so `heldMessages` sorts
into send order, and `nextHeld` takes a lane's oldest. "A lane with messages
waiting" counts as busy even between two of them, or a new message would jump
the queue. The host executes three pure decisions from here:

- **`planDrain`**: when a lane's run ends, its oldest held message is appended
  (plain) or run (compelled); that run's end brings the next step. A plain
  message is released only once it is written, so a refused append stays held.
- **`settleRun`**: a compelled message pi refuses to run is kept, appended with
  no reply, rather than lost; the author already heard `started`.
- **`planStartup`**: no run survives a process, so a starting host clears every
  lane recorded as running, and drains every lane with messages held for it,
  since no run's end will.

# Threads (`thread.ts`)

A thread's default is a `Responder` stored in `pineta.thread`, keyed by the
entry it is set at. `effectiveDefault` takes the `TreeIndex` (`@pineta/core`),
walks `ancestry` from where a message attaches, and takes the nearest setting;
with none, `ROOT_DEFAULT`, a working session. The client's composer and the host
both call it with an index of the same document, so the label cannot promise a
reply the host will not start. `rulesAlong` gives each message on a path its
rule in one pass, for columns that draw many messages.

# References

A reference is a semantic pointer: from the entry it was attached at (where its
author was reading, or their lane tip) to an entry or a span of one. ADR-0006,
realised by ADR-0017, amended by ADR-0018.

## Storage

A pi value in `pineta.reference`, keyed by the reference's own id, written only
by `Agent.addReference` through `Session.setValue`. Values stay out of pi's
causal graph and out of every model's context; only custom entries can be
projected into context. References therefore travel in pi's JSONL.

## The schema is the single authority

`ReferenceSchema` (TypeBox) is the only definition of the shape. Pineta owns it,
so this is not a mirror of anything pi owns. `decodeReference` is **total**: a
stored value that does not match is dropped, never thrown, because values are
`Schema.any()` in the document and one bad value must not break every render.
Decoding is also where `ReferenceId` and `EntryId` are branded.

## Gotchas

- **Backlinks are derived, never stored.** `indexReferences` builds both
  directions in one pass, each list ascending by id. A stored list per target
  would be a child container created lazily under a key two writers share: the
  S18 shape, which lost a writer's value in 40 of 40 trials.
- **Spans are UTF-16 code units over `entryText`.** That is the string the
  client renders, so a DOM selection maps onto it directly. A surrogate pair is
  two units; the unit test pins it.
- **Only committed entries are citable.** A streaming message is not an entry,
  and its text is still changing, so an offset into it would not be stable.
- **Absent and textless are different facts.** `CitedEntry` keeps them apart:
  citing a compaction whole is allowed; a span on it is `invalid_span`.
- **It ships to the browser.** The client decodes references, so TypeBox is in
  the bundle: +42 kB raw, +12 kB gzipped when added.
