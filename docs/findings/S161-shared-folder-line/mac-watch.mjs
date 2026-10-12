#!/usr/bin/env node
// S161, question 4, on the Mac: does a watcher on the shared folder see every change,
// lanes' writes through virtiofs included? Disposable.
//
//   node .plans/disk-model-probes/S161/mac-watch.mjs [minutes]     (15 by default)
//
// Run it from your working copy while threads are working as usual. It:
// - scans the shared folder (.plans) at the start;
// - watches it with @parcel/watcher (FSEvents), as the host would;
// - writes 20 small files of its own into scratch/mac/ at random moments, as you
//   would on the Mac;
// - scans again at the end, and checks that every change the scans show was
//   named by an event (or by an event for a folder above it).
// Ctrl-C ends it early, and it still writes its results:
// results-mac-watch-<time>.json beside this file, which the lane reads.
// @parcel/watcher installs into a temporary folder, never into the repo.

import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const MINUTES = Number(process.argv[2] ?? 15)
const DEPS = path.join(os.tmpdir(), "s161-deps")

function watcherModule() {
  const req = createRequire(path.join(DEPS, "x.js"))
  try {
    return req("@parcel/watcher")
  } catch {
    fs.mkdirSync(DEPS, { recursive: true })
    const r = spawnSync(
      "npm",
      ["install", "--no-save", "--prefix", DEPS, "@parcel/watcher@2.6.0"],
      { stdio: "inherit" },
    )
    if (r.status !== 0) throw new Error("npm install failed")
    return req("@parcel/watcher")
  }
}

function scan() {
  const out = new Map()
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try {
          const s = fs.lstatSync(p, { bigint: true })
          let hash = ""
          if (s.size < 5n * 1024n * 1024n && e.isFile())
            hash = crypto
              .createHash("sha1")
              .update(fs.readFileSync(p))
              .digest("hex")
          out.set(
            path.relative(ROOT, p),
            `${s.ino}:${s.size}:${s.mtimeNs}:${hash}`,
          )
        } catch {}
      }
    }
  }
  walk(ROOT)
  return out
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const watcher = watcherModule()
  console.log(`watching ${ROOT} for ${MINUTES} minutes; Ctrl-C ends early`)
  const before = scan()
  const t0 = performance.now()
  const events = []
  const errors = []
  const sub = await watcher.subscribe(ROOT, (err, evs) => {
    if (err)
      errors.push({ t: Math.round(performance.now() - t0), error: String(err) })
    for (const e of evs)
      events.push({
        t: Math.round(performance.now() - t0),
        type: e.type,
        path: path.relative(ROOT, e.path),
      })
  })
  const macDir = path.join(HERE, "scratch", "mac")
  fs.mkdirSync(macDir, { recursive: true })
  const end = t0 + MINUTES * 60_000
  const writeAt = Array.from(
    { length: 20 },
    () => Math.random() * MINUTES * 60_000,
  ).sort((a, b) => a - b)
  let stop = false
  process.on("SIGINT", () => {
    stop = true
  })
  let next = 0
  let minute = 0
  while (!stop && performance.now() < end) {
    await sleep(200)
    const now = performance.now() - t0
    while (next < writeAt.length && writeAt[next] <= now) {
      fs.writeFileSync(
        path.join(macDir, `m${next}.txt`),
        `written on the Mac at ${Date.now()}\n`,
      )
      next++
    }
    if (now / 60_000 >= minute + 1) {
      minute++
      console.log(
        `${minute} min: ${events.length} events, ${errors.length} errors`,
      )
    }
  }
  await sleep(2000)
  await sub.unsubscribe()
  const after = scan()
  const changed = new Set()
  for (const [p, v] of after) if (before.get(p) !== v) changed.add(p)
  for (const p of before.keys()) if (!after.has(p)) changed.add(p)
  const named = new Set(events.map(e => e.path))
  const covered = p => {
    const parts = p.split(path.sep)
    for (let i = parts.length; i > 0; i--)
      if (named.has(parts.slice(0, i).join(path.sep))) return true
    return false
  }
  const missed = [...changed].filter(p => !covered(p))
  const mac = [...changed].filter(p =>
    p.includes(`S161${path.sep}scratch${path.sep}mac`),
  )
  const other = [...changed].filter(
    p =>
      !p.includes(`S161${path.sep}scratch${path.sep}mac`) &&
      !p.includes(`S161${path.sep}results-mac-watch`),
  )
  // Bursts: events closer than 1 s apart.
  const ts = events.map(e => e.t).sort((a, b) => a - b)
  const bursts = []
  for (const t of ts) {
    const last = bursts.at(-1)
    if (last && t - last.end <= 1000) last.end = t
    else bursts.push({ start: t, end: t })
  }
  const gaps = bursts
    .slice(1)
    .map((b, i) => b.start - bursts[i].end)
    .sort((a, b) => a - b)
  const quantile = (a, q) =>
    a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : null
  const result = {
    root: ROOT,
    minutes: Math.round((performance.now() - t0) / 600) / 100,
    platform: `${process.platform} ${os.release()}`,
    events: events.length,
    errors,
    changedFiles: changed.size,
    changedByThisScriptOnTheMac: mac.length,
    changedByOthers: other.length,
    missedByEvents: missed.slice(0, 50),
    missedCount: missed.length,
    missedOnTheMacCount: missed.filter(p => mac.includes(p)).length,
    bursts: bursts.length,
    burstMs: {
      median: quantile(
        bursts.map(b => b.end - b.start).sort((a, b) => a - b),
        0.5,
      ),
      p90: quantile(
        bursts.map(b => b.end - b.start).sort((a, b) => a - b),
        0.9,
      ),
    },
    gapMs: { min: gaps[0] ?? null, median: quantile(gaps, 0.5) },
    changedOthersSample: other.slice(0, 30),
  }
  const file = path.join(
    HERE,
    `results-mac-watch-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  )
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`wrote ${file}`)
  console.log(
    `changed ${result.changedFiles}, missed by events ${result.missedCount}`,
  )
}

await main()
