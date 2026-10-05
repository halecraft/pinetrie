# ADR-0043 — A message's edit is a branch at its parent, and its note sits below it; references are withdrawn

**Status:** Accepted. Implementation: `PLAN-2026-09-29-message-tools`.
Supersedes ADR-0006 and ADR-0017. Amends ADR-0025 (where a note is drawn, and
what one opened on a message starts with). Amended by ADR-0048 (step 3,
`PLAN-2026-10-01-notes-removed`): no note sits below a message, and the
row of tools is copy, edit (or new tab), `→`.

**Context.** A message's tools were cite, edit and `→`, and none of them did
what it seemed to.
- **cite** wrote a reference the model never read. It showed only as "↗ cites
  n / ↙ cited by n", and neither led anywhere. To support it, the protocol
  carried a command kind and span bounds, the host a handler, pi a namespace,
  and the client a layer that mapped a selection in rendered markdown back to
  its source (S27).
- **edit** opened a note, which changes neither the message nor what the model
  read. There was no way to change a message and send it again.
- **A note replaced its message on screen**, and started as a copy of its
  text. Once a message had a note, what was sent was shown nowhere.
- `→` was drawn apart from the other tools, a line below them.

**Decision.**
- **Edit is a branch at the message's parent**, its composer holding the text
  as sent. Entries are immutable (ADR-0004), so the edit is a sibling, and the
  original stays. The edit asks the agent exactly when the original did: a
  compelled message whose text names no agent was asked by its thread's
  default, and gets `@agent ` in front, since a branch asks only through a
  mention (ADR-0021). Sent unchanged, it is a retry.
- **A root's first message offers a new tab** instead, holding its text, a
  Start Agent tab when the message was compelled.
- **Anyone's message can be edited**, and the edit is sent as the editor. Only
  people's messages: an agent's reply edited by a person would be an assistant
  message the agent never wrote (ADR-0018).
- **The note tool is named note.** A note is drawn below its message, attached
  to it, and the message's text always shows. A note opened on a message
  starts empty: it is about the message. A shared draft or a queued note that
  became a message is its origin, and is drawn only once it has changed since
  done; until then it would repeat the message's text.
- **References are withdrawn**, protocol through client, with the source
  mapping that existed only for citing.
- **One row of tools:** note, edit (or new tab), `→`.

**Consequences.** Nothing links one message to another semantically until fold
defines what it needs. Stored `pinetrie.reference` values are ignored, with no
migration. A message can have two notes below it: one about it, and its changed
origin. The notes index and the Archive's counts still count every note record,
while the tree's markers (the rail's squares, closed branches' counts) count
only notes that are drawn. A composer's starting text is typed: a starting
point such as `@agent ` sends nothing alone, and an edit's text is content.

**Alternatives rejected.**
- Editing the entry in place: breaks ADR-0004 and the model's reproducible view.
- Editing an agent's reply: a person-written assistant message (ADR-0018).
- Prefilling an edit from its note: the text as sent is on screen, and it is
  what the edit replaces; a note is about the message, not a version of it.
- A note drawn in its message's place: hides what was sent and what the model
  read.
- A note starting as a copy: beside the message, the text would show twice.
- Drawing every origin note: it repeats its message, whose speaker line already
  names its contributors.
- Keeping references for fold: code with no use. Fold will define what it needs.
- Keeping the source mapping: a span per text node, for no reader.
