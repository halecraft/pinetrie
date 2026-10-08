// Mutations for @pinetrie/schema. Run: pnpm mutate scripts/mutations/schema.ts
import type { Mutation } from "../mutate.ts"

const unit = ["pnpm", "exec", "vitest", "run", "packages/schema"]
const live = "packages/schema/live.ts"
const piLayout = "packages/schema/pi-layout.ts"
const storage = "packages/schema/storage.ts"

export const mutations: readonly Mutation[] = [
  {
    name: "closing a stream leaves its record",
    file: live,
    from: "          d.streams.delete(op.id)",
    to: "          void op.id",
    command: unit,
    expect: "close deletes a stream's record and its text",
  },
  {
    name: "ending a run keeps the lane's key",
    file: live,
    from: "          d.activeRuns.delete(op.lane)",
    to: "          void op.lane",
    command: unit,
    expect: "begin marks a lane running, and end deletes its key",
  },
  {
    name: "a stream's null tip is stored as a string",
    file: live,
    from: '    ? { lane: s.lane, kind: "reply", callId: null, under: s.under }',
    to: '    ? { lane: s.lane, kind: "reply", callId: null, under: s.under ?? "" }',
    command: unit,
    expect: "a reply and a tool round-trip, null fields included",
  },
  {
    name: "seatOf hashes the principal, not the seat",
    file: "packages/schema/text.ts",
    from: "    : { peer: peerId, clientId: yjsClientId(peerId), writer }",
    to: "    : { peer: peerId, clientId: yjsClientId(principal), writer }",
    command: unit,
    expect: "each seat's person",
  },
  {
    name: "seatOf gives the host a person",
    file: "packages/schema/text.ts",
    from: "  const writer = writerOfPrincipal(principal)\n  return writer === undefined\n",
    to: "  const writer = writerOfPrincipal(principal) ?? (principal as WriterId)\n  return writer === undefined\n",
    command: unit,
    expect: "seatOf",
  },
  {
    name: "textClients keeps Kyneta's seed clientID",
    file: "packages/schema/text.ts",
    from: "  return [...clients.keys()].filter(c => c !== 0)",
    to: "  return [...clients.keys()]",
    command: unit,
    expect: "textClients",
  },
  {
    name: "a presence key's writer runs to its last colon",
    file: "packages/schema/presence.ts",
    from: '  const at = key.indexOf(":")',
    to: '  const at = key.lastIndexOf(":")',
    command: [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "packages/schema",
      "packages/reads",
    ],
    expect: "before its first colon",
  },
  {
    name: "stored lane names are not checked",
    file: piLayout,
    from: '    if (isThreadId(key) && (value === null || typeof value === "string"))\n      lanes.push(key)\n    else malformed.push(key)',
    to: "    lanes.push(key as ThreadId)",
    command: unit,
    expect: "readStoredLanes gives a thread's lanes",
  },
  {
    name: "a lane whose tip is no entry id reads as one at the root",
    file: piLayout,
    from: '    if (isThreadId(key) && (value === null || typeof value === "string"))',
    to: "    if (isThreadId(key))",
    command: unit,
    expect: "readStoredLanes sets aside a lane whose tip is no entry id",
  },
  {
    name: "stored lanes come in the order they were stored",
    file: piLayout,
    from: "  return { lanes: lanes.toSorted(), malformed: malformed.toSorted() }",
    to: "  return { lanes, malformed }",
    command: unit,
    expect: "orders the rest by name",
  },
  {
    name: "a namespace's last delete leaves it",
    file: storage,
    from: "        if (held.keys().length === 0) d.records.delete(w.namespace)\n",
    to: "",
    command: unit,
    expect: "its last delete removes it",
  },
  {
    name: "every write to a namespace replaces it whole",
    file: storage,
    from: "        if (held === undefined) d.records.set(w.namespace, { [w.key]: w.value })\n        else held.set(w.key, w.value)",
    to: "        d.records.set(w.namespace, { [w.key]: w.value })",
    command: unit,
    expect: "later ones set a key",
  },
]
