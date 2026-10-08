# S112 — Behind a tunnel, Firefox's `/ws` waited behind Vite's HMR socket on port 24678

- **Status:** Answered
- **Led to:** ADR-0022, ADR-0107

Amends ADR-0022 (hot reload off loopback).

**Question.** A host bound off loopback, reached through a Cloudflare
tunnel, loads in Firefox, but `connectSession` times out ("Timeout waiting
for state after 10000ms"), and the console shows Vite failing to reach
`wss://<host>:24678/`. Why, and why not in Chromium?

**Kill criterion.** If `/ws` fails in Firefox with Vite's socket out of the
way, the cause is elsewhere (the tunnel, admission, Kyneta).

**Throw away.** A `cloudflared` quick tunnel (`cloudflared tunnel --url
http://127.0.0.1:7391`, 2026.10.0) to a host with `PINETRIE_BIND=0.0.0.0`,
and a Playwright probe in Firefox 1495 and Chromium headless.

**Answers.**

1. **Vite's host check refuses a tunnel's name first.** Through the tunnel,
   the page answered Vite's 403 "Blocked request. This host … is not
   allowed", `server.allowedHosts`. Admission (`host/admission.ts`) already
   decides which `Host` gets in, so the host sets `allowedHosts: true`.
2. **Off loopback, Vite listened on port 24678.** `hmr: false` does not
   remove `/@vite/client`, which connects regardless. In middleware mode
   without `hmr.server`, its port is 24678 (Vite 7.1.11,
   `dist/node/chunks/config.js`, `vite:client-inject`). The tunnel carries
   only 443, so that socket hung connecting.
3. **Firefox opens one WebSocket to a host at a time** (RFC 6455 §4.1, one
   connection in CONNECTING). With the 24678 socket hanging, `/ws` waited,
   and `connectSession` timed out at 10 s, in both of two Firefox runs.
   Chromium does not wait: three runs connected.
4. **Vite's listener can sit behind admission.** Vite reads `hmr.server`
   only with `on("upgrade")` and `off`. Given an `http.Server` that never
   binds, its listener answers only what `http.ts` emits on it, after
   `planUpgrade` admits. The client then connects to the page's own origin.
   After the change: Firefox connected `/ws` in two runs out of two, and
   Chromium in one out of one. A `vite-hmr` upgrade without the key got 403,
   and with the key it opened.

So Vite's socket no longer bypasses admission, which was ADR-0022's reason
for running hot reload on loopback only. Hot reload now runs off loopback
too. `e2e/host/admission` checks that the HMR socket opens on the host's own
port.
