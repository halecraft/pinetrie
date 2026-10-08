# S98 — a host with a page open never stopped, because nothing closed Vite

- **Status:** Answered

**Question.** After `pnpm host`, one Ctrl-C printed `[host] shutting down`
and the host went on running. A second Ctrl-C often returned to the shell,
yet the node process stayed, holding port 7391, until `kill -HUP`. Which
step of the shutdown hangs, and why does the second signal leave an orphan?

**Kill criterion.** If the host stops on one SIGINT with a page open, the
hang lies outside the host (pnpm, the terminal), and the host needs no
change.

**Throw away.** The probes: a host started from `apps/pinetrie/host/server.ts`
with a throwaway store, a headless Chromium page opened through
`@playwright/test`, and logging patched into `shutdown()` and
`RunningHttp.close()`, all reverted.

**Answers.**

1. **With no client, SIGINT stops the host at once.** The host was started
   with `PINETRIE_PROVIDER=anthropic PINETRIE_MODEL=claude-sonnet-4-5
   PINETRIE_STORE=<tmp>`: no model request is made unless a run starts.
2. **With one page open, the `server` step never ends.** Every step up to
   `server` finished within 6 ms of the signal. `server` is
   `RunningHttp.close()` (`apps/pinetrie/host/http.ts`), which ended with
   `httpServer.close(cb)`. Node calls `cb` only once every open socket has
   ended. One connection stayed open, and it was not the exchange's:
   `wss.clients.size` was 0, since `exchange.shutdown()` had closed the
   exchange's sockets.
3. **It was Vite's HMR socket.** Vite runs in middleware mode, its HMR
   websocket on the host's own server (`hmr: { server: httpServer }`), and
   nothing called `vite.close()`. With `await vite.close()` before
   `httpServer.close`, the open connections fell to 0 and the process
   exited. Closing the page had the same effect.
4. **`closeAllConnections()` does not close an upgraded socket.** A bare
   `node:http` server with one `ws` client: after `close()` and
   `closeAllConnections()`, `getConnections` still counted 1 and `close`'s
   callback had not run. `terminate()` on the server's side of the socket
   let it run. Node drops a socket from the connection list
   `closeAllConnections` walks once it upgrades.
5. **A page retries Vite's socket, and after `vite.close()` no one answers
   it.** Read from Vite 7.1's source, not run. When its HMR socket drops,
   the client retries once a second with a websocket upgrade under the
   `vite-ping` protocol (`vite/dist/client/client.mjs`,
   `waitForSuccessfulPingInternal`). The HMR server's `close()` terminates
   its clients and removes its `upgrade` listener from the shared server
   (`vite/dist/node/chunks/config.js`). After that, a retry reaches only
   the host's own `upgrade` handler, whose `"vite"` case leaves the socket
   alone: an upgraded socket nothing answers, which by answer 4 holds
   `httpServer.close` open. So the host stops accepting before it closes
   Vite.
6. **The second Ctrl-C.** Read from behaviour, not measured. The terminal
   sends SIGINT to pnpm, `sh` and node alike. node's handler started a
   second `shutdown()`, which hung like the first. pnpm gave up on the
   second SIGINT and exited, and the shell took back the terminal. node was
   no longer in the foreground process group, so Ctrl-C could not reach
   it. SIGHUP, which the host does not handle, killed it.
7. **Why no suite caught it.** Every browser scenario closed its page
   before it shut its host down.

**The fix,** in `PLAN-2026-10-04-host-stops`: `RunningHttp.close()` stops
the server accepting, closes Vite, terminates the exchange's sockets, cuts
requests in flight, then waits for the close. `server.ts` removes its
signal handlers on the first signal, so a second one ends the process.
The browser suite's `banner` scenario checks that a host shuts down with a
page still open.

**After the fix,** measured as in answers 1 and 2: with a page open, one
SIGINT ends `server.ts` within 3 s. With `await vite.close()` taken out
again, the first SIGINT leaves the host running, as before, and a second
ends it at once, leaving nothing listening on 7391.
