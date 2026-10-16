// S216: what Kyneta does with a root the host loads and lets go while a tab
// holds it, whether the host can tell which tabs hold a root, and what a loaded
// root costs. Disposable. Run from apps/pinetrie/host/ (its imports are that
// directory's) with `node --expose-gc s215-probe.ts`.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import { RootDoc } from "@pinetrie/schema"
import {
  Bridge,
  createBridgeTransport,
} from "/kyneta/workspace/pineta/packages/exchange/transports/bridge/dist/index.js"
import { openStore } from "./store.ts"

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const gc = (globalThis as { gc?: () => void }).gc
const heapMb = () => {
  gc?.()
  gc?.()
  return process.memoryUsage().heapUsed / 1e6
}
const warnings: string[] = []
console.warn = (...a: unknown[]) => void warnings.push(a.map(String).join(" "))
const until = async (f: () => boolean, ms = 3000) => {
  const t0 = performance.now()
  while (!f()) {
    if (performance.now() - t0 > ms) return -1
    await sleep(5)
  }
  return Math.round(performance.now() - t0)
}
const out = (o: object) => console.log(JSON.stringify(o))

const row = (i: number, bytes: number) => ({
  id: `e${i}`,
  parentId: i === 0 ? null : `e${i - 1}`,
  type: "message",
  timestamp: i,
  fromId: null,
  thread: "t-1",
  payload: { role: "assistant", text: "x".repeat(bytes) },
})
const fill = (doc: ReturnType<Exchange["get"]>, n: number, bytes: number) =>
  batch(doc as never, (d: any) => {
    for (let i = 0; i < n; i++) d.entries.set(`e${i}`, row(i, bytes))
  })
const count = (doc: unknown) =>
  Object.keys((doc as { entries: () => object }).entries()).length

const dir = mkdtempSync(path.join(tmpdir(), "s215-"))

function host(file: string) {
  const bridge = new Bridge()
  const ex = new Exchange({
    principal: "host",
    type: "service",
    transports: [createBridgeTransport({ transportId: "host", bridge })],
    store: openStore(file).store,
    departureTimeout: 0,
    resolve: () => undefined,
  })
  ex.register({ name: "authority", authority: "self" } as never)
  return { bridge, ex }
}
function client(bridge: Bridge, id: string, wanted: Set<string>) {
  const ex = new Exchange({
    principal: `c-${id}`,
    transports: [createBridgeTransport({ transportId: id, bridge })],
  })
  ex.register({
    name: "roots",
    canShare: (docId: string) =>
      docId.startsWith("root:") ? wanted.has(docId) : undefined,
  } as never)
  return ex
}
const peersOf = (ex: Exchange, docId: string) =>
  ex.synchronizer
    .getPeerStates(docId)
    .map(s => `${s.peer.principal}:${s.state}`)
    .sort()

// --- P1: the host lets a root go while a tab holds it, then writes to it ---
{
  const { bridge, ex } = host(path.join(dir, "p1.db"))
  const A = "root:a"
  const a = ex.get(A, RootDoc)
  await ex.whenHydrated(A)
  fill(a, 50, 100)
  await ex.flush()
  const c = client(bridge, "c1", new Set([A]))
  const copy = c.get(A, RootDoc)
  const synced = await until(() => count(copy) === 50)
  out({ p: "1a", clientSyncedMs: synced, hostPeers: peersOf(ex, A) })

  const docEvents: string[] = []
  c.documents.subscribe((cs: any) =>
    docEvents.push(...cs.changes.map((x: any) => `${x.type}:${x.docId}`)),
  )
  ex.unload(A)
  await ex.flush()
  await sleep(100)
  out({
    p: "1b",
    hostMode: ex.documents.get(A)?.mode,
    hostPeers: peersOf(ex, A),
    clientStillHas: count(copy),
    clientEvents: docEvents.splice(0),
    clientPeers: peersOf(c, A),
    reloads: warnings.filter(w => /reload/.test(w)).length,
  })

  // The host opens it again, as a command into it would, and writes.
  const again = ex.get(A, RootDoc)
  await ex.whenHydrated(A)
  batch(again as never, (d: any) => d.entries.set("e50", row(50, 100)))
  await ex.flush()
  const got = await until(() => count(copy) === 51)
  out({
    p: "1c",
    hostCountAfterReload: count(again),
    clientGotWriteMs: got,
    hostPeers: peersOf(ex, A),
    clientEvents: docEvents.splice(0),
  })

  // The tab writes nothing to a root, but a second tab that opens it now
  // gets everything.
  const c2 = client(bridge, "c2", new Set([A]))
  const copy2 = c2.get(A, RootDoc)
  out({ p: "1d", secondTabMs: await until(() => count(copy2) === 51) })
  await ex.shutdown?.()
}

// --- P2: a tab asks for a root the host let go: does the host see it load? --
{
  const { bridge, ex } = host(path.join(dir, "p2.db"))
  const B = "root:b"
  const b = ex.get(B, RootDoc)
  await ex.whenHydrated(B)
  fill(b, 20, 100)
  await ex.flush()
  ex.unload(B)
  await ex.flush()
  await sleep(50)
  const hostEvents: string[] = []
  ex.documents.subscribe((cs: any) =>
    hostEvents.push(...cs.changes.map((x: any) => `${x.type}:${x.docId}`)),
  )
  warnings.length = 0
  const wanted3 = new Set([B])
  const c = client(bridge, "c3", wanted3)
  const copy = c.get(B, RootDoc)
  const got = await until(() => count(copy) === 20)
  out({
    p: "2a",
    clientGotMs: got,
    hostMode: ex.documents.get(B)?.mode,
    hostEvents: hostEvents.splice(0),
    reloadWarnings: warnings.filter(w => /reload/.test(w)),
    hostPeers: peersOf(ex, B),
  })
  // The host's own get now: the same document, already hydrated?
  const mine = ex.get(B, RootDoc)
  out({
    p: "2b",
    hydratedAtOnce: ex.hydrated(B),
    hostCount: count(mine),
  })
  batch(mine as never, (d: any) => d.entries.set("e20", row(20, 100)))
  out({ p: "2c", clientGotHostWriteMs: await until(() => count(copy) === 21) })

  // --- P3: does the host hear a tab let the root go? ---
  const peerChanges: string[] = []
  ex.synchronizer.onPeerSyncChange((docId, states) =>
    peerChanges.push(
      `${docId}=[${states.map(s => `${s.peer.principal}:${s.state}`).join(",")}]`,
    ),
  )
  // As a tab lets a root go: no longer wanted, then destroyed.
  wanted3.delete(B)
  c.destroy(B)
  await sleep(100)
  out({
    p: "3a",
    afterClientDestroy: peersOf(ex, B),
    peerChanges: peerChanges.splice(0),
  })
  const c4 = client(bridge, "c4", new Set([B]))
  const copy4 = c4.get(B, RootDoc)
  await until(() => count(copy4) === 21)
  out({
    p: "3b",
    afterSecondTab: peersOf(ex, B),
    peerChanges: peerChanges.splice(0),
  })
  await c4.shutdown()
  await sleep(100)
  out({
    p: "3c",
    afterTabShutdown: peersOf(ex, B),
    peerChanges: peerChanges.splice(0),
    hostPeers: [...ex.peers.keys()].length,
  })
  // The other order: destroyed while still wanted, then no longer wanted.
  const wanted5 = new Set([B])
  const c5 = client(bridge, "c5", wanted5)
  const copy5 = c5.get(B, RootDoc)
  await until(() => count(copy5) === 21)
  out({
    p: "3d",
    withFifthTab: peersOf(ex, B),
    peerChanges: peerChanges.splice(0),
  })
  c5.destroy(B)
  wanted5.delete(B)
  await sleep(100)
  out({
    p: "3e",
    afterDestroyThenUnwant: peersOf(ex, B),
    peerChanges: peerChanges.splice(0),
  })
  // A third tab joins: is the fifth asked again, and does it take it?
  const c6 = client(bridge, "c6", new Set([B]))
  const copy6 = c6.get(B, RootDoc)
  await until(() => count(copy6) === 21)
  await sleep(50)
  out({ p: "3f", afterSixthTab: peersOf(ex, B), fifthHolds: c5.has(B) })
  await ex.shutdown?.()
}

// --- P5: the host lets go of a root a tab's ask just loaded ---
for (const when of ["at-promotion", "next-macrotask"] as const) {
  const { bridge, ex } = host(path.join(dir, `p5-${when}.db`))
  const E = "root:e"
  const e = ex.get(E, RootDoc)
  await ex.whenHydrated(E)
  fill(e, 500, 1000)
  await ex.flush()
  ex.unload(E)
  await ex.flush()
  await sleep(50)
  let unloads = 0
  let promotions = 0
  ex.documents.subscribe((cs: any) => {
    for (const x of cs.changes)
      if (x.type === "doc-promoted" && x.docId === E) {
        // Only the first: unloading at every promotion while the tab still
        // waits loops, the tab asking again and the host reloading.
        promotions++
        if (promotions > 1) continue
        const go = () => {
          try {
            ex.unload(E)
            unloads++
          } catch (error) {
            out({ p: "5x", when, error: String(error) })
          }
        }
        if (when === "at-promotion") queueMicrotask(go)
        else setTimeout(go, 0)
      }
  })
  const c = client(bridge, `c5-${when}`, new Set([E]))
  const copy = c.get(E, RootDoc)
  const got = await until(() => count(copy) === 500, 2000)
  await sleep(100)
  out({
    p: "5",
    when,
    unloads,
    promotions,
    tabGotAllMs: got,
    tabHas: count(copy),
    hostMode: ex.documents.get(E)?.mode,
  })
  // The host loads it again and writes: does the tab catch up?
  const again = ex.get(E, RootDoc)
  await ex.whenHydrated(E)
  batch(again as never, (d: any) => d.entries.set("e500", row(500, 1000)))
  await ex.flush()
  out({
    p: "5b",
    when,
    tabCaughtUpMs: await until(() => count(copy) === 501, 2000),
  })
  await ex.shutdown()
}

// --- P4: what a loaded root costs, by size; loading N, one by one or at once --
{
  const file = path.join(dir, "p4.db")
  const sizes = [
    { entries: 50, bytes: 1000 },
    { entries: 500, bytes: 1000 },
    { entries: 2000, bytes: 2000 },
  ]
  const N = 20
  {
    const { ex } = host(file)
    for (const s of sizes)
      for (let r = 0; r < N; r++) {
        const id = `root:${s.entries}-${r}`
        const d = ex.get(id, RootDoc)
        await ex.whenHydrated(id)
        fill(d, s.entries, s.bytes)
      }
    await ex.flush()
    for (const s of sizes)
      for (let r = 0; r < N; r++) await ex.compact(`root:${s.entries}-${r}`)
    await ex.flush()
    await ex.shutdown()
  }
  // What each root takes in the store, as Duane's store can be asked.
  const stored = new Map<number, number>()
  {
    const db = new DatabaseSync(file, { readOnly: true })
    for (const s of sizes) {
      const r = db
        .prepare(
          "SELECT SUM(COALESCE(LENGTH(payload),0)+COALESCE(LENGTH(blob),0)) AS b FROM kyneta_records WHERE doc_id LIKE ?",
        )
        .get(`root:${s.entries}-%`) as { b: number }
      stored.set(s.entries, r.b / N / 1e6)
    }
    db.close()
  }
  for (const s of sizes)
    for (const how of ["sequential", "parallel"] as const) {
      const { ex } = host(file)
      const before = heapMb()
      const t0 = performance.now()
      const ids = Array.from({ length: N }, (_, r) => `root:${s.entries}-${r}`)
      if (how === "sequential")
        for (const id of ids) {
          ex.get(id, RootDoc)
          await ex.whenHydrated(id)
        }
      else
        await Promise.all(
          ids.map(id => {
            ex.get(id, RootDoc)
            return ex.whenHydrated(id)
          }),
        )
      const ms = performance.now() - t0
      const after = heapMb()
      out({
        p: "4",
        how,
        entries: s.entries,
        entryBytes: s.bytes,
        storedMbPerRoot: +(stored.get(s.entries) ?? 0).toFixed(2),
        roots: N,
        msPerRoot: +(ms / N).toFixed(1),
        heapMbPerRoot: +((after - before) / N).toFixed(2),
      })
      for (const id of ids) ex.unload(id)
      await ex.flush()
      await sleep(50)
      out({
        p: "4u",
        entries: s.entries,
        how,
        heapMbPerRootAfterUnload: +((heapMb() - before) / N).toFixed(2),
      })
      await ex.shutdown()
    }
}

rmSync(dir, { recursive: true, force: true })
