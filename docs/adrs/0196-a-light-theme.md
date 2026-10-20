# ADR-0196 — The page has a light theme, following the system unless you choose one

- **Status:** Proposed
- **Area:** `packages/web/TECHNICAL.md`, `packages/web-core/TECHNICAL.md`
- **Evidence:** S280
- **Amends:**
  - ADR-0195: each named colour holds a light value and a dark one, and the
    fixed ink gives way to text a fill picks for itself.

**Context.**

- **The page was dark whatever the system was set to.** ADR-0195 named
  every colour by its role in one rule, ready for a second set.
- **A light set exists that keeps what the dark set guarantees** (S280):
  - text at the dark set's contrasts;
  - hues at 4.5 to 6:1 with their hue and chroma;
  - twelve track colours 0.070 apart and 0.088 from the colours that
    already mean something.

  The track colours could not all sit at one lightness, as they do in
  dark: a light page compresses readable colours, so each takes its own
  contrast between 4.5 and 6:1.
- **`light-dark()` holds both values in one declaration,** through custom
  properties, `color-mix()` and inline `var()`, in the suites' Chromium.
- **Some fills carry text and change from bright to deep:** a person's
  initial, a badge, a search's match, a card's main button. A banner's
  black, which `lighten` takes out, stays on a light page.

**Decision.**

1. **Each named colour is `light-dark(light, dark)`,** in the same rule.
   A name the same on both pages is written once. The rule sets
   `color-scheme: light dark`, and `:root[data-theme]` forces one.
2. **Both pages are held to the dark set's rules** (`colors.test.ts`), and
   `stylesheet.test.ts` fails on a name with a single value that is not
   meant to be the same on both.
3. **Text on a fill is ink or white by the fill's lightness,** one rule
   for every such fill. `--ink` goes.
4. **A later person's colour is a relative colour** of `--person-tone`,
   with their hue from their id.
5. **A banner sits on `--banner-ground`:** transparent in dark, a dark tile
   in light.
6. **The theme is light, dark or the system's,** chosen in the account
   menu and kept per device. The system's is the default. A script in
   `index.html`'s head applies a stored choice before the first paint.

**Consequences.**

- In dark the page draws as before: the same pixels and computed styles in
  20 captured views.
- On a light system the page is light until you choose dark.
- The browser suite's Chromium is set light, so its scenarios run on the
  light page.
- A colour added to the page needs a light value and a dark one, and the
  tests check both.
- `light-dark()` and relative colours set the page's browser floor at
  about Chrome 123, Firefox 128 and Safari 18 (2024).

**Alternatives rejected.**

- **A second `:root[data-theme="light"]` rule redefining each name:** each
  value twice, apart, and the system's preference would need either a
  media query that repeats the rule, or a script for every page load.
- **Inverting the dark ramps:** text loses its contrast, and the hues go
  pale and hard to read.
- **One lightness for all twelve light track colours:** at 4.6:1 the
  closest two are 0.050 apart, under the 0.059 that tells them apart in
  dark.
- **A fixed white for text on fills in light:** a bright person's initial
  then reads at 2.7:1.
