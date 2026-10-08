# ADR-0040 — A column's header says who works in it and where it came from; its work shows at its foot

- **Status:** Accepted
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`
- **Amends:**
  - ADR-0032: a direct lane's column no longer says where it works and that
    the directory is shared; its work strip says where its changes land, and
    warns only while another lane runs there.
  - ADR-0038: the offer moves from the column's header to its work strip, and
    its lines become plain words, with the bookmark shown apart.
  - ADR-0039: the header shows the name alone, as who works in the column;
    where the lane works moves to the work strip, as an effect.
- **Amended by:**
  - ADR-0047: the offer's line opens its review, and its bookmark copies on a
    press.
  - ADR-0057: a fresh column that wants an agent is named at once, so `✦ new
    agent` shows only until its name arrives.
  - ADR-0073: the name opens the thread's details; the reveal of where its
    lane started is in them, offered only below the path's first message.
  - ADR-0102: there is no direct lane, and no direct work strip.
  - ADR-0113: the work strip moves from the column's foot to a row of its
    header.
  - ADR-0117: a fork row names a copy's source, or a parent thread in another
    task.

**Context.** A column's header was one row holding everything the column knew
about itself: the grip, "from Ada: …" (or "thread", "new chat", "new · with
the agent"), the lane's name and where it works ("amber-fox · own copy",
"amber-fox · in <dir> · shared"), the offer's line and buttons, avatars and
"close". In use:

- The name, the smallest and dimmest text, was squeezed out first when an
  offer shared the 28rem row. Conversations had no name, and a new column's
  appeared only after its first send.
- "thread" was the label of any column with no fork point. It said nothing.
- "own copy" and "shared" name a setup of the lane at the column's end, not
  what happened to the files.
- "offer updates after each turn", shown while a turn ran, read like a
  setting, and the offer line showed jj syntax with literal backticks.
- The move into agent work, which changes who a message goes to
  (ADR-0021), showed only as a small "agent joined" above the first asked
  message, hidden in a branch and never naming the lane.
- A new column's header said "new chat" while its composer held `@agent `.
- "from …" did nothing when clicked, and the hover outline linking a header
  and its fork dot was grey.

**Decision.**
- **The header has two rows.** The first says who works in the column, then
  the avatars and ×. The second, only for a column that forks, says where
  it came from. Nothing about files or offers is in the header.
- **Who works in a column is one of three things:**
  - its lane's name, `✦ amber-fox`, in the column's colour; clicking it
    reveals where the lane started;
  - `✦ new agent`, for a lane not yet named, or while the composer's next
    send would create a lane, as the composer decides it while you type;
  - nothing, for a conversation. The name is the lane's, and a column without
    a lane has none: its absence is the sign that a message goes to people.
    A word like "conversation" would be a mode name (`docs/06-interface.md`,
    principle 5).
- **The origin row** reads `↰ Ada: “Say exactly…”` behind a dot in the
  column's colour. A fork at an agent's message names the lane that wrote it.
  Clicking it reveals the fork message in the column that shows it.
- **Where a lane starts on a column's path, a divider says so:** `✦ amber-fox
  joined`, or `✦ copper-owl, from amber-fox` when a lane was above. The
  path is read as stretches, one per lane, from the revision record of each
  asked message: the same rule covers a conversation that asks the agent, a
  branch of agent work, and a column dragged first through several lanes.
- **A work strip above the composer says what became of the files.**
  - A lane with its own copy shows its offer: a plain line ("2 files ready",
    "a stack of 3 · 5 files ready", "conflicts with your edits in 1 file",
    "nothing to take yet", "2 files so far" while it runs), its buttons, and
    its bookmark apart, to find in jj.
  - A lane that works directly says "changes land directly in your working
    copy" (or the directory), and names any other lane running there now.
    "Shared" becomes a warning only while it is true.
- **`offerView` decides; the client words it.** `offerView` returns an
  offer's state, buttons and facts (files, size, conflicts, bookmark, …), and
  one client function writes its line and its buttons' labels.
- **Colour:** each track-coloured element sets one `--track`, and the hover
  outline between a header and its fork dot is in that colour.

**Consequences.**
- The name never shrinks, and it is there from the moment a lane is asked
  for.
- A person reads the change of mode in the header, before sending, and where
  it happened in the column.
- The offer no longer reshapes the header while a lane runs.
- A divider can name a lane only once its first turn has ended and its
  revision record exists; until then the column's own lane is assumed, and a
  lane not yet named reads "agent".
- The browser suite's selectors change: `.agent-name[data-thread]`,
  `.origin`, `.lane-join`, `.work .offer`, `.offer-bookmark`.

**Alternatives rejected.**
- Naming every column, conversations included: the name would then say
  nothing about who a message goes to.
- Keeping "own copy" or "shared" in the header, shorter or as an icon: it is
  the lane's setup, not the column's, and it names a setup, not an effect.
- Keeping the offer in the header on a second row: an outcome with actions
  that changes as the lane runs would keep reshaping the column's identity.
- Connector lines from a branch to its fork: sibling branches would cross.
- Keeping the offer's line in `offerView`: its button labels already lived in
  the client, so the words stayed split.
