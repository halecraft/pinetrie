# ADR-0030 — Your tabs are yours; the header shows who is here, and your inbox of mentions

**Status:** Accepted. Implemented by `PLAN-2026-09-27-your-tabs-inbox`.
Amends ADR-0029 (the tab bar is each person's; closing
a tab is yours) and ADR-0027 (a stored layout holds your open roots, and the
device keeps which mentions you have seen). Amended by ADR-0037: you are your
email, so your other tabs and devices are you, and your tabs are yours per
device. Amended by ADR-0069: `@` is the header's activity menu's mentions,
and its count part of that menu's badge, with open offers.

**Context.** ADR-0029 gave everyone the same tab bar, every root not archived,
and rejected tabs each person opens and closes: a collaborator's new root would
not reach you, and the Archive tab would become an inbox. In use, the shared
bar has no way to close a tab for yourself: a root leaves it only when someone
archives it for everyone, and the bar grows with every thread anyone starts.
What a person wants from the whole session is not every root at once, but what
is happening now: who else is here and where, and what the agent is doing.
Shown in the header, that is how a collaborator's work reaches you, and the
bar can be yours.

**Decision.**
- **Your tabs are the roots you have open.** `×` on a root tab closes it for
  you and writes nothing, as closing a column does. Closing keeps the root's
  columns, so opening it again brings them back. A root you start opens as
  your tab (it began as your new tab); a root someone else starts does not.
  Tabs keep the order you opened them in, new ones at the right beside ＋.
- **You open a root from wherever it is shown:** a person or the agent in the
  header, a mention, a reference, or the Archive tab (**Open**). Opening shows
  it, never behind your back: nothing opens or switches a tab on its own.
- **The header shows who is here, from live data only**, as a document editor
  shows avatars of the people in it:
  - **people:** an avatar per person with a live presence entry (ADR-0024), in
    their colour. Hovering names them and the thread they are in; a click
    opens that thread as your tab, with a column on their path. You are never
    shown;
  - **the agent:** one avatar while any lane runs, pulsing, with the number of
    threads it is working in. A click lists those threads, and a row opens
    one. Idle, it is not shown.
- **A mention is a notification, not a tab.** `@` in the header is your
  inbox: the messages that mention you, newest first, each with who, the
  thread, and the start of the message. A message mentions you when its
  mentions resolve to you, by the same `address` the send button uses. A row
  opens that thread as your tab, with a column on the message; in an archived
  root, it opens the root's preview in the Archive tab. The items are derived
  from the tree; only what you have seen is stored.
- **The count on `@` is the mentions you have not seen.** One is seen when you
  open it from the inbox, when it is drawn in a column of the tab you are on,
  or when you mark all seen. Seen is the only state: a mention seen stays in
  the inbox, which can show only the unseen.
- **Seen is kept per device** (`localStorage`), shared by every tab on it, and
  never leaves the browser: `{ since, seen }`. `since` is an entry id: every
  mention at or before it is seen, and `seen` holds the ids of mentions after
  it that you have seen. "Mark all seen" moves `since` to the newest mention
  and empties `seen`, so the set stays small. With nothing stored, `since` is
  the newest entry at the first load, so a device starts with no backlog. The
  stored form decodes whole or not at all, and a version it does not know
  starts afresh.
- **Archiving stays a shared "done"** (ADR-0029): the host-written record,
  read-only until restored, refused while the agent works there or messages
  wait. Archiving takes the root out of every tab bar; the tab you are on
  stays while you are there, as before. Restoring opens it as a tab only for
  whoever restores it.
- **Tabs keep their signals** (ADR-0029): a pulse while the agent works in
  that root, and avatars of the others on it. Only the tab you are on reports
  presence.
- **The stored layout holds your open roots, in order**, beside the tab you
  are on and each root's columns (amends ADR-0027). A layout stored before
  this change is dropped once. Neither the open roots nor what you have seen
  is ever written to the document.

**Consequences.** Nothing new is stored in the document, the host and the Line
are unchanged, and archiving works as built. The inbox is a pass over every
chat at each change, which is O(entries), as every view is. A mention made
while you were away counts on your return, on the same device. What is left:
- **another device, or a cleared browser, starts afresh** from its first load:
  the inbox is kept per device, though since ADR-0037 the person is the same
  on every device;
- **"you" is a name:** a mention resolves to a handle, and a handle to your
  display name, so renaming yourself changes which mentions are yours, and
  two writers with one name share them;
- **a root someone starts without mentioning you, and then leaves,** reaches
  you only through the Archive tab;
- **someone whose only view is the Archive tab** reports no presence, so the
  header does not show them.

Presence is untrusted (ADR-0024), so an avatar is only as honest as the client
that wrote it.

**Alternatives rejected.** A shared tab bar (ADR-0029: nobody could close a
tab for themselves, and the bar grew with everyone's roots). Opening a tab
when you are mentioned (nothing on screen may appear by itself, principle 6 of
`docs/06-interface.md`; the notification leaves the choice to you). A count
kept in page memory (a reload lost it, and a mention made while you were away
never counted). Seen state in the session document (everyone replicates it,
so it would tell everyone what you have read, and the host refuses client
writes to it). An inbox per person, stored by the host (deferred until a
person has an identity across devices; the device's inbox is shaped to move
there). "Done" beside "seen", to take a handled mention off the list
(deferred: one state is enough while mentions are few, and done is one more
flag on the same item). A last-read position per root, for unread marks on
tabs, an "N new" count and a "what's happening" panel (deferred: it needs a
rule for "seen" over every message, not a few, and one position per root
misreads branches; it can reuse the inbox's storage and rule). Mentions of
other kinds, such as the agent finishing what you asked (deferred). Browser
or system notifications (deferred: they need permission, and the header
serves a person with the page open). Storing notifications in the document (a
notification is its reader's, and the mentions are already in the tree).
Showing the agent while idle (it is not doing anything; the header shows
what is happening).
