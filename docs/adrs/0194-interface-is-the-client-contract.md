# ADR-0194 — Interface holds what any client decides alike; the web client's own decisions are `@pinetrie/web-core`; pure code names only the globals it may; the page reads no rules or reads; a terminal client proves the contract

Numbered 0192 until 2026-10-20, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `packages/interface/TECHNICAL.md`, `packages/web/TECHNICAL.md`,
  `packages/session/TECHNICAL.md`, `ARCHITECTURE.md`,
  `docs/01-architecture.md`
- **Evidence:** S269, S270, S271, S272, S273, S276
- **Amends:**
  - ADR-0093: the yardstick stays and becomes the placement rule; a pure
    module whose inputs are the browser's is `@pinetrie/web-core`'s, and
    `inventory-dock.ts` moves with them.

**Context.** ADR-0093 put in `@pinetrie/interface` whatever a TTY would
need, and its notes turned that into a rule a reader can apply at a
glance: every module that touches neither React nor the DOM is
interface's (S115). The two differ for a pure module whose inputs are the
browser's. Thirteen modules decide, whole or in part, from pixels, a
pointer, the order of scroll events and observer callbacks, animation
frames, an element's attributes, a clipboard's formats or the URL, and
`upload.ts` posts to `/blob` with `fetch` (S269). A terminal would take
none of that.

The drift runs the other way too. The page calls 35 rules functions and
9 reads directly: which cards a column shows, the board, a digest's
points, a message's blocks (S271). A terminal would make each decision
again, and the page's own decisions are proven only in a browser.

Nothing holds the contract. Interface's no-DOM check let `fetch` through,
since Node's types declare it (S269). A pure folder inside the page,
fenced by a config and Biome, fails only the type check: Vitest and Vite
still resolve React there (S270, S273). And no second client exists,
though one drawing a thread, an ask's digest and the composer from
interface's index alone works today as a unit test (S272).

**Decision.**

- **The yardstick is the placement rule.** A module is interface's when a
  terminal would call it with its own inputs and keep what it returns.
  One whose inputs or constants are the browser's (pixels, a pointer, the
  order the browser dispatches events in, animation frames, an element's
  attributes, a clipboard's MIME types, the URL's hash and history) is
  the web client's. A module holding both halves splits, as S269 lists.
- **The web client's own decisions are `@pinetrie/web-core`**
  (`packages/web-core`), the functional core of which `@pinetrie/web` is
  the shell: pure, unit-tested without a browser, declaring only
  `@pinetrie/core` and `@pinetrie/interface`. Resolution keeps React, the
  DOM's packages and the page's components out of it at type-check, in
  Vitest and in Vite alike, as it keeps pi out of every package but
  `packages/pi`. The page's existing pure decisions join it
  (`popover-place.ts`, `image-click.ts`, and what the host kept of an
  upload, `kept-images.ts`), each DOM type replaced by a structural one.
  How the page draws stays the page's, pure or not: `React.memo`'s rules
  (`same-props.ts`, `message-props.ts`) and the palette's colours, checked
  against `index.html` (`colors.ts`).
- **Pure code names only the globals it may, and the list stays small by
  construction.**
  - One root `tsconfig.pure.json` type-checks every pure package in one
    program, with `lib: ["ESNext"]`, no ambient types, and
    `pure-globals.d.ts`: `TextEncoder`, `TextDecoder`, `URL`,
    `URLSearchParams`, `AbortSignal`, each with the members used (S276).
    Its `include` lists the pure packages (interface, shell, web-core,
    the terminal client, and the session's main entry): saying a package
    is pure is one line in one file. It replaces interface's and shell's
    own configs, and `pnpm run typecheck` runs it once. There `fetch`,
    `globalThis.fetch`, `process`, `Buffer`, `XMLHttpRequest`,
    `localStorage` and the DOM do not exist.
  - A unit test keeps the list honest: each declared global is named in
    the code the config checks, and each carries a line saying who needs
    it. A dead entry fails; growth is a reviewed line in a short file.
  - The list holds pure code's needs only. The session's main entry
    exports its pure modules and types; its connection, id minters,
    attention and open-threads documents are a subpath,
    `@pinetrie/session/connect`, which the page and the suites import.
    `SessionClient`, `HostRequest` and `AttentionStore` move to modules
    that import no connection code, and `sendActing` leaves `acting.ts`
    for the connection (S276). The session's shell then names what it
    needs without touching the list.
  - A failure explains itself: the declaration file's header and a gotcha
    in `docs/01-architecture.md` say that "Cannot find name `fetch`" there
    means take it from your caller, never add it to the list.
  - Posting a blob is the client's connection to its host:
    `SessionClient.upload`, with the `fetch` its caller hands it, as
    `connectSession` takes the `WebSocket` constructor.
- **The page declares neither `@pinetrie/rules` nor `@pinetrie/reads`.**
  Their 44 decisions reach it from interface, each a function the page
  calls where it called it (S54, S59): the rules through one module that
  re-exports them with the record types a view hands on
  (`host-rules.ts`), the reads through `projection.ts` and `presence.ts`.
  Where a client's drawing repeated itself, interface gained the one
  function (`pathRows`, `rowHolds`, `hostCardLine`, the summary's
  `pointsMarkdown`). Moving the rules' code that only the page called is
  left to the reorganisation of `@pinetrie/rules`: each such function sits
  in a module the host also loads. `workspace.test.ts` pins the page's
  dependencies. Core stays declared for its vocabulary, so a decision core
  lends the page stays core's, unfenced: a wrapper in interface would add
  a name and fence nothing.
- **A terminal client proves the contract**: `apps/tui`, declaring only
  `@pinetrie/interface`, `@pinetrie/session` and `@pinetrie/core`, its
  arranging through `@pinetrie/interface/fixtures`. Its draw functions
  switch exhaustively over the unions interface hands it (`ColumnRow`,
  `AskRow`), so a new variant fails its type check until
  it is drawn; and it holds an `AppPorts` (`satisfies AppPorts`), so a
  new port fails until a terminal says what it does with it. (A port
  whose signature names a browser type already fails the pure config,
  where the DOM does not exist.) Its tests draw a thread's messages and
  asks, an ask's digest and its points, and the composer; and, as a
  client with no canvas, what needs you, the inbox and a reply's
  `SendHow`. Its assembly is its own, as a terminal's would be (S272). It
  is not shipped until it can start.

**Consequences.**

- What a terminal needs fails `apps/tui` when it leaves interface; a
  decision made from rules or reads fails resolution in the page; React
  in the web client's decisions fails resolution; I/O in pure code fails
  the type check. A decision written inline in a component is caught by
  none, as now.
- Three layers read in their names: `interface` for any client,
  `web-core` for the web client's decisions, `web` for its drawing.
- Interface's index loses the web client's modules and grows by the views
  that absorb the page's direct calls and the types it draws.
- The input chain (`Intent`, `planIntent`, `Effect`, `perform`) stays
  interface's, though `IntentState` carries the page's layout: a client
  with no canvas acts through the session, with `planSend` deciding how.

**Alternatives rejected.**

- **A pure folder in the page, fenced by a TypeScript config stubbing
  React and Biome's restricted imports.** Both fail only the type check
  and the lint; a React import there still resolves in Vitest and Vite
  (S270, S273). A Vitest project aliasing React to a stub would close
  Vitest, unmeasured, and still leave a second kind of fence to keep.
- **`@pinetrie/browser` for the package.** Beside `web`, it does not say
  how the two relate; `web-core` names the core of which web is the
  shell.
- **Biome's `noRestrictedGlobals` denying `fetch`.** `globalThis.fetch`
  passes it (S270); the globals list refuses both (S273).
- **Eight globals, the session's among them** (S273). Every global the
  session's connection came to need would have joined the pure list.
- **The terminal client as a test inside `packages/interface`.** It could
  import any of interface's modules, so "alone" would hold by care.
- **An assembly of a screen in interface for the terminal client.** The
  page memoises each projection on its own inputs (S54, S59) and would
  not call it, so it would drift from what the page draws.
- **Fencing core's decisions out of the page.** Resolution cannot tell
  core's vocabulary from its decisions; the page keeps core.
