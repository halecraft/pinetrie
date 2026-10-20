# ADR-0073 — A thread's name opens its details, under the header: its icon magnified, who started it, where it works
Numbered 0071 until 2026-10-04, when two files held that number.

- **Status:** Accepted
- **Area:** `packages/interface/TECHNICAL.md`, `docs/06-interface.md`
- **Amends:**
  - ADR-0040: the name opens the thread's details; the reveal of where its
    lane started is in them, offered only below the path's first message.
  - ADR-0053: the icon is also drawn magnified, in the thread's details, where
    it spins in as they are opened.
- **Amended by:**
  - ADR-0198: the header's line, the name and the free space after it, opens
    the details, for every thread column.

**Context.** A column's header names the agent working in it, `✦ amber-fox`,
or its banner icon in the star's place (ADR-0040, ADR-0053). Clicking the
name revealed where the lane started on the column's path. In most threads
that is the first message, so the click only scrolled the column to its top,
and the name was underlined on hover like a link. Where it did help, a lane
that joined below, the list already marks the join with a divider. The
icons are each thread's mascot, drawn at about a megapixel and shown at
1.5rem. And a thread's facts had nowhere to show: who started it and when,
where it works, and in full what the header's `↓` says only in a tooltip.

**Decision.**
- **A named thread's icon and name are one toggle** for its details, with a
  chevron after the name that turns as they open. Only that toggle opens
  or closes them. Escape is left for the keyboard modes to come, and a click
  elsewhere does nothing. A conversation and a new agent not yet named have
  no details and no chevron.
- **The details open inline**, under the header and above the messages,
  which they push down. They are outside the header, so they are no drag
  handle and their text can be selected.
- **They show** the thread's mark magnified (the same `ThreadMark` as the
  header's: its banner, or the star), its name, who started its lane and how
  long ago, where it works, what it works on while it runs, the `↓`'s words
  in full, and "where it started". That last one is a reveal of the lane's
  start on the path, offered only when the start is below the path's first
  message.
- **Open or closed is the column's**, a reader's setting like its density
  (ADR-0056), and stored with the layout. Both settings are addressed by the
  column's key, so they work in a root's tab, in a new tab (a `＋ agent` tab
  is named before its first send, ADR-0057) and in the Archive tab's
  preview, which keeps them only while it shows.
- **The mark spins in, with a pop, when the reader opens the details**, and
  again at each click on it. Details mounted open, by a reload or a tab
  switch, show still, as a banner there at mount does not fade in
  (ADR-0053). With reduced motion asked for, nothing spins.

**Consequences.**
- The name no longer scrolls the column. The lane's start is a click further
  away, and only where it is worth one.
- An open panel makes the column's view shorter. A column at its end stays
  there: `useFollow` already follows a change in the view's size.
- A direct lane's details repeat where it works, which its work strip at the
  column's foot also says.
- The density control in the Archive preview, which did nothing before, now
  works there.

**Alternatives rejected.**
- **Removing the name's click.** That would drop the one useful reveal and
  leave the icon at 1.5rem, with nowhere to show the thread's facts.
- **A floating popover** (`popover.tsx`). It closes on Escape, a scroll and
  a click elsewhere, where the chevron promises a disclosure that stays
  open. Inline costs nothing extra, since the view's size is followed.
- **Keeping it open only while the column is mounted.** A reader who opens
  a thread's details means them to stay open.
- **Spinning on every mount.** Every tab switch would spin every open panel.
- **A second icon component for the panel.** It would copy the mark's star,
  banner, fade and blend. The panel draws `ThreadMark` itself, scaled.
- **The panel inside the header**, which is a drag handle with
  `user-select: none`, and whose height the banner check measures.
