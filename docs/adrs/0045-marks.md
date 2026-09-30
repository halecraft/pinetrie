# ADR-0045 — A mark is a title on an entry; a root's mark titles its tab

**Status:** Accepted. Implementation: `PLAN-2026-09-30-root-titles`. Amends
ADR-0028 (a mark's record: keyed by its entry, a title only) and ADR-0029
(where a root's label comes from).

**Context.** A root tab's label is its first message's first line, cut to 40
characters. That line is often a preamble ("I'd like to start talking about a
change with you…"), and nothing can change it. ADR-0029 left the label to
marks, "its first message's text until a mark names it", but ADR-0028 was
never built. Its record was shaped by the description, a Yjs document per
mark. Because the description lives apart from the record, ADR-0028 keyed each
mark by an id of its own, needed a rule that a message carries at most one,
and stored a `marked` or `unmarked` state so that emptying a mark's fields
would not unmark it.

A tab's title and a mark are the same fact: a name someone gave the work that
starts at an entry. A root's id is its first entry's id (S30), so a tab's
title is a mark on its root. What differs is what follows from the mark. A
mark partway down a thread draws a boundary (ADR-0028's membership). A root is
a boundary already, so its mark only names it. That difference belongs to the
reads that derive membership, not to the record.

**Decision.**
- **A mark is a title on an entry.** It is a host-written `pineta.mark` value
  keyed by the entry's id: `{ entry, title, by, at }`. The key makes it one
  per entry.
- **One command, `mark`, sets or clears it.** It names the entry and a title.
  A title replaces the stored one, and the last write wins: nobody types a
  title together (ADR-0023). An empty title deletes the record. A title is one
  line, trimmed, at most 80 characters; the codec refuses any other.
- **The host accepts a mark on any entry in the tree,** since the rule is the
  same everywhere. It refuses one in an archived root, as it refuses every
  write there (ADR-0029).
- **A root's label is its mark's title, else its first message's first
  line,** wherever a root is named: its tab, the header, the inbox and the
  Archive tab. The Archive tab's search matches titles too.
- **For now, the page offers a mark only on a root:** **Rename** in a root
  tab's `⋯` turns the tab's label into a field. Enter or leaving the field
  saves, and Escape cancels.
- **The rest of ADR-0028 is deferred, not withdrawn:** descriptions, section
  headers, membership, and the place in every column header. When
  descriptions come, a mark whose title is cleared can still hold one, so the
  stored `unmarked` state comes back with them. The key stays.

**Consequences.** A new namespace, a command kind, an outcome (`marked`) and
an error code (`invalid_title`) change the Line's schema, as ADR-0029's did (S31):
clients and host ship together. A title is shared, so renaming a root renames
it for everyone. The record holds who set it, and the screen does not show
that yet. The agent does not read titles. An unsent new tab has no entry, so
it cannot be titled before its first send. ADR-0028's way of doing that, where
a fresh column holds what was typed until its first message, is left for
later. A title the agent suggests when its first run ends is possible later,
and a person's title would win over it.

**Alternatives rejected.** A title record of its own, keyed by root (the same
fact as a mark on the root, stored twice once marks come). ADR-0028's record
as written (its own id, the one-per-message rule and the stored state exist
for descriptions, which this does not build). A title per person (the label
shows in the header, the inbox and the Archive tab, which others read; a label
only for your own bar would be view state, ADR-0030). The thread names of
ADR-0039 as titles (those are identifiers minted for a lane, unique and fixed;
a title is chosen, changes and can repeat). Clearing by storing an empty title
(it would read as chosen, as ADR-0028 said of a stored default name).
