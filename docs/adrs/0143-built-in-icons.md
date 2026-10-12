# ADR-0143 — A thread's icon is its noun's built-in sprite unless the user config draws one, and the config names its source

- **Status:** Accepted (Duane, 2026-10-13)
- **Area:** `docs/06-interface.md`, `packages/interface/TECHNICAL.md`,
  `packages/web/TECHNICAL.md`, `packages/rules/TECHNICAL.md`,
  `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S188, S190
- **Amends:**
  - ADR-0050: the user config's `banner.enabled` is replaced by
    `icons.source`, which names where icons come from: `built-in`, `drawn` or
    `none`.
  - ADR-0053: a thread's default icon is its noun's built-in 32×32 sprite,
    shipped with the page; drawing one from the name is the `drawn` source,
    and a built-in icon never shows before a drawn one.
  - ADR-0088: the folded list shows every task's icon, a built-in one
    included, so initials are left for a task with no named thread.

**Context.** A thread's icon (ADR-0053) is drawn by an image model from the
thread's name, only when the user config turns banners on and pi has an
OpenRouter key. By default nobody sees one, and the folded list (ADR-0088)
shows initials. A name is an adjective and a noun from two lists of 256, and
S188 and S190 found that one 32×32 icon per noun, on a transparent ground,
can be made once for all 256: about $21 with PixelLab's Pro model, every
noun recognisable, the set alike, and 118 KB as 256 files.

**Decision.**

- **The user config names the source:** `{ "icons": { "source": … } }`,
  one of `built-in` (the default, also when `icons` is missing or
  malformed), `drawn` (with an optional `model`, else Recraft V4.1 Flash), or
  `none`. `banner` is no longer read.
- **The host publishes the source** as the one `pinetrie.icons` value, at
  start, before it takes a command. The page reads it, and shows a built-in
  icon only under `built-in`. With no value yet it shows ✦.
- **One rule decides a thread's icon** (`threadIcon`): its
  `pinetrie.banner` record, under any source; else, under `built-in`, its
  noun's icon, once it is named; else ✦. The header, the details, the folded
  strip, the card face and the folded list all ask it, so a conversation's
  thread shows its noun's icon on its face, its strip and in the list. Its
  header names no thread, and draws no mark.
- **Built-in icons ship with the page**, one PNG per noun named by the
  noun, under `packages/web/public/noun-icons/`.
- **A built-in icon is drawn unblended.** A banner's black ground is taken
  out with `mix-blend-mode: lighten`, which would take out a built-in
  icon's dark outline. Magnified in the details it is pixelated; elsewhere
  it is smoothed.
- **`set_banner` is in every run.** A pasted image is set under any source;
  a new drawing is refused unless the source is `drawn`, and the refusal
  names the setting.

**Consequences.**

- With no setting and no key, every named thread has an icon.
- Under `drawn`, a new thread shows ✦ until its drawn banner fades in, as
  before; the noun's icon is never shown first.
- Threads that share a noun share a built-in icon.
- A changed noun list needs its new nouns' icons drawn; a unit test fails
  until every noun has one.
- A person whose config said `banner.enabled: true` gets built-in icons
  until they write `icons.source: "drawn"`.

**Alternatives rejected.**

- **The noun's icon whenever a thread has no banner record, whatever the
  source.** The page would need no setting, but under `drawn` a new thread
  would show its noun's icon and then, seconds later, a different image.
- **The host writes a banner record pointing at the noun's icon.** Every
  icon would be a stored blob; records written under `built-in` would stay
  when the source changes, so `bannerDue` would never draw for those
  threads; and the record would need a kind for the CSS.
- **One sprite sheet.** Half the bytes, but the page would fetch it whole
  for the few icons it shows, every image would need `background-position`,
  and tiles found by index break silently when the noun list is reordered.
- **Keep `banner.enabled`, with built-in icons as its off state.** It does
  not say what is chosen, and has no way to say "the star only".
- **`set_banner` only under `drawn`.** A pasted image needs no model.
