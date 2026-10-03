# ADR-0021 — A thread's mode is its lane; a mention picks the addressee

**Status:** Accepted. Amends ADR-0018 and ADR-0020. Amended by ADR-0029
(Start Chat and Start Agent become the add tab), by ADR-0032 (a workspace
is created with the lane, not as its own step), and in place below (a branch
from agent work starts with `@agent ` typed; the send button's words, and a
chip beside it for where a new agent works, `PLAN-2026-09-29-send-button`;
who a queued message waits behind, `PLAN-2026-09-29-queue-words`). Amended by
ADR-0063: a session is a document per root, a session document of its
records, and one of what is streaming; it is still the boundary of who is in
it.

**Context.** ADR-0018 stored a default at an entry (`pineta.thread`): below a
*working session* entry the agent answers every message, below a
*conversation* entry only `@agent`. It was changed by an action on a message
("from here, …"), beside another action, "branch from here". Both asked a
person to decide where the agent will answer while they were reading, not
while they were sending, which is when anything is spent. And after ADR-0020 a
thread has a lane exactly where agent work was wanted, so the stored default
was a second record of a fact the lanes already held.

The actions differ in cost, and in how far they can be undone:

| step | costs | undone by |
|---|---|---|
| a message (a note, or conversation) | nothing | deleting it |
| asking the agent | time and money | nothing: it is spent |
| a workspace for the agent (ADR-0019) | disk and CPU | tearing it down |

**Decision.**
- **Each step up is deliberate, taken once per thread, at send time.** Reading,
  opening a branch and closing a column never step up.
- **A thread's mode is derived: a thread with a lane is agent work; a thread
  without one is a conversation.** Nothing is stored. The first message that
  asks the agent in a conversation creates the lane (ADR-0020), and from then
  on the thread is agent work.
- **Mentions pick the addressee; the thread's mode fills in when there are
  none.** `@agent` asks the agent. A message naming only people goes to them
  and does not ask the agent, in agent work too. A message with no mention
  asks the agent in agent work, and nobody in a conversation. This reverses
  ADR-0018's "a mention can add an obligation but never remove one".
- **A branch starts as a conversation.** One action on any past message opens
  an empty column to the right, forked there; nothing is written until the
  first send, and that message decides what the thread is. *Amended:* a
  branch from agent work starts with `@agent ` typed in its composer, unsent
  and deletable, since going on with the agent is the usual intent. The
  thread is still decided by the first message, and `@agent ` alone sends
  nothing. Nothing is a hidden default, as `asksAgent` would be: what will
  happen is typed where it can be read and changed.
- **At an agent thread's end, the same action steps back down.** It opens a
  conversation that continues from the end: a new thread with no lane, which
  reads everything above it. The agent thread's lane stays where it is, idle,
  and its column keeps following that lane, not the new branch. `@agent` in
  the conversation later creates the new thread's own lane. At a
  conversation's end the action is hidden: there it would be the same as
  replying. A brief aside in agent work needs no branch: name the people.
  *Amended:* the action at an agent thread's end is "open a branch here",
  like on every other message, and its branch starts with `@agent ` typed.
  Deleting `@agent` is how you step down; the rest of this still holds.
- **At the root, two actions: Start Chat and Start Agent.** Both open an empty
  column at the root. In a Start Agent column, a message with no mention asks
  the agent, as if `@agent` had been written, and so creates the lane. That
  default is the unsent column's view state until then; closing the column
  writes nothing. No lane is created empty, so ADR-0020's invariant, *a lane's
  tip is its thread's end*, holds.
- **The send button is the one place that says what a message will do** ("ask
  the agent"). There is no mode toggle: a toggle and a button would be two
  statements of one fact. *Amended:* the button says only what the send does
  and to whom (its labels are listed in `docs/06-interface.md`); when the
  send starts an agent, a chip beside it says where that agent will work
  (ADR-0032), so the button stays short. A queued
  message names who it will wait behind: the last message already waiting,
  "yours" when that is your own, or "up next" when none waits.
- **A workspace is its own step**, an explicit action on a thread that is
  already agent work, never implied by `@agent`. Designed with workspaces.
- **A session is its participants.** A session is one document, and the
  boundary of who is in it: sharing, and later presence. Threads, root threads
  included, are topics inside it, so starting a thread at the root is not
  starting a session. Creating sessions is a later step.

**Consequences.** The stored thread rules, the `thread` command,
`setThreadDefault`, `effectiveDefault`, `readThreadRules`, `rulesAlong`,
`ROOT_DEFAULT`, the "from here, …" action and the separate "branch from here"
are gone; `pineta.thread` values already in a session are no longer read. The
host decides a message's addressee from its mentions, the thread's lane, and,
for a Start Agent column's first message, the column's default, which the send
carries. Someone working alone clicks Start Agent once per thread. In agent
work, speaking to people without the agent answering means naming them, or
continuing as a conversation from the end. A branch at a lane's tip is no
longer a reply on that lane: it starts a thread with no lane, parented at the
tip.

**Alternatives rejected.** A stored default per entry (ADR-0018: decided while
reading, and a second record of the lanes). A mode toggle in the composer (it
restates the send button, and the two could disagree). New sessions, or new
branches, starting as agent work (a step up nobody chose; for a branch, a
retry from an old point now needs `@agent`, which is cheap to type and visible
on the button). Creating the lane when Start Agent is clicked (an empty lane
breaks ADR-0020's invariant and creates a pi record for nothing). Keeping
"add, never remove" (to say anything to one person in agent work, you would
have to branch). Switching an agent thread back to a conversation in place (a
lane never moves, and the mode is the lane; a stored switch would restore the
second record this ADR removes).
