// host/migrations — a stored document's schema, checked before anything opens
// it, and its data moved when the schema changed (ADR-0096).
//
// A document opened under a changed schema keeps a dropped field's data only
// until the next compaction (S120), and the host compacts at startup. So
// `startHost` reads each stored document's schema hash first (`readStored`),
// `planOpen` decides, and `migrate` runs what it planned before the first
// `get`. One migration per file here; each is deleted once Duane's store has
// passed it, and a store still on its hash is then refused.

import type { Exchange, Store } from "@kyneta/exchange"
import { PRODUCT_NAME } from "@pinetrie/core"
import { SCHEMA_OF, type StoredKind, storedKind } from "../policy.ts"
import { liveRow } from "./0001-live-row.ts"
import { rootRecords, sessionRecords } from "./0002-records.ts"

/** What a migration reads with, and writes with once every read loaded. */
export interface MigrationRun {
  readonly exchange: Exchange
  readonly docIds: readonly string[]
  /**
   * Wait for a document the migration has got (`exchange.get`) to load. A
   * read-only open leaves its stored schema hash as it was (S120); a record
   * that fails to load stops the migration before it writes.
   */
  readonly hydrated: (docId: string) => Promise<void>
}

/** A change to one kind of document's schema, from one stored hash. */
export interface Migration {
  /** A name for the log, as its file's. */
  readonly name: string
  readonly kind: StoredKind
  /** The hash of the schema it migrates from, as Kyneta stored it. */
  readonly from: string
  /**
   * Gather and plan, reading only, and return the step that writes; absent
   * for a change that moves no data.
   */
  readonly run?: (input: MigrationRun) => Promise<() => Promise<void>>
}

/** Every migration this build carries, oldest first. */
export const MIGRATIONS: readonly Migration[] = [
  liveRow,
  sessionRecords,
  rootRecords,
]

/** Each stored document's id and the hash of the schema it was written under. */
export async function readStored(
  store: Pick<Store, "listDocIds" | "currentMeta">,
): Promise<ReadonlyMap<string, string>> {
  const out = new Map<string, string>()
  for await (const id of store.listDocIds()) {
    const meta = await store.currentMeta(id)
    if (meta !== null) out.set(id, meta.schemaHash)
  }
  return out
}

export type OpenPlan =
  | {
      readonly kind: "open"
      /** The migrations to run, in order, each with its documents. */
      readonly run: readonly {
        readonly migration: Migration
        readonly docIds: readonly string[]
      }[]
      /** Stored ids no schema of ours opens: reported, and left alone. */
      readonly unknown: readonly string[]
    }
  | {
      readonly kind: "refuse"
      readonly docId: string
      readonly stored: string
      readonly expected: string
    }

/**
 * Whether every stored document can open under this build's schemas, and
 * the migrations that get it there. Pure.
 */
export function planOpen(input: {
  readonly stored: ReadonlyMap<string, string>
  /** A document's kind; "kyneta" for one whose schema is Kyneta's to change. */
  readonly kindOf: (docId: string) => StoredKind | "kyneta" | undefined
  readonly hashOf: (kind: StoredKind) => string
  readonly migrations: readonly Migration[]
}): OpenPlan {
  const unknown: string[] = []
  const due = new Map<Migration, string[]>()
  for (const [docId, stored] of [...input.stored].toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const kind = input.kindOf(docId)
    if (kind === "kyneta") continue
    if (kind === undefined) {
      unknown.push(docId)
      continue
    }
    const expected = input.hashOf(kind)
    if (stored === expected) continue
    const migration = input.migrations.find(
      m => m.kind === kind && m.from === stored,
    )
    if (migration === undefined)
      return { kind: "refuse", docId, stored, expected }
    due.set(migration, [...(due.get(migration) ?? []), docId])
  }
  return {
    kind: "open",
    run: input.migrations.flatMap(migration => {
      const docIds = due.get(migration)
      return docIds === undefined ? [] : [{ migration, docIds }]
    }),
    unknown,
  }
}

/** The plan for this build's schemas and migrations. */
export const planStoredOpen = (stored: ReadonlyMap<string, string>): OpenPlan =>
  planOpen({
    stored,
    kindOf: storedKind,
    hashOf: kind => SCHEMA_OF[kind].schemaHash,
    migrations: MIGRATIONS,
  })

/** Why a starting host refuses its store. */
export const refusalLine = (
  plan: Extract<OpenPlan, { kind: "refuse" }>,
): string =>
  `${PRODUCT_NAME} cannot open ${plan.docId}: it was written under schema ${plan.stored}, this build opens it under ${plan.expected}, and no migration goes from one to the other. Restore the migration from the revision that deleted it, or run the build that wrote the store (ADR-0096).`

/** Kyneta's warning for a stored record it could not load. */
const LOAD_FAILURE =
  /^\[runtime\] stored entry at .* for doc '(.*)' could not be loaded/

/**
 * Run each planned migration on `exchange`: every read first, then, if every
 * stored record loaded, every write; then compact what they opened and let it
 * go. A record that failed to load stops this before anything is written,
 * since compacting would lose it for good (S120).
 *
 * `backup` copies a file store, naming the copy for the first migration that
 * moves data; it is called only when one does.
 */
export async function migrate(input: {
  readonly plan: Extract<OpenPlan, { kind: "open" }>
  readonly exchange: Exchange
  readonly backup: ((name: string) => string) | null
  readonly log: (line: string) => void
}): Promise<void> {
  const { plan, exchange, log } = input
  if (plan.unknown.length > 0)
    log(
      `[host] stored documents no schema opens, left alone: ${plan.unknown.join(", ")}`,
    )
  const moving = plan.run.filter(r => r.migration.run !== undefined)
  for (const { migration, docIds } of plan.run)
    if (migration.run === undefined)
      log(
        `[host] ${migration.name}: ${docIds.length} document(s), nothing to move`,
      )
  const first = moving[0]
  if (first === undefined) return
  if (input.backup !== null)
    log(`[host] store copied to ${input.backup(first.migration.name)}`)

  const failed: string[] = []
  const opened = new Set<string>()
  const writes: {
    readonly name: string
    readonly docs: number
    readonly write: () => Promise<void>
  }[] = []
  // Kyneta reports a record it could not load only as this warning.
  const warn = console.warn
  console.warn = (...args: unknown[]) => {
    const docId = LOAD_FAILURE.exec(String(args[0]))?.[1]
    if (docId !== undefined) failed.push(docId)
    warn(...args)
  }
  try {
    for (const { migration, docIds } of moving)
      if (migration.run !== undefined)
        writes.push({
          name: migration.name,
          docs: docIds.length,
          write: await migration.run({
            exchange,
            docIds,
            hydrated: async docId => {
              opened.add(docId)
              await exchange.whenHydrated(docId)
            },
          }),
        })
  } finally {
    console.warn = warn
  }
  if (failed.length > 0)
    throw new Error(
      `${PRODUCT_NAME} stopped a migration before it wrote anything: stored records of ${[...new Set(failed)].join(", ")} could not be loaded, and compacting would lose them.`,
    )
  for (const { name, docs, write } of writes) {
    await write()
    log(`[host] ${name}: ${docs} document(s) migrated`)
  }
  await exchange.flush()
  for (const docId of opened) {
    await exchange.compact(docId)
    exchange.unload(docId)
  }
}
