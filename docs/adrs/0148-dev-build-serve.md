# ADR-0148 — pine·trie runs as `pnpm dev`, through Vite, or as `pnpm build` then `pnpm serve`, which sends the built page; both build what is missing or stale before they start

- **Status:** Accepted (Duane, 2026-10-14)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/web/TECHNICAL.md`,
  `docs/05-stack.md`
- **Evidence:** S195, S196
- **Amends:**
  - ADR-0086: the command that serves a project is `pnpm dev [folder]` or
    `pnpm serve [folder]`, not `pnpm host [folder]`.

**Context.** `pnpm host [folder]` is the one way to run pine·trie. It
always serves the page through Vite's dev server in middleware mode, with
React's production build (`NODE_ENV=production`, S59);
`pnpm host:react-dev` serves React's development build. `pnpm build` runs
`vite build`, whose output nothing serves. So a person running pine·trie
to use it gets a development server, and a Mac's first start fails until
`pnpm vm:build` has been run by hand (ADR-0147).

S196 found that the host can serve `vite build`'s output instead of Vite,
once React is deduplicated: the build bundled pine·trie's React and the
linked Kyneta checkout's, and the built page failed on joining. Vite's dev
server hides this. The build takes 2.6 s and can list every file it read.

**Decision.**

1. **Three commands:**
   - **`pnpm dev [folder]`** is today's `pnpm host`: Vite in middleware
     mode, React's production build, a page change reloading the page.
     `pnpm dev:react` is today's `pnpm host:react-dev`.
   - **`pnpm build`** builds the page into `packages/web/dist/` and the
     lane VM's image where one is needed (ADR-0147), saying when it is
     not.
   - **`pnpm serve [folder]`** serves the built page, with no Vite in the
     process.
   Each takes the folder as `pnpm host` does (ADR-0086).
2. **Starting builds what is missing or stale, and says so.** `serve`
   rebuilds a page whose stamp does not match its inputs; `dev` and
   `serve` build a missing VM image on the Mac. `pnpm build` is the same
   work done before a start, not a precondition of one: a pull that
   changes the page or the image needs no rebuild by hand.
3. **The page's stamp** is `dist/inputs.json`, written by a plugin of the
   page's Vite config at the end of a build: the SHA-256 of each file the
   build read (`getWatchFiles`), of `vite.config.ts` and each file in
   `public/`, and the mode. It is stale when any listed file's hash
   differs or the file is gone. A pull, a checkout or an accepted
   offer's change is caught; a new file nothing yet imports cannot change
   the page until an import of it changes a listed file.
4. **React and React DOM are deduplicated** in the page's Vite config
   (`resolve.dedupe`), and a test builds the page and finds one React in
   the bundle.
5. **Serving the built page** is a pure plan over the request's path and
   the files in `dist/`: `/` is `index.html` with `cache-control:
   no-cache`; a file under `assets/` (named by its hash) is sent
   `immutable`; any other file in `dist/` is sent as is; anything else is
   404 (the page routes by its hash, so no path falls back to
   `index.html`). An upgrade other than `/ws` is refused: there is no
   HMR.
6. **The suites keep Vite,** with React's development build: the browser
   suite counts renders, which a production build does not record.

**Consequences.**
- `pnpm serve` starts in a second or two over a fresh build, and about
  3 s after a pull that changed the page; it holds no Vite, its module
  graph or its watcher.
- A page change made while `serve` runs is seen at its next start;
  `dev` keeps reloading.
- Production builds are now served, and the suites never serve one: the
  bundle test catches the duplicate-React case S196 found, and nothing
  else checks the built page in a browser.
- `pnpm host` and `pnpm host:react-dev` go, and every doc, comment and
  refusal that names them changes.

**Alternatives rejected.**
- **`serve` refuses a stale page, naming `pnpm build`.** The rebuild takes
  2.6 s; a refusal costs the person more than that.
- **A stamp of the inputs' mtimes and sizes.** A jj checkout rewrites
  mtimes, so every checkout would look stale. Hashing every input, 1341
  files and 6.3 MB, takes 28 ms (S196).
- **Keep `pnpm host` beside the new names.** No backwards compatibility.
- **Serve the built page in the browser suite.** It would lose the render
  counts, which need React's development build.
