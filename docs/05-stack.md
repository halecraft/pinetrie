# Stack decisions — report for sign-off

The walking skeleton was built to *walk*, not to be lived in. It is 14 `.mjs`
files, no types, no linter, a hand-rolled DOM renderer, and **two lockfiles**.
This is the moment to fix that, before the client grows.

Below: what Kyneta's `examples/` already establish, what we do differently, and a
recommendation per decision. **Nothing here is applied yet.**

---

## What Kyneta already establishes

Read from `~/halecraft/kyneta` — these are house conventions we should inherit
rather than re-invent:

| Concern | Convention |
|---|---|
| Language | **TypeScript**, `strict: true`, `target ES2022`, `moduleResolution: "bundler"`, `noEmit`, `jsx: "react-jsx"` |
| Package manager | **pnpm** (`AGENTS.md`: "use `pnpm` as a package manager") |
| Format + lint | **Biome** — `lineWidth 80`, `indentWidth 2`, spaces |
| Tests | **Vitest** — `include: ["src/**/*.test.ts"]` |
| UI | **React + `@kyneta/react`** (`todo-react`, `bumper-cars`, `prisma-counter`) |
| Dev server | **Vite in middleware mode**, sharing one `node:http` server with `ws` |
| TS on Node | **`tsx`** to run the server (`dev: "tsx src/server.ts"`) |
| Verification | a `verify` cascade — "simple, fast problems first, then cascade to more severe" |

Two `AGENTS.md` rules worth adopting verbatim, because they match how this
project has actually been run: *"NEVER support backwards compatibility … always
delete old code, always take the elegant path even if it means extra effort"*,
and *"If you notice a 'pre-existing' problem … FIX IT."*

Also: **no non-null assertions (`!`), even in tests.**

### The Vite/WebSocket pattern you flagged

`examples/todo-react/src/server.ts`. One `node:http` server, Vite in middleware
mode, and `ws` in **`noServer`** mode with manually routed upgrades:

```ts
const vite = await createViteServer({
  root,
  server: { middlewareMode: true, hmr: { server: httpServer } },
})
httpServer.on("request", (req, res) => vite.middlewares(req, res))

const wss = new WebSocketServer({ noServer: true })
httpServer.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req))
  }
  // everything else falls through to Vite's own HMR upgrade listener
})
```

**Our host currently handles `upgrade` unconditionally**, so it would swallow
Vite's HMR socket. The `req.url === "/ws"` guard is the whole trick.

Their file also notes *why Node and not Bun*: *"Vite's dev server internals are
coupled to Node's http/net/stream modules."* That settles our runtime question —
see D7.

---

## Decisions

### D1 — TypeScript ✅ strongly recommend

**Today:** 0 `.ts` files, 14 `.mjs`. We consume Kyneta and pi — both fully typed
— through untyped imports, so we get nothing from their `.d.ts`.

**Why it matters more here than usual:** our ADRs are *invariants*, and several
are exactly what a type system checks.

- ADR-0013 — `seq` must never cross the wire. A branded `LocalSeq` type makes
  putting one in a protocol message a compile error rather than an e2e assertion.
- ADR-0006 — references are a discriminated union; exhaustiveness checking is
  the entire benefit.
- ADR-0011 — a branded `LaneName` derived from a peer id makes `"main"`
  unassignable.
- ADR-0004/0009 — `Entry` is immutable with a required unique id; `readonly`
  fields state that structurally.

We currently enforce these with runtime assertions in `e2e.mjs`. Types move them
left, and the e2e assertions stay as belt-and-braces.

**Cost:** ~1 100 lines. `pi/storage.ts` (593 lines) is the bulk and
the least interesting to convert. Stageable — `allowJs: true` lets us migrate
module by module.

### D2 — pnpm, and delete `package-lock.json` ✅ strongly recommend

**Today we have BOTH `package-lock.json` and `pnpm-lock.yaml`.** That is a bug,
not a choice — the skeleton was built under npm and you ran pnpm later. Two
lockfiles will drift and eventually produce "works for me" failures.

**The real win:** pnpm supports the `link:` protocol that npm rejected
(`EUNSUPPORTEDPROTOCOL`). That was the reason every spike hand-rolled symlinks
into `node_modules/@kyneta/`, and the reason `relink.sh` exists with its
"`npm install` deletes the symlinks" warning. Under pnpm this becomes ordinary
dependency declaration and **`relink.sh` can be deleted.**

Even better: since Pineta now lives beside Kyneta, a pnpm workspace could
include both — though that couples the repos, so I would *not* do it by default.

### D3 — Vite ✅ recommend

**DONE.** Was: esbuild one-shot bundle + a hand-rolled static file server in
`apps/pineta/host/index.ts` with a manual MIME map, plus a manual wasm copy step. All three
are deleted; `apps/pineta/host/http.ts` runs Vite in middleware mode on the shared
`node:http` server. Bundle fell 771 kB → 305 kB (Vite tree-shakes).

Vite gives us HMR, kills the MIME map, and — importantly — kills the
`build-client.mjs` wasm-copy hack **that already caused a real bug**: the
version-mismatch `LinkError` you hit came from that script hardcoding a path
that diverged from what the bundler resolved. `vite-plugin-wasm`
(`prisma-counter` uses it) handles this as a first-class concern.

**Caveat, and it was real:** requires the `/ws` upgrade guard, or HMR breaks
silently. Both sockets verified sharing one port. Also: do NOT add
`vite-plugin-top-level-await` — it fails the production build with an swc
error, and a modern browser needs no TLA rewrite (`target: esnext` instead).

### D4 — React + `@kyneta/react` ✅ recommend

**DONE.** `packages/client/app.tsx` is a React tree; the `innerHTML` rebuild is gone.
It renders from the SAME Exchange `connectSession` owns, handed to
`ExchangeProvider`, so Node and browser share one connection story.

Hook names, verified against source (both of my first guesses were wrong):
**`useTracked(thunk)`** is the derived read — `useValue` takes a `CallableRef`;
and `useDocStatus` returns the union `"pending" | "empty" | "populated"`, not
an object with `.synced`.

`useText` is **not yet used**: the composer is still local `useState`. Wiring it
to a `Schema.text()` is roadmap step 5.

`@kyneta/react` supplies exactly the hooks this project needs:
`useDocument`, `useValue`, `useText`, `useDocStatus`, `useInitialize`,
`useSelector`, `ExchangeProvider`.

**`useText` is the one that matters strategically.** ADR-0006 puts a
collaborative composer on the roadmap, and `useText` + `transformSelection` +
`diffText` are precisely that problem, already solved. Hand-rolling it would be
the single largest avoidable cost in the plan.

### D5 — Vitest ✅ recommend

`node --test` works, but Kyneta standardises on Vitest and our 11 core tests
port almost unchanged. Benefits: shared config style, watch mode, coverage, and
the ability to run browser-ish tests later. Low cost, high consistency.

### D6 — Biome ✅ recommend

We currently have **no formatter and no linter**. Adopt Kyneta's `biome.json`
settings (lineWidth 80, indentWidth 2, spaces) so code moves between repos
without reformat noise.

### D7 — Runtime: stay on Node ✅ recommend (no change)

Kyneta examples use Bun for some (`todo`, `bumper-cars`, `unix-socket-sync`) and
Node for the Vite ones. Two reasons to stay on Node: pi and `pi-agent-core` are
Node-targeted, and Kyneta's own comment says Vite middleware mode is coupled to
Node's `http`/`net`/`stream`. Since D3 chooses Vite, Node follows.

### D8 — A `verify` cascade ✅ recommend

Adopt the *idea* rather than their binary. Fast-to-slow, stop at first failure:

```
format → lint → typecheck → boundaries → unit → conformance → e2e
```

We already have the unusual ones (`check`, `conformance`, `e2e`); this just
orders them and adds the three we lack.

### D9 — Browser tests ⚠️ open, needs a decision

**This is the one real gap.** Browser rendering is verified *by hand only*; it
will regress silently. Kyneta's `biome.json` ignores `playwright-report/` and
`test-results/`, but I found **no `playwright.config.*` anywhere** — so there is
no house convention to inherit.

Options: (a) Playwright with its own bundled Chromium — note the skeleton build
already failed here, `ProcessSingleton` conflict with your running Chrome, so it
needs `playwright install chromium` rather than `channel: "chrome"`;
(b) Vitest browser mode; (c) accept manual verification and document it.

I lean (a), but it is the one choice with no precedent to copy.

---

### D10 — Apple's `container` for lanes of their own ✅ adopted (ADR-0034)

Each agent lane of its own runs in a Linux VM made by Apple's `container`.
The requirements:
- `container` **1.4 or later**, on **macOS 26, Apple silicon**. Other hosts,
  and hosts where `container` is missing or stopped, work directly; the host
  names the reason at startup.
- **A default kernel**: `container system kernel set --recommended`, once.
- **`container system start`**, and the host must run outside the sandbox:
  the jail blocks `container`'s XPC services and writes to its volumes under
  `~/Library/Application Support/com.apple.container/`.
- **The project on the same APFS volume as `container`'s data**, so a
  snapshot under `.pineta/snapshots/` is a copy-on-write clone.
- **Memory**: about 1.2 GiB per running lane (S40); a stopped lane takes
  none. `container build` runs a builder VM of 2 GiB, which the host stops
  after each build.
- **Disk**: each lane's disk is a sparse 64 GiB image that takes only what it
  wrote; snapshots share every unchanged block.

`pnpm run e2e:lanes` checks all of it, and reruns the contract test for the
volume image swap `container` does not promise (S40).

## What we keep

Ours, working, no equivalent upstream — do not discard in the migration:

- ~~`scripts/check-boundaries`~~ — deleted. It was a regex scanner and failed
  silently three times; boundaries are now enforced by module resolution, with
  `workspace.test.ts` checking the manifests. The original entry follows.
- **`scripts/check-boundaries.mjs`** — enforces ADR-0003's single-pi-coupling
  rule mechanically. It has already caught one real violation (mine).
- ~~**`scripts/sanity.mjs`**~~ — deleted (ADR-0023). Its `stepInPlace` guard ran
  in every host at startup until S47 showed it could never fail: a missing
  named import refuses the module at load. Its loro-crdt floor went with Loro.
- **`conformance/`** — pi's own 21-case `Storage` suite against our adapter.
- **`e2e/`** — the ADR assertions (monotonic `insert`, no wire `seq`, lane name
  not `"main"`). These stay valuable *after* types, because they test runtime
  behaviour types cannot.

---

## Suggested order

Each step independently verifiable; the suite must stay green throughout.

1. **pnpm + delete `package-lock.json`**, declare Kyneta via `link:`, delete
   `relink.sh`. *(Unblocks everything; removes a whole class of wiring bug.)*
2. **Biome + Vitest.** Mechanical, no behaviour change.
3. **TypeScript**, module by module, `core/` first (it is pure and has the
   tests), `pi/` last (largest, least interesting).
4. **Vite**, with the `/ws` upgrade guard; delete `build-client.mjs` and the
   static-file/MIME code in `host/`.
5. ~~React + `@kyneta/react`~~ — **done**.
6. **D9** — decide browser testing.

Steps 1–2 are cheap and I would do them regardless. Steps 3–5 are the real
investment, and the argument for doing them *now* is that step 5 is the
foundation for the tree UI, which is the very next feature.

---

## Sandbox constraints (`~/.config/pi-jail/policy.json`)

The jail shapes several stack choices, so it is recorded here rather than
rediscovered:

```json
"allowWrite": [".", "/tmp", "/private/tmp", "~/.pi/agent", "~/.cache", "~/.npm/_cacache"]
```

`"."` is the **session's** cwd — which is why writes were confined to
`~/tmp` before the repo move and work in `~/halecraft/pineta` after it, and why
`~/halecraft/kyneta` is read-only from here (desirable anyway).

Three consequences, all now handled:

1. **pnpm's global store is unwritable**, so it falls back **into the repo** at
   `.pnpm-store/` — **182 MB / 13 181 files**, which jj had already picked up in
   the working copy. Now gitignored and untracked. It was *not* in the
   "Walking skeleton" commit, so no history was polluted. Side effect: the store
   is per-repo rather than shared, so installs cost more disk than usual.
2. **pnpm 12 cannot reach the registry.** Its Rust fetcher validates through the
   macOS keychain (`OSStatus -26276`) and cannot see the sandbox CA, while
   `curl`, `npm`, and corepack all honour `SSL_CERT_FILE`. Pinned
   `packageManager: "pnpm@10.18.0"` so installs route through corepack's
   Node-based fetcher. **This is why the pin exists — do not remove it.**
3. **Playwright cannot write `~/Library/Caches/ms-playwright`**
   (`Operation not permitted`), so `playwright install` fails by default. Fix:
   `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers` (verified writable,
   gitignored). Note the earlier `ProcessSingleton` failure was a *separate*
   problem — a real running Chrome — and is why we must use a downloaded
   Chromium rather than `channel: "chrome"`.

## Status — you answered "all yes, Playwright"

| | decision | state |
|---|---|---|
| D1 | TypeScript | ✅ **done** — all `.ts`/`.tsx`, 0 `.mjs` source, `tsc --noEmit` clean (WS2) |
| D2 | pnpm, standalone | ✅ **done** — `link:` deps, `relink.sh` deleted, pi pinned 0.87.1 |
| D3 | Vite | ✅ **done** — middleware mode on the shared server; `/ws` guard verified; esbuild + MIME map + wasm-copy deleted |
| D4 | React + `@kyneta/react` | ✅ **done** — `packages/client/app.tsx`; `useText` still unused (roadmap step 5) |
| D5 | Vitest | ✅ **done** — replaced `node --test` |
| D6 | Biome | ✅ **done** — Kyneta's settings; caught a real lint bug on day one |
| D8 | `verify` cascade | ✅ **done** — `lint → check → sanity → test → conformance → e2e` |
| D9 | Playwright | ✅ **done, with a caveat** — 7/7, but the server must run OUTSIDE the jail (sandbox-runtime#210). Since ADR-0041, the suite launches its own Chromium; no server |

D7 (stay on Node) turned out load-bearing in a way we did not anticipate: **Node 24
strips types natively**, so there is no build step and no `tsx` — `node host/server.ts`
just runs.

## Original questions (all answered yes)

- **D1 TypeScript** — yes / staged / no
- **D2 pnpm** — yes (and: standalone repo, or pnpm workspace shared with Kyneta?)
- **D3 Vite** — yes / no
- **D4 React + `@kyneta/react`** — yes / no
- **D5/D6/D8** — assume yes unless you object
- **D9 browser tests** — Playwright / Vitest browser / manual-and-documented
