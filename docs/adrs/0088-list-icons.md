# ADR-0088 — Your list folds to icons, each root's sprite or initials, and the footer's corner to your avatar

**Status:** Proposed. Implementation: `PLAN-2026-10-05-pane-fits-strip`.
Amends ADR-0085 (your list and the footer's corner
have a second, narrow width, which answers its deferred narrow screens).
Uses ADR-0089's root colour.
Amended by ADR-0098 (proposed): folded, your avatar carries the inbox's
badge and opens the account menu, which holds the inbox and the
inventory's toggle.

**Context.**

- **Your list is 15rem wide**, or 11.5rem below 56rem (ADR-0085). On a
  phone that is most of the screen. With a pane open (ADR-0087), those
  15rem decide whether the pane sits beside the thread or covers it.
- **ADR-0085 deferred narrow screens.** Its consequences say the list
  should collapse to each root's banner, and the footer to ▦, what needs
  you, and you.
- **Threads have square sprites** (ADR-0053), but only where banners are
  enabled (ADR-0050). A conversation root has no thread, and so no sprite.
- **A root has no colour of its own** until ADR-0089 gives it one.

**Decision.**

*Two widths.*

- **The list is full, as ADR-0085 has it, or icons**, about 3rem wide, the
  rail's `min-width`. A control at the foot of the list switches between
  them, and so does Ctrl+Shift+L, beside the inventory's Ctrl+Shift+I and
  Ctrl+Shift+O.
- **The choice is view state, per browser tab**, with the device's latest
  as a new tab's fallback (`tab-state.ts`), as the layout is (ADR-0027).
  With no choice stored, the list shows icons below 56rem and is full
  otherwise. A choice you make holds at any width.
- **The list never folds by itself.** Opening a pane, or anything else,
  leaves it as you set it.

*An item as an icon.*

- **Its picture is the sprite of the root's earliest thread that has
  one**, blended with `lighten` as in a column's header (ADR-0053).
- **Without a sprite, a tile in the root's colour** (ADR-0089) holds two
  initials: the first letters of the label's first two words, or the first
  two letters of a one-word label. The label is the root's title, or its
  first line, as now (`root-label.ts`).
- **The signals stay on the icon** (ADR-0077):
  - a still ring around it while the agent works
  - the amber or dim dot, and the fading ✓, on its top-right corner
  - your pip on its bottom-right
- **Hover and focus show a tooltip** with the label and who is reading
  there, as the readers' avatars do on a full item. The icon's accessible
  name is the label.
- **The root you are on is drawn as in the full list:** the page's colour,
  a neutral left edge, and a break in the list's edge.
- **⋯ and × become one menu**, opened by a right-click, Shift+F10 or the
  Menu key. It holds ⋯'s items and Close. Rename opens its field in a
  popover beside the icon. Dragging reorders, as in the full list.
- **＋ agent becomes ＋**, with its ▾ menu as before.

*The footer's corner.*

- **Whenever the list shows icons, the corner shows only your avatar.**
  The inventory toggle, with its count, moves into your profile dialog
  (`profile.tsx`). The board opens over the workspace, so it widens with it.

**Consequences.**

- ADR-0085's deferred narrow screens are answered for the list and the
  corner. The footer's right side is unchanged.
- The list and the rail become two narrow strips side by side. The plan's
  screenshots settle the spacing and edges that keep them apart.
- Two roots with no sprite, the same initials and the same colour look
  alike. The tooltip tells them apart.
- The browser check that keeps the pane inside the strip (ADR-0087)
  measures it at both widths.

**Alternatives rejected.**

- **Folding the list by itself when a pane would not fit**, so that space
  is given up in a fixed order: the pane shrinks, then the list folds, then
  the pane covers the page. Opening a pane already moves the columns, and
  the list folding on the same click would make the page jump. If manual
  folding proves not to be enough, this can come back.
- **One device-wide choice.** Two windows side by side want different
  widths.
- **One initial.** Titles start unevenly, and 26 letters at most leave
  little room once a list grows.
- **Hiding the list entirely.** The root you are on and every root's
  signals would go with it. Icons keep them.
- **The inventory as an icon beside the avatar.** 3rem can't hold an
  avatar, an icon and a count legibly.
- **A colour of the tile's own, apart from the tracks.** It would match
  nothing on screen. The root's colour (ADR-0089) is its trunk's, so the
  tile matches the rail and the first column once the root is open.
