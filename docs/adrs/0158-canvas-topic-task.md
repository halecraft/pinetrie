# ADR-0158 — What ＋ makes is a canvas; on the board it is a topic, and a task once it leaves Topics; a thread nobody's agent works in is a chat

- **Status:** Accepted (Duane, 2026-10-16)
- **Area:** `docs/glossary.md`, `docs/06-interface.md`,
  `packages/interface/TECHNICAL.md`, `packages/rules/TECHNICAL.md`,
  `packages/schema/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Amends:**
  - ADR-0116: the board's card is a canvas, not a task; topic and task are
    words for where a canvas is on the board; the task column is the canvas
    column, and its pinned cards are pinned to the canvas.
  - ADR-0122: a new session's states are Topics, Active and Archive; ＋ in the
    sidebar or on a board column makes a canvas, with no ▾; a text card put on
    a state starts a chat.
  - ADR-0126: the card kind `task` is `canvas`; a topic and a task are a
    canvas by its place, as a note is a text card by its place.
  - ADR-0138: ＋ past a canvas's last column offers an agent thread, a chat or
    a note column: the conversation is a chat.
  - ADR-0021: a thread nobody's agent works in is a chat, not a conversation.
- **Revised:**
  - 2026-10-17: a session written before the rename is migrated, not left
    undecodable: its stored words are renamed (a person's message,
    `pinetrie.chat`, is stored as `pinetrie.message`; places, card histories,
    open lists and context entries name a canvas), its default states become
    Topics, Active and Archive, and its stacks of moves are deleted. An
    entry's `content` is never rewritten. The Area gains
    `apps/pinetrie/host/TECHNICAL.md`, where the migrations are.

**Context.**

- **＋ agent names the least lasting thing it makes.** The sidebar's ＋
  makes a task (in the sidebar at once, on the board from its first send),
  a thread card on its canvas, and whether that thread asks the agent
  (`asksAgent`). Only the third is in its label. A thread's mode is not
  stored (ADR-0021) and `@agent` changes it, so the label names a default
  for the first message.
- **An agent is not something a person makes.** A thread's agent is named
  by its thread (`@amber-fox`) and works there while the thread has a
  lane. "＋ agent" suggests a roster of agents, which the model does not
  have.
- **One ＋ means three things.** In the sidebar and on a board column it
  makes a task; past a canvas's last column (ADR-0138) it makes a column.
  The agent or conversation choice is about a thread, and is offered at
  all three.
- **Not everything on the board is work.** A team's running chat, a
  design jam or a mood board is put on the board so teammates find it, not
  to track its status. "Task", and a first state named Backlog, treat each
  one as work not yet started.
- **"Doing" and "Done" are a pair.** The archive is named Done in a new
  session (ADR-0122), which reads oddly for something dropped, or for a
  chat that ran its course.
- **Chat is how people coordinate.** A thread without a lane, where people
  talk and `@agent` brings the agent in, is where a team decides together.
  The interface calls it a conversation, the rarer start behind ＋'s ▾.
  The code already says `chat`, but for a person's message (the role
  `chat`, `ChatDetails`, `ChatAt`), not for such a thread.
- **The glossary has no entry** for agent thread, conversation or chat,
  though the interface and the code use all three.

**Decision.**

*The card is a canvas.*

- **What the board, the sidebar and a board column's ＋ hold is a
  canvas**: a card whose surface holds threads and note columns (later
  images and files, ADR-0116), in an order everyone shares, drawn as the
  strip when it opens. The canvas is the card and its surface, one word, as
  a note column is the card and its list.
- **Topic and task are words for where a canvas is**, never stored:
  - a **topic** is a canvas in the board's first open state;
  - a **task** is a canvas in any later open state;
  - an **archived** canvas is in the archive, as before.

  A canvas moved from Topics to Active becomes a task, and moved back
  becomes a topic, by the board's one move. Nothing else changes with the
  word: archiving, reading, running and the board's move act on a canvas
  wherever it is.
- **Topics is the first open state by convention**, not a state of its own
  kind. Nothing behaves differently for a topic, so a team that reorders
  or removes states changes only which canvases are called topics.
- **A new session's states are Topics, Active and Archive.** The archive
  stays always there and always last, and is renamed as before: a team
  that wants Done renames it.

*＋ makes a canvas; the canvas's ＋ makes a column.*

- **＋ in the sidebar and on a board column is "＋ canvas"**, one button
  with no ▾. The sidebar's puts the canvas at the end of the first open
  state, Topics by default; a board column's at the end of its own state.
  Folded, the sidebar shows ＋ alone, named "new canvas".
- **A new canvas opens with one thread not yet started**, whose composer
  has `@agent ` typed, as a branch from an agent thread does (ADR-0021):
  Enter asks the agent and makes its lane; deleting it makes the thread a
  chat. No choice is asked before the first message.
- **＋ past a canvas's last column keeps its ▾** (ADR-0138): ＋ makes an
  agent thread, and its ▾ a chat or a note column.

*A thread is a chat or an agent thread.*

- **A chat** is a thread nobody's agent works in: no lane, so a message
  that names no one goes to the people in it, and `@agent` asks the agent.
  "Conversation" is retired.
- **An agent thread** is a thread whose agent works in it: it has a lane,
  and a message that names no one asks the agent. "Agent work", as a kind
  of thread, is retired.
- **Neither is stored** (ADR-0021): a chat whose agent is asked becomes an
  agent thread.
- **A text card put on a board state starts a chat** (ADR-0111, ADR-0122),
  as it started a conversation root.

*The words, everywhere.*

- **One word per concept** (ADR-0100), in the page, the agent's
  orientation, the docs, the code and what is stored:
  - the card kind `task` becomes `canvas` (`TaskId`, `TaskCard`,
    `KINDS.task`, `TaskIndex`), the place key's `task` names a canvas, and
    `task-pinned` becomes `canvas-pinned`;
  - the task column becomes the **canvas column**, and the cards pinned to
    the task are **pinned to the canvas**;
  - the sidebar holds **your open canvases**;
  - the agent is told its canvas and the cards pinned to it, in those
    words;
  - where code says `chat` for a person's message (the role `chat`,
    `ChatDetails`, `ChatAt`, the `chat` command), it says message or send;
    `chat` names a chat alone.
- **An id keeps its prefix** (`k-` for a canvas): a prefix is no word
  anyone reads.

**Consequences.**

- **Every ＋ says what it makes**: a canvas in the sidebar and on the
  board, a column on a canvas. The agent or chat choice is asked only
  where a thread is made beside others; a new canvas asks none, and its
  first message decides.
- **Starting a chat costs one deletion** (`@agent `), where it took the ▾
  before. Starting an agent thread costs nothing more than it did.
- **The board reads Topics · Active · Archive**: one place to find what the
  team has, then the states its work moves through.
- **The rename is large and mechanical**: about 260 files of code name a
  task today. It changes stored kinds and the agent's orientation, so
  sessions written before it stop decoding (no backwards compatibility).
- **A session made before this keeps its stored state names**: Backlog,
  Doing and Done stay until a team renames them, and Backlog's canvases
  are then its topics.
- **Left for a later ADR: canvases of your own.** A canvas tracked by your
  sidebar alone, private to you, with agents running, beside the board's.
  What that one decides:
  - a "Yours" list as their home, so × stays a close for every item;
  - the sidebar in two sections, Mine and the team's, a canvas moved
    between them by the move that puts it on the board, and nothing
    appearing there until you open it (ADR-0030);
  - inviting a person into a canvas of yours, the place naming its people
    and the inbox's mention their way in, and later a section for private
    chats;
  - who may `@` a private canvas's agents (its people alone), and whether
    the team sees its threads' work waiting to be accepted;
  - that privacy is by rule today, not by data: every client gets the whole
    places document, and can read any root it finds in the session's
    directory (`docs/01-architecture.md`, Documents). Then the sidebar's ＋
    makes a canvas of yours, and a board column's a canvas on the board.

**Alternatives rejected.**

- **Keeping ＋ agent**: it names a default for the first message, and
  suggests agents are made.
- **＋ task**: it names what the board tracks, not what is made; a team
  chat on the board is no task.
- **Task as the card, topic as another word for some tasks**: two words
  for one card, the code saying one and the page the other.
- **Item, room or effort for what the board holds**: item says nothing;
  room fits a chat and not work; effort fits work and not a chat. Project
  and space were taken (a folder project; a surface).
- **Topics as a state of its own kind**, always first and never removed,
  as the archive is: nothing behaves differently for a topic, so its
  place in the workflow needs no guard.
- **Doing for the middle state**: it was the pair to Done. In progress is
  longer and says the same; Tasks breaks once a team adds Review, whose
  canvases are tasks too; Working collides with "the agent works".
- **Keeping the agent or chat choice on the sidebar's ＋**: it is a
  thread's choice, asked before anything is typed, and `@agent` changes it
  anyway.
- **A new canvas opening with no thread**, only its ＋: every start would
  take one more press, for a blank page.
- **Conversation**: longer, and the code already says chat.
