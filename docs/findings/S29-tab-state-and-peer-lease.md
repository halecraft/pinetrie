# S29 — state per tab, and Kyneta's peer-id lease

**Answers.**
1. **Kyneta keeps a tab's peer id in a tab slot and a device slot.**
   `persistentPeerId(key)` (`@kyneta/exchange`, `src/persistent-peer-id.ts`)
   stores the device's stable id in `localStorage[key]` and the tab's id and
   token in `sessionStorage[key]` and `sessionStorage[key:tk]`. The tab holding
   the device id writes its token to `localStorage[key:held]`: a lease, taken by
   compare-and-swap (write, then read back) and released on `pagehide`. A pure
   `resolveLease` decides between the cached id, the device id and a fresh one.
   Nothing else passes between tabs: no `BroadcastChannel`, no `storage` event.
2. **A reload followed by a new tab does not collide, by accident.** The
   reloading tab's `pagehide` clears the lease, and on load `resolveLease`
   returns its cached id without claiming anything. It is safe only because the
   gathering step writes the lease before the decision is made (line 176,
   `localStorage.setItem(heldKey, sessionToken)`, whenever there is no holder),
   so the reloaded tab holds the lease again. Moving that write after the
   decision, where a reader would expect it, would give the next new tab the
   device id while the reloaded tab still uses it.
3. **Duplicate Tab gives two live tabs one peer id** (measured). Browsers copy
   `sessionStorage` into a duplicated tab, and `resolveLease` returns a cached id
   before looking at the lease. Kyneta's `packages/exchange/TECHNICAL.md` (§ The
   substrate's own copy of the invariant) says two peers sharing an id lose
   operations. In pine·trie the writer id is derived from the peer id, so the
   duplicate is also the same writer, with the same presence keys.
4. **A crash leaves the lease held** (reasoned from the code, not measured).
   No `pagehide` fires, so `localStorage[key:held]` keeps a dead tab's token.
   No collision follows, but no new tab gets the device id again.
5. **The fix belongs in Kyneta.** A tab has to be able to tell that another live
   tab holds its token. The Web Locks API fits: a lock held for the page's life
   is released by the browser when the tab closes or crashes, which also clears
   a stale lease. How locks behave across a reload and the back/forward cache is
   not measured, and needs a probe in a real browser before the fix.
6. **After `whenSettled(doc)`, a newly connected client reads every entry**
   (measured). In 50 of 50 trials a client connected to a host holding 40
   entries read all 40 through `readTreeIndex` once `whenSettled` resolved, and
   in 0 of 50 had them when `connectSession` returned. Kyneta's `docStatus` is
   `"populated"` as soon as any data arrives, and `useDocReady` is
   `docStatus !== "pending"`, so neither is the signal that everything has.
7. **pine·trie's open columns take the same shape without the lease**
   (ADR-0027): a tab slot for reloads, a device slot for new tabs. Columns need
   no uniqueness, since a duplicated layout is what Duplicate Tab means.

## Why it was asked

A reload closed every column. Keeping them per tab, with the device's latest as
a fallback, is what `persistentPeerId` already does for peer ids, so its code
was read, and probed, before the pattern was copied. Restoring columns also
drops those whose anchor is missing from the document, which is only safe once
the document has fully arrived, so that moment was measured too.

## Result

| case | result |
|---|---|
| primary tab reloads, then a new tab opens | different ids |
| a tab is duplicated | the same id in both |
| late client, entries at `connectSession` | 0 of 50 trials complete |
| late client, entries after `whenSettled` | 50 of 50 trials complete (40 of 40) |

## Consequences

- pine·trie keeps open columns per tab through `packages/client/tab-state.ts`,
  and drops missing anchors once, after `whenSettled` (ADR-0027).
- Until Kyneta is fixed, a duplicated pine·trie tab is the same writer as its
  original: the same name, presence keys shared between the two tabs, and
  document operations at risk. `packages/client/TECHNICAL.md` § Who a tab is
  says so.
- A fix in `persistentPeerId` needs a regression test that copies a tab's
  `sessionStorage` map, as the probe below does.
- Keeping the peer id across a reload has its own cost for notes: the tab
  comes back under the same id with a fresh replica, which can corrupt a note
  or lose its attribution (S28). Restoring columns does not add to it, since
  columns are never written to a document.

## Not tested

- A real browser. Tabs were simulated with maps; `pagehide` was fired by hand.
- Web Locks, in any browser.
- The crash case (4).
- `whenSettled` over a slow or lossy connection. Both probes ran on loopback.

## Method

Kyneta at `@kyneta/exchange` 3.0.0 (the linked build), Node 24.

The lease probe, run from `sandbox/`:

```js
const local = new Map()
const shim = m => ({
  getItem: k => m.get(k) ?? null,
  setItem: (k, v) => m.set(k, String(v)),
  removeItem: k => m.delete(k),
})
globalThis.localStorage = shim(local)
let tab // the tab now running
Object.defineProperty(globalThis, "sessionStorage", { get: () => shim(tab) })
const pagehide = []
globalThis.addEventListener = (type, f) => type === "pagehide" && pagehide.push(f)
const { persistentPeerId } = await import(
  "../../../kyneta/packages/exchange/dist/index.js"
)

// 1. The primary tab reloads (pagehide fires), then a new tab opens.
local.clear()
tab = new Map()
persistentPeerId("k")
for (const f of pagehide) f()
const reloaded = persistentPeerId("k")
tab = new Map()
const opened = persistentPeerId("k")

// 2. Duplicate Tab: the browser copies the tab's sessionStorage.
local.clear()
tab = new Map()
const original = persistentPeerId("k")
tab = new Map(tab)
const duplicate = persistentPeerId("k")
```

The settling probe, run from `apps/pinetrie/e2e/` for its dependencies:

```ts
const host = await startHost({
  model: { kind: "scripted", script: scriptedModel() },
  log: () => {},
})
const writer = await connectSession({ url: host.wsUrl, WebSocket, peerId: "s28-writer" })
for (let i = 0; i < 40; i++)
  await writer.chat(`message ${i}`, { kind: "root" }, { mode: "branch" })
await host.quiet()
const want = Object.keys(readTreeIndex(host.doc).entries).sort()
for (let t = 0; t < 50; t++) {
  const c = await connectSession({ url: host.wsUrl, WebSocket, peerId: `s28-late-${t}` })
  const before = Object.keys(readTreeIndex(c.doc).entries).length // complete?
  await whenSettled(c.doc)
  const after = Object.keys(readTreeIndex(c.doc).entries).sort() // === want?
  await c.close()
}
```

Closing each late client printed Kyneta's `Failed to decode message: Error:
Pipeline disposed` many times over: messages arriving after the client's
pipeline was disposed. Not examined; it doesn't affect the counts.

## Addendum: Kyneta v4 issues seats (ADR-0037)

Answers 3 to 5 are moot. Kyneta v4 removed `persistentPeerId`: every Runtime
issues itself a peer id, a *seat*, from its store or fresh per session, so no
two live replicas share one, a duplicated tab included. The caller names only
a *principal*. In pine·trie a principal is a person's email, asked once per
browser and kept in `localStorage`, so a duplicated tab, a reload, a second
tab and a second device are the same person on different seats. Answer 6
stands: `whenSettled` is still the signal that the document has arrived.

