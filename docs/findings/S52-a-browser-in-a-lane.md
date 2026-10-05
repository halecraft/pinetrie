# S52 — a browser in a lane, the host's browser server, and the suites' model

Agents in lanes kept trying to reach the Playwright server on the Mac at
`:3100`, which `e2e:browser` connected to because pi-jail's Seatbelt denied
Chromium `mach-register` (WS1). pine·trie applies no sandbox of its own. This
probe asks whether a lane can run its own Chromium, what the host's server
gives a lane, and why the browser suite failed in a lane.

**Answers.**

1. **Chromium runs in a lane.** `playwright install --with-deps
   chromium-headless-shell` took 26 s: 97 apt packages and a 319 MB browser
   (headless shell 141.0.7390.37, Playwright build 1194, the same build the
   Mac's server reported). `chromium.launch()` to a first page took 109 ms.
   Seatbelt's `mach-register` denial was the jail's, and a Linux VM has no
   Seatbelt.
2. **`e2e:browser` against a browser in the lane:** 79 checks passed and 4
   failed, the same 4 in two runs, in 132 s. Against the Mac's browser, from
   the same lane: 82 passed and 1 failed, in 28 s. The suite needed no change
   for either: `PW_SERVER` named a `run-server` started in the lane. Both runs
   then stopped at `committedProject`'s `jj commit`, which the lane's
   `JJ_CONFIG` broke (its `immutable_heads()` names a commit only the lane's
   repo has).
3. **The failures were the model, not the browser.** The suite's main
   section ran on the `named` model `cerebras` / `qwen-3.8-27b`. A lane's
   `~/.pi/agent/auth.json` names no provider (its keys were listed, not its
   values), so every run failed at once. The failing checks wait for a run in
   progress: the composer's queue label, the `.msg.waiting` row, the rail's
   pulse, and the click on it. The faster browser caught more of the instant
   runs.
4. **The Mac's browser reaches a lane only through the client.** With
   `chromium.connect(url, { exposeNetwork: "<loopback>" })`, the Mac's
   Chromium loaded a page, and opened a websocket, served on the lane's
   `127.0.0.1`, in 160 ms. Without the option: `ERR_CONNECTION_REFUSED`, since
   `127.0.0.1` is then the Mac's.
5. **The Mac's browser reaches the Mac.** From a lane, with no option, the
   Mac's Chromium opened `http://127.0.0.1:3100/` (200) and read
   `file:///etc/hosts` and
   `file:///System/Library/CoreServices/SystemVersion.plist`. Only harmless
   targets were tried. By the same route a lane could read
   `~/.pi/agent/auth.json`, or open a pine·trie host bound to the Mac's
   loopback, which admits loopback with no key. ADR-0034 counts neither as
   reachable.
6. **pi-ai's faux provider drops concurrent requests to a factory that
   queues itself again.** `stream` takes a response off the queue
   synchronously, when the request arrives, and runs a factory a microtask
   later. Three requests in one tick, to a queue holding one such factory, got
   one reply and two `No more faux responses queued` errors. Wrapping the
   provider so that `stream` queues one factory just before it delegates
   answered all three. A factory awaiting a promise held its reply while the
   other requests passed it, and the queue drained to 0.

## What this means for the design

- A lane can carry its own browser, so no gate needs a browser server on the
  host, and the host's server should not run while lanes are up (item 5).
- The browser suite and `e2e` need no real model: what they check is
  pine·trie's, and a scripted model can hold a run open for as long as a check
  needs (item 6).
- A scripted provider queues one response per request, never a response that
  queues itself again.

## Not measured

- Chromium on the Mac outside the jail: `chromium.launch()` there should need
  only `playwright install chromium-headless-shell`.
- The size of a default image with the browser in it.
- Whether a lane's own `playwright install` survives its container's
  recreation. It should not: the root filesystem is the container's, not the
  disk's.

## Method

In lane `t-01a0edea-…` (Debian 13, arm64, 5 CPUs, 4 GiB), on 2026-09-29.
Browsers installed with `PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers`; a
`playwright run-server` on the lane's `127.0.0.1:3200`; the Mac's server at
the gateway, `192.168.64.1:3100`. `browser.ts` was patched to pass
`exposeNetwork` for one run and put back. The probes were scripts under
`apps/pinetrie/e2e/` and `packages/pi/`, deleted after each run.
