# ADR-0091 — Your inbox sits by your avatar; the board shows where the agent works and what is ready to accept

- **Status:** Accepted (Duane, 2026-10-05)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`
- **Amends:**
  - ADR-0030: your inbox sits beside your avatar, and holds what the threads
    you follow raise as well as your mentions.
  - ADR-0069: the activity menu goes; its personal sections are your inbox,
    beside your avatar, which is always drawn, and running work is a count on
    the board's strip.
  - ADR-0077: an open offer is marked on the board for everyone, and listed
    and counted in your inbox for its followers.
  - ADR-0085: under your list, your inbox sits between your avatar and your
    inventory; the activity menu goes, and each state on the strip counts its
    roots where the agent works and those with work ready to accept.
- **Amended by:**
  - ADR-0098: the inbox is an icon button in the corner; folded, it is in the
    account menu.

Builds on ADR-0090.

**Context.** The footer splits where your list's edge does: what is yours
under your list, what is everyone's to the right (ADR-0085). The activity
menu sat on the right, yet held two kinds of thing:

| section | whose | in the badge |
|---|---|---|
| Needs you | the thread's followers' | yes |
| Ready to accept | listed for everyone | for followers only |
| Worth a read | the thread's followers' | no |
| Mentions of you | yours | the unseen ones |
| The agent is working in | everyone's | no; a steady count beside ✦ |

Its badge counted only what is yours, from everyone's side of the footer.
Duane asked for the notifications beside his avatar. The board (ADR-0085)
already draws every root, with a still ring where the agent works, so the
shared half of the menu repeated what the board could say. ADR-0090 then
turned the project menu into one publish button, which left the right of
the footer with no menu to hold a list of offers.

Two facts in the code mattered:

- **The board's ring missed roots this tab does not hold.** A root's status
  was working from the held lanes alone (ADR-0063), so only the activity
  menu's list showed a run in a root you had not opened.
- **The badge was counted twice**, once for the window's title and once for
  the badge, by sums that agreed only because an offer always needs you.

**Decision.**

- **Your inbox is under your list, between your avatar and your
  inventory.** Its sections, each shown only with rows, or kept while the
  menu is open on it (ADR-0030):
  - **Needs you**: verdicts of threads you follow that ask something;
  - **Ready to accept**: open offers of threads you follow;
  - **Worth a read**;
  - **Mentions of you**, with its filter and "mark all seen".

  Each thread's row opens it, with **not needed**. The inbox lists exactly
  what it counts: its badge is the verdicts that need you, your offers and
  your unseen mentions. One count is the badge's and the window title's.
- **The inbox is always drawn.** Quiet at zero, it never leaves: a corner
  of your own whose contents come and go reads as broken, and seen
  mentions stay reachable.
- **Everyone's facts go on the board.** An item whose root has a thread
  with an open offer carries **⇡**, for everyone, its title naming the
  threads; it is not amber, since it asks nothing. Each open state on the
  strip counts its roots where the agent works (`◌n`) and those with work
  ready (`⇡n`), each only when there are any.
- **The agent's work is read in every root**, from every running lane as
  well as the held lanes: a root's ring, in your list and on the board, and
  Move to Done's refusal while the agent works read the same facts.
- **One place asks, the other reports.** The inbox carries the page's only
  badge. The right of the footer is the strip, then the publish button and
  "syncing…", with no badge, and nothing in the footer animates.
- **The activity menu goes**, with its ✦ trigger and its working count.

**Consequences.**

- Someone else's offer is found by scanning the board for ⇡. Choosing the
  item opens its root, not the thread with the offer. The people meant to
  judge it, its followers, have a row that opens the thread.
- A run in a root you do not hold shows only as a ring on the board and a
  count on the strip. No menu lists the runs.
- The narrow footer ADR-0085 foresaw ("▦, what needs you and you") has its
  pieces in place.
- The browser suite keeps its check that a menu open on live data stays
  open when that data goes, now on a reader's menu on the board.

**Alternatives rejected.**

- **Move the whole activity menu under your list.** It would put everyone's
  runs and offers in your corner.
- **Offers in the project menu.** The menu became one button (ADR-0090).
- **A board filter for roots with ⇡.** It adds a mode to the board and
  still opens roots, not threads. It can come later from the strip's count.
- **A list of ready threads behind the strip's count.** It brings back a
  menu on the right, a second shared way in besides the board.
- **A badge-free agent trigger on the right.** The strip's count says the
  same without another trigger.
