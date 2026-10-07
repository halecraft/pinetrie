# ADR-0098 — Your avatar opens a menu, your profile is a page in the workspace's place, and a person may have a picture

**Status:** Accepted (Duane, 2026-10-07). Implemented in two steps:
`PLAN-2026-10-07-account-corner` (the corner, the menu and the profile
page), then `PLAN-2026-10-07-person-pictures` (pictures); both built. Amends ADR-0037 (you
rename yourself on your profile page), ADR-0042 (a person's picture is a
blob the sweep keeps), ADR-0085 (the footer's corner), ADR-0088 (folded, the
corner's avatar carries the inbox's badge, and the inventory's toggle is in
the account menu) and ADR-0091 (the inbox is an icon in the corner; folded,
it is in the account menu).

**Context.**

- **The corner has three styles side by side.** Your avatar is a solid
  circle in your person colour (`presence.tsx`), magenta for the first
  person. The inbox is plain text with an amber badge. The inventory's
  toggle is an outlined pill, the publish button's style. Each was added on
  its own (ADR-0085, ADR-0091, ADR-0048).
- **It is crowded.** `.footer-you` has a `.25rem` gap and the avatar's
  padding is zeroed, so that the avatar, a two-digit badge and the
  inventory's toggle fit in 11.5rem (`packages/web/index.html`).
- **The profile is a dialog doing four jobs.** It shows your email, renames
  you, signs you out, and, while your list is folded, holds the inventory's
  toggle (ADR-0088). It is a dialog only because a `role="menu"` may not
  hold a text field (`profile.tsx`). Renaming is rare, and seeing who you
  are and getting elsewhere are what the avatar is clicked for.
- **Folded, the inbox stands outside the corner,** on everyone's side of the
  footer, which ADR-0085 keeps for what is shared.
- **The app has no page.** Everything is columns, a column's pane
  (ADR-0078), popovers and dialogs. A pane belongs to a column, and a
  picture's upload and crop need more room than a popover. There is no URL
  routing: the host serves one page, and view state is kept per tab
  (`tab-state.ts`).
- **A person has no picture.** They are drawn as a circle holding their
  initial (`Initial`, `presence.tsx`). Their name is a `pinetrie.participant`
  record in the session's document, keyed by writer, whose contents are the
  name alone (`packages/rules/participant.ts`).
- **What a picture needs exists.** `POST /blob` keeps PNG, JPEG, GIF and
  WebP with their width and height (ADR-0042). A new kind of record needs no
  schema change (ADR-0095), so no migration (ADR-0096). The host sweeps
  blobs nothing references after a grace period (`sweepBlobs`,
  `readReferencedBlobs`).

**Decision.**

*The corner, with your list full.*

- **You on the left: your avatar and your name, as one button** that opens
  the account menu. A long name is cut with an ellipsis. The name is the
  first thing to give way at 11.5rem.
- **Your inbox and your inventory on the right, as icon buttons of one
  style:** a monochrome icon in `currentColor`, no border, muted at rest,
  your list's hover fill, a square target of about 28px, about .5rem apart.
  Each one's accessible name and title say it in words, with its count.
- **Amber is the corner's one colour beside your own.** The inbox's badge
  stays amber, the page's colour for what needs you (ADR-0091). The
  inventory's count is muted text beside its icon, and absent at zero.
- **Pills stay on the right half of the footer,** for actions on what is
  shared, such as the publish button (ADR-0090). Your own things in the
  corner are icons.

*The corner, with your list folded.*

- **Only your avatar, carrying the inbox's badge** on its corner, so what
  needs you stays in sight. The inbox no longer stands outside the corner.

*The account menu.*

- **A `Menu` that opens upward from the corner,** replacing the profile
  dialog. Its heading is not an item: your avatar, larger, your name and
  your email.
- **While your list is folded, it lists Inbox and Inventory,** each with its
  count. Choosing Inbox shows the inbox's sections in the same box, with a
  back item first. The inbox behaves as ADR-0091 says. Inventory toggles
  its panel, and while the panel is open its item says it closes it: a
  menu's ✓ marks one of a choice, not a toggle.
- **Then Profile, which opens the profile page, then "sign in as someone
  else"** (ADR-0037).

*A page.*

- **A page replaces the workspace:** it covers the columns' cell. Your list
  and the footer stay. The workspace stays mounted under it, laid out and
  inert, so coming back finds its columns, scroll and drafts as you left
  them, and nothing that measures the workspace sees it shrink.
- **A page starts with a header row: a back button, "← back", then its
  title.** The back button returns to the workspace, and so do the
  browser's Back and choosing a root in your list.
- **A page is named in the URL's hash** (`#profile`). Opening it pushes a
  history entry, so the browser's Back leaves it and a reload stays on it.
  A hash that names no page is the workspace.
- **The page's frame is one component, with its body in a centred column
  of readable width.** The profile is the first page. Later pages, such as
  settings, use the same frame.

*The profile page.*

- **Your picture, large, with "upload a picture" and, when you have one,
  "remove".** An upload takes a chosen, dropped or pasted image. You crop it
  to a square by dragging and zooming. The browser draws the crop at
  256×256 and sends it to `POST /blob`, then sets it as your picture.
- **Your name, in the field `NameInput` draws now,** with its handle and its
  problems, saved on Enter or save (ADR-0037).
- **Your email, read-only.** Signing in as someone else stays in the menu
  only.

*A person's picture.*

- **A `pinetrie.picture` record** in the session's document, keyed by writer,
  whose contents are the blob's SHA-256. A new kind of record, so no schema
  change and no migration.
- **Set by a `picture` command** carrying a SHA-256, or `null` to remove it,
  for the sender's own writer only, as `name` is (ADR-0037). The host
  refuses a blob it does not hold. One larger than 512×512, which it tells
  from the blob's stored dimensions without reading its bytes, it fits
  within that by pi's resize, as an upload is fitted (ADR-0042), keeps as
  a blob of its own, and sets that. No client's picture is refused for its
  size, and none is drawn from more than 512 pixels.
- **The blob sweep counts a picture as a reference.** An upload whose
  picture is never set is swept after the grace period, like an image
  pasted and deleted.
- **A picture is drawn wherever a person's circle is** (`Initial`): the
  footer, readers on your list, the board and columns, avatar stacks and
  menus. It fills the circle. While it loads, or if it fails, the initial
  in the person's colour shows. The circle keeps its classes, so the
  browser suite still counts `.avatar`.
- **A person's colour stays wherever a person is a mark, not a portrait:**
  the rail's rings, card pips and the inventory's card borders. These are
  too small for a picture, and must read against a track (S110).

**Consequences.**

- The corner reads as part of your list: the same hover fill, no borders,
  and amber only where something needs you.
- Folded, the inbox takes two clicks instead of one. Its badge on your
  avatar still says when to make them.
- Renaming takes a page instead of a popover, which costs a click. Seeing
  your name and email takes none, since the menu's heading shows them.
- Pages are a new pattern: the hash, the history entry and the hidden
  workspace are decided once here. A page is per tab, as the layout is
  (ADR-0027).
- Everyone in a session sees everyone's picture, as they see names and
  emails (ADR-0037). A picture is unauthenticated, as a name is.
- Every client fetches each picture once: `GET /blob` is immutable, so the
  browser caches it.
- Changing your picture leaves the old blob to the sweep.

**Alternatives rejected.**

- **The profile as a column's pane** (ADR-0078). It keeps your place, but a
  pane belongs to a column, and a profile is no column's.
- **The profile as a centred modal.** It covers the page for a form, and
  gives later pages no pattern to follow.
- **A page that unmounts the workspace.** Coming back would rebuild every
  column and lose its scroll.
- **Hiding the workspace with `display: none`.** Every observer of its
  size would see it shrink to nothing: the strip's narrow measure
  (`useStripNarrow`) would turn an open pane into a modal dialog over the
  page.
- **A page with no URL.** The browser's Back would leave pine·trie, and a
  reload would lose the page.
- **The picture inside `pinetrie.participant`,** changing its contents from
  a name to `{name, picture}`. That changes a stored shape and needs a
  migration, and setting one would write the other.
- **Cropping on the host.** `POST /blob` keeps what it is sent, fitted to
  2000×2000 (ADR-0042). Cropping in the browser lets you see the crop
  before anything is uploaded.
- **The inbox submenu opening to the side.** In a 3rem corner there is no
  side room.
- **Keeping the inbox beside the folded corner.** It puts something of
  yours on everyone's side of the footer.
