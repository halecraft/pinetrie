// Mutations for the host's own unit tests. Run: pnpm mutate scripts/mutations/host.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "apps/pineta/host"]

export const mutations: readonly Mutation[] = [
  {
    name: "a store does not own its file",
    file: "apps/pineta/host/store.ts",
    from: '    db.exec("PRAGMA locking_mode = EXCLUSIVE")',
    to: '    db.exec("PRAGMA locking_mode = NORMAL")',
    command: unit,
    expect: "a store owns its file",
  },
  {
    name: "no seat ever departs",
    file: "apps/pineta/host/lines.ts",
    from: "): string[] => [...open].filter(seat => !peers.has(seat))",
    to: "): string[] => [...open].filter(seat => !peers.has(seat) && false)",
    command: unit,
    expect: "departedSeats",
  },
  {
    name: "a client may write another's command Line",
    file: "apps/pineta/host/policy.ts",
    from: "    routeLine(docId, peer) === false",
    to: "    routeLine(docId, peer) === undefined",
    command: unit,
    expect: "its two ends only",
  },
  {
    name: "planUploadHeaders reads any type",
    file: "apps/pineta/host/blobs.ts",
    from: "  if (type === undefined || !isImageMime(type))",
    to: "  if (type === undefined)",
    command: unit,
    expect: "planUploadHeaders reads a body only",
  },
  {
    name: "sqliteBlobs.ref reads no dimensions",
    file: "apps/pineta/host/blobs.ts",
    from: '    "SELECT sha256, mime, width, height FROM pineta_blobs WHERE sha256 = ?",',
    to: '    "SELECT sha256, mime, 1 AS width, 1 AS height FROM pineta_blobs WHERE sha256 = ?",',
    command: unit,
    expect: "ref reads the dimensions without the bytes",
  },
  {
    name: "anything under /offer/ reaches Vite",
    file: "apps/pineta/host/routes.ts",
    from: '  if (ask === "bad" || method !== "GET") return { kind: "bad" }',
    to: '  if (ask === "bad" || method !== "GET") return { kind: "other" }',
    command: unit,
    expect: "an offer's read is a GET the wire accepts",
  },
  {
    name: "a refusal is cached",
    file: "apps/pineta/host/reviews.ts",
    from: '          "cache-control": "no-store",',
    to: '          "cache-control": "private, max-age=31536000, immutable",',
    command: unit,
    expect: "a refusal is never stored",
  },
]
