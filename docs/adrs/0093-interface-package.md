# ADR-0093 — What a person sees and does is `@pinetrie/interface`'s, for any client; the web page is `@pinetrie/web`

- **Status:** Accepted (Duane, 2026-10-05)
- **Area:** `packages/interface/TECHNICAL.md`, `ARCHITECTURE.md`
- **Evidence:** S54, S59, S115
- **Amended by:**
  - ADR-0180: the placement rule the packages' notes share now says where a
    record's type lives; what the page shows is unchanged.

**Context.** `@pinetrie/core` is a dependency of every package, `lanes`,
`repo`, `pi` and the host among them, yet it held the columns' paths, the
rail's drawing, an ask's fold and presence's reads, which only the page
imported. The page's package, `@pinetrie/client`, depends on React, and
most of its modules did not: of its 82 non-test `.ts` modules, all but the
hooks, three React contexts and two DOM helpers type-check without the
DOM (S115). The placement rule the packages' notes shared, "What the page
draws, and its words, is `@pinetrie/client`'s", put what any client shows
in the same package as how a browser draws it.

The yardstick: if another kind of client, a TTY, would need it, it is in a
shared package. A TTY needs the columns, the rail in rows and tracks, the
folds, the intents and what they do, the views and their words. It does not
need React, the DOM, or HTML's tree.

**Decision.**

- **`@pinetrie/interface` holds what a person sees and can do, decided, for
  any client.** The name follows `docs/06-interface.md`, which designs this
  layer. It does no I/O and declares no React and no DOM:
  `packages/interface/tsconfig.json` type-checks it without the DOM
  library, and `workspace.test.ts` pins its dependencies.
- **`@pinetrie/client` becomes `@pinetrie/web`**: the `.tsx` components,
  the `use-*` hooks, and the modules that touch the DOM or React, exist
  only for `React.memo`, or deal in HTML's tree (`markdown.ts`,
  `pane.ts`). A TTY would be `@pinetrie/tty`.
- **A module that holds both halves splits:** a value, its rules and its
  codec are the interface's; where the browser keeps it is the page's
  (`IDENTITY_KEY`, `tabState`, the palette's hex colours).
- **Where `interface` ends and `@pinetrie/session` begins.** `session`
  stays one client's connection, its own documents and what it has in
  flight, deciding nothing about what is shown. `interface` depends on it.
- **The interface holds the whole chain an input goes through:** `Intent`,
  `planIntent`, `Effect`, `perform` and the `AppPorts` it calls. Each
  client implements the ports. `Effect` is one union: "focus moves to a
  column" and "bring an entry into view" mean the same in any client, and
  an effect a client has no use for (`fly` in a TTY) is a port that does
  nothing.
- **Words stay with their values** (`packages/interface/TECHNICAL.md`,
  "Words come from values"). A client that needs other words for a value
  replaces that value's words function when it needs to.
- **Core keeps what core's own exports use.** `projectRail` stays, since
  `summarizeRoots` counts a root's messages by its rows; `projectSpine`,
  `followTip` and `pathIds` stay as reads of the tree.
- **`MIN_STRETCH` separates.** `LONG_ASK` stays in core: a long ask is
  digested (ADR-0075) and drawn as a capsule of its own. The rail's
  shortest capsule follows from the span a client gives a capsule
  (`compactRail`'s `spanOf`): a run is a capsule when its span is shorter
  than its rows. A client's geometry never changes which asks the host
  digests.
- **The placement rule** the packages' notes share becomes: what a person
  sees and can do, and its words, is `@pinetrie/interface`'s; how the page
  draws it is `@pinetrie/web`'s.

**Consequences.**

- A TTY, or any other client, depends on `interface` and `session`, and
  implements `AppPorts` and its drawing.
- The suites read the interface's words from its index (`recipientWords`,
  `queueWords`), and the page's own (`COPIED`, `IDENTITY_KEY`) from web.
- ADRs and findings keep `@pinetrie/client` and `packages/client/…`, as
  they kept `marginalia`: they record what was decided then.
- The interface's projections stay separate functions, each memoised by
  the page (S54, S59).

**Alternatives rejected.**

- **Moving core's display code into `@pinetrie/client`.** It removes the
  code from core, and buries it where a second client cannot reach it
  without React.
- **Keeping it in core.** Core is every package's dependency, and the
  host, lanes and repo never show anything.
- **`@pinetrie/view`.** "View" already names reads (`LaneView`, `RootView`)
  and decided values (`BoardView`), and to an MVC reader it is the drawing
  half: the half this package is not.
- **`@pinetrie/screen`.** Too concrete: it is the glass, not what is on it.
- **`@pinetrie/client` for the shared package, the page renamed `web`.**
  Accurate, but `client` would change meaning under the ADRs, which name
  `packages/client/…` files that would no longer be there.
- **Splitting `Effect` and the words into shared and web halves.** A second
  union and a second planner would mirror the first; the ports and the
  words functions are already the seams.
