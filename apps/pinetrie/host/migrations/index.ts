// host/migrations — a stored document's schema, checked before anything opens
// it, its data moved when the schema changed, and the one-time migrations a
// store has not run yet.
//
// A document opened under a changed schema keeps a dropped field's data only
// until the next compaction, and the host compacts at startup. So `startHost`
// reads the store once (`readStored`, and the ledger's names), `planStart`
// decides everything the start does to it, `prepareStore` deletes and
// records, and `migrate` runs what was planned before the first `get`. One
// migration per file here. A hash migration is deleted once Duane's store has
// passed it, and a store still on its hash is then refused; a one-time one
// leaves its name in `RETIRED_MIGRATIONS`, and a store that never ran it is
// refused.

import type { Exchange, Store } from "@kyneta/exchange"
import { PRODUCT_NAME } from "@pinetrie/core"
import { CONTROL_TOPIC } from "@pinetrie/protocol/messages"
import { lineDocPrefix } from "../lines.ts"
import { SCHEMA_OF, type StoredKind, storedKind } from "../policy.ts"
import type { OpenedStore } from "../store.ts"
import { REPLY_DIAGNOSTICS } from "./0001-reply-diagnostics.ts"
import { IMAGE_VERSIONS } from "./0002-image-versions.ts"
import { ONE_MARGIN } from "./0003-one-margin.ts"
import { CARD_TITLES } from "./0004-card-titles.ts"
import { acceptedWorkingCopy } from "./0005-accepted-working-copy.ts"
import { proposedWorkingCopyEdits } from "./0006-proposed-working-copy-edits.ts"
import { landMerged } from "./0007-land-merged.ts"
import { turnDiskPrivateMigration } from "./0008-turn-disk-private.ts"
import { accessAnswersMigration } from "./0009-access-answers.ts"
import { sshFactWordsMigration } from "./0010-ssh-fact-words.ts"
import { carryOnSshAllowedMigration } from "./0011-carry-on-ssh-allowed.ts"
import { baseGetLatest } from "./0012-base-get-latest.ts"
import { acceptedGetLatestMigration } from "./0013-accepted-get-latest.ts"
import { stateGetLatestMigration } from "./0014-state-get-latest.ts"
import { cardCommandGetLatestMigration } from "./0015-card-command-get-latest.ts"
import { baseUnfinishedMigration } from "./0016-base-unfinished.ts"
import { acceptedUnfinished } from "./0017-accepted-unfinished.ts"
import {
  behindUnfinished,
  factUnfinished,
  updateUnfinished,
} from "./0018-history-unfinished.ts"
import { queuedFactUnfinishedMigration } from "./0019-queued-fact-unfinished.ts"
import { allowanceRecords } from "./0020-allowance-records.ts"
import {
  answerAllowance,
  askCardAllowanceMigration,
  relayAllowance,
} from "./0021-relay-allowance.ts"
import {
  factAllowanceMigration,
  queuedFactAllowanceMigration,
} from "./0022-fact-allowance.ts"
import { incomingType } from "./0023-incoming.ts"
import {
  trashedHistories,
  trashedRows,
  trashedTraces,
} from "./0024-trashed-rows.ts"
import { runEndReportMigration } from "./0025-run-end-report.ts"
import { CARD_TICKED } from "./0026-card-ticked.ts"
import type { MigrationLedger } from "./ledger.ts"

/** What a migration reads with, and writes with once every read loaded. */
export interface MigrationRun {
  readonly exchange: Exchange
  readonly docIds: readonly string[]
  /**
   * Wait for a document the migration has got (`exchange.get`) to load. A
   * read-only open leaves its stored schema hash as it was; a record that fails
   * to load stops the migration before it writes.
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

/**
 * Every migration this build carries, oldest first. A store opens through
 * the one migration from its stored hash. Each one Duane's store ran was
 * deleted; restore one from the revision that deleted it for a store still
 * on its hash.
 */
export const MIGRATIONS: readonly Migration[] = [IMAGE_VERSIONS, CARD_TICKED]

/**
 * A one-time change to stored contents that keeps every schema's hash: a
 * record's contents, JSON in its document's `records`, or the values of the
 * places' rows, whose fields stay, so `planOpen` never schedules one. It runs
 * on a store whose ledger lacks its name, and must find nothing to write in
 * its own output: a host that dies before recording it runs it again.
 */
export interface RecordMigration {
  /** A name for the log, as its file's. */
  readonly name: string
  /**
   * Gather and plan, reading only: null when nothing it reads is in the old
   * shape, else the step that writes.
   */
  readonly run: (input: MigrationRun) => Promise<(() => Promise<void>) | null>
}

/** Every one-time record migration this build carries, oldest first. */
export const RECORD_MIGRATIONS: readonly RecordMigration[] = [
  REPLY_DIAGNOSTICS,
  ONE_MARGIN,
  CARD_TITLES,
  acceptedWorkingCopy,
  proposedWorkingCopyEdits,
  landMerged,
  turnDiskPrivateMigration,
  accessAnswersMigration,
  sshFactWordsMigration,
  carryOnSshAllowedMigration,
  baseGetLatest,
  acceptedGetLatestMigration,
  stateGetLatestMigration,
  cardCommandGetLatestMigration,
  baseUnfinishedMigration,
  acceptedUnfinished,
  updateUnfinished,
  behindUnfinished,
  factUnfinished,
  queuedFactUnfinishedMigration,
  allowanceRecords,
  relayAllowance,
  answerAllowance,
  askCardAllowanceMigration,
  factAllowanceMigration,
  queuedFactAllowanceMigration,
  incomingType,
  trashedRows,
  trashedHistories,
  trashedTraces,
  runEndReportMigration,
]

/**
 * A one-time deletion of stored documents no schema of ours opens, planned
 * before the check of stored schemas, which then does not see them. It runs on
 * a store whose ledger lacks its name.
 */
export interface StoreMigration {
  /** A name for the log, as its file's. */
  readonly name: string
  /** The stored ids it deletes, from every stored id: none once they are gone. */
  readonly doomed: (storedIds: readonly string[]) => readonly string[]
}

/** Every one-time store deletion this build carries, oldest first: none. */
export const STORE_MIGRATIONS: readonly StoreMigration[] = []

/**
 * The names of the one-time migrations deleted since the ledger began. A store
 * in use whose ledger lacks one never ran it, and is refused.
 */
export const RETIRED_MIGRATIONS: readonly string[] = []

/** The one-time migrations a build carries, and the names of those it deleted. */
export interface OneTimeRegistry {
  readonly store: readonly StoreMigration[]
  readonly records: readonly RecordMigration[]
  readonly retired: readonly string[]
}

export const ONE_TIME_MIGRATIONS: OneTimeRegistry = {
  store: STORE_MIGRATIONS,
  records: RECORD_MIGRATIONS,
  retired: RETIRED_MIGRATIONS,
}

/** The first name given twice; a ledger keys each migration by its name. */
export function migrationNameClash(names: readonly string[]): string | null {
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) return name
    seen.add(name)
  }
  return null
}

/** Every one-time name a registry holds, carried or retired. */
export const oneTimeNames = (registry: OneTimeRegistry): readonly string[] => [
  ...registry.store.map(m => m.name),
  ...registry.records.map(m => m.name),
  ...registry.retired,
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

/** A stored document whose schema hash no migration starts from. */
export interface HashRefusal {
  readonly docId: string
  readonly stored: string
  readonly expected: string
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
  | ({ readonly kind: "refuse" } & HashRefusal)

/**
 * Whether every stored document can open under this build's schemas, and the
 * migrations that get it there.
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

export type LedgerPlan =
  /** Nothing stored: every name is recorded, and nothing runs. */
  | { readonly kind: "new"; readonly record: readonly string[] }
  | {
      readonly kind: "due"
      readonly store: readonly StoreMigration[]
      readonly records: readonly RecordMigration[]
      /** Ledger names this build neither carries nor retired, sorted. */
      readonly unknown: readonly string[]
    }
  | { readonly kind: "refuse"; readonly missing: readonly string[] }

/** Which one-time migrations a store runs, from its ledger. */
export function planLedger(input: {
  /** Every stored id when the start began, before anything deleted one. */
  readonly storedIds: readonly string[]
  readonly ran: ReadonlySet<string>
  readonly registry: OneTimeRegistry
}): LedgerPlan {
  const { ran, registry } = input
  if (input.storedIds.length === 0)
    return { kind: "new", record: oneTimeNames(registry) }
  const missing = registry.retired.filter(name => !ran.has(name))
  if (missing.length > 0) return { kind: "refuse", missing }
  const known = new Set(oneTimeNames(registry))
  return {
    kind: "due",
    store: registry.store.filter(m => !ran.has(m.name)),
    records: registry.records.filter(m => !ran.has(m.name)),
    unknown: [...ran].filter(name => !known.has(name)).toSorted(),
  }
}

/** Why a starting host refuses its store. */
export type StartRefusal =
  | { readonly kind: "retired"; readonly missing: readonly string[] }
  | ({ readonly kind: "hash" } & HashRefusal)

export type StartPlan =
  | { readonly kind: "refuse"; readonly refusal: StartRefusal }
  | {
      readonly kind: "open"
      /** Names to record before anything else: a new store's. */
      readonly record: readonly string[]
      /** The stored command Lines. */
      readonly lines: readonly string[]
      /** Each due store migration, with the ids it deletes (maybe none). */
      readonly deletions: readonly {
        readonly migration: StoreMigration
        readonly ids: readonly string[]
      }[]
      /** The hash migrations' plan, over what is kept. */
      readonly open: Extract<OpenPlan, { kind: "open" }>
      readonly records: readonly RecordMigration[]
      /** Every stored id left once the deletions are done. */
      readonly kept: readonly string[]
      readonly unknownNames: readonly string[]
    }

/**
 * Everything a start does to its store, from one read of it: refuse it, or the
 * names to record, the documents to delete, and the migrations to run. Every
 * refusal comes before anything is deleted.
 */
export function planStart(input: {
  /** `readStored`'s, before anything is deleted. */
  readonly stored: ReadonlyMap<string, string>
  readonly ran: ReadonlySet<string>
  readonly registry: OneTimeRegistry
  readonly kindOf: (docId: string) => StoredKind | "kyneta" | undefined
  readonly hashOf: (kind: StoredKind) => string
  readonly migrations: readonly Migration[]
}): StartPlan {
  const ids = [...input.stored.keys()]
  const ledger = planLedger({
    storedIds: ids,
    ran: input.ran,
    registry: input.registry,
  })
  if (ledger.kind === "refuse")
    return {
      kind: "refuse",
      refusal: { kind: "retired", missing: ledger.missing },
    }
  const due =
    ledger.kind === "due" ? ledger : { store: [], records: [], unknown: [] }
  const linePrefix = lineDocPrefix(CONTROL_TOPIC)
  const lines = ids.filter(id => id.startsWith(linePrefix))
  // Each store migration sees what the ones before it left.
  let kept = ids.filter(id => !id.startsWith(linePrefix))
  const deletions = due.store.map(migration => {
    const doomed = migration.doomed(kept)
    const gone = new Set(doomed)
    kept = kept.filter(id => !gone.has(id))
    return { migration, ids: doomed }
  })
  const keptSet = new Set(kept)
  const open = planOpen({
    stored: new Map([...input.stored].filter(([id]) => keptSet.has(id))),
    kindOf: input.kindOf,
    hashOf: input.hashOf,
    migrations: input.migrations,
  })
  if (open.kind === "refuse")
    return { kind: "refuse", refusal: { ...open, kind: "hash" } }
  return {
    kind: "open",
    record: ledger.kind === "new" ? ledger.record : [],
    lines,
    deletions,
    open,
    records: due.records,
    kept,
    unknownNames: due.unknown,
  }
}

/** The start's plan under this build's schemas and migrations. */
export const planStoredStart = (
  stored: ReadonlyMap<string, string>,
  ran: ReadonlySet<string>,
): StartPlan =>
  planStart({
    stored,
    ran,
    registry: ONE_TIME_MIGRATIONS,
    kindOf: storedKind,
    hashOf: kind => SCHEMA_OF[kind].schemaHash,
    migrations: MIGRATIONS,
  })

/** A refusal, in the words the host stops with. */
export const refusalLine = (refusal: StartRefusal): string =>
  refusal.kind === "hash"
    ? `${PRODUCT_NAME} cannot open ${refusal.docId}: it was written under schema ${refusal.stored}, this build opens it under ${refusal.expected}, and no migration goes from one to the other. Restore the migration from the revision that deleted it, or run the build that wrote the store.`
    : `${PRODUCT_NAME} cannot open this store: it never ran ${refusal.missing.join(", ")}, which this build no longer carries. Restore each from the revision that deleted it, or run the build that last opened the store.`

/** The ledger's names this build does not know: a newer build ran them. */
export const unknownMigrationsLine = (names: readonly string[]): string =>
  `[host] migrations this build does not know, from a newer build: ${names.join(", ")}`

/**
 * Carry out the start's deletions, recording each step once it is in the
 * file: a new store's names first, then the command Lines, then each store
 * migration's documents and name. `Store.delete` commits before it resolves,
 * so a name recorded after it never outlives what it deleted. `backup` copies
 * a file store before the first migration that deletes anything.
 */
export async function prepareStore(
  opened: {
    readonly store: Pick<Store, "delete">
    readonly ledger: MigrationLedger
    readonly backup: OpenedStore["backup"]
  },
  plan: Extract<StartPlan, { kind: "open" }>,
  {
    now,
    log,
  }: { readonly now: () => number; readonly log: (line: string) => void },
): Promise<void> {
  const { store, ledger } = opened
  ledger.record(plan.record, now())
  if (plan.unknownNames.length > 0)
    log(unknownMigrationsLine(plan.unknownNames))
  // Every stored command Line belongs to a client seat that cannot return: a
  // client keeps no store and does not reconnect (host/lines.ts).
  for (const line of plan.lines) await store.delete(line)
  let backup = opened.backup
  for (const { migration, ids } of plan.deletions) {
    if (ids.length > 0) {
      if (backup !== null) {
        log(`[host] store copied to ${backup(migration.name)}`)
        backup = null
      }
      for (const id of ids) await store.delete(id)
      log(`[host] ${migration.name}: ${ids.length} document(s) deleted`)
    }
    ledger.record([migration.name], now())
  }
}

/** Kyneta's warning for a stored record it could not load. */
const LOAD_FAILURE =
  /^\[runtime\] stored entry at .* for doc '(.*)' could not be loaded/

/**
 * Run each planned migration on `exchange`, and each due record migration that
 * finds its old shape: every read first, then, if every stored record loaded,
 * every write; then record each record migration run, written or not, and
 * compact what they opened and let it go. A record that failed to load stops
 * this before anything is written or recorded, since compacting would lose it
 * for good.
 *
 * `backup` copies a file store, naming the copy for the first migration that
 * moves data; it is called only when one does, after the reads, which change
 * nothing stored.
 */
export async function migrate(input: {
  readonly plan: Extract<OpenPlan, { kind: "open" }>
  /** The due ones (`planStart`). */
  readonly records: readonly RecordMigration[]
  /** Every stored document's id: what a record migration may open. */
  readonly storedIds: readonly string[]
  readonly exchange: Exchange
  readonly opened: Pick<OpenedStore, "ledger" | "backup">
  readonly now: () => number
  readonly log: (line: string) => void
}): Promise<void> {
  const { plan, exchange, log } = input
  const { backup } = input.opened
  if (plan.unknown.length > 0)
    log(
      `[host] stored documents no schema opens, left alone: ${plan.unknown.join(", ")}`,
    )
  for (const { migration, docIds } of plan.run)
    if (migration.run === undefined)
      log(
        `[host] ${migration.name}: ${docIds.length} document(s), nothing to move`,
      )

  const failed: string[] = []
  const loaded = new Set<string>()
  const hydrated = async (docId: string) => {
    loaded.add(docId)
    await exchange.whenHydrated(docId)
  }
  const writes: {
    readonly name: string
    readonly docs: number | null
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
    for (const { migration, docIds } of plan.run)
      if (migration.run !== undefined)
        writes.push({
          name: migration.name,
          docs: docIds.length,
          write: await migration.run({ exchange, docIds, hydrated }),
        })
    for (const migration of input.records) {
      const write = await migration.run({
        exchange,
        docIds: input.storedIds,
        hydrated,
      })
      if (write !== null)
        writes.push({ name: migration.name, docs: null, write })
    }
  } finally {
    console.warn = warn
  }
  if (failed.length > 0)
    throw new Error(
      `${PRODUCT_NAME} stopped a migration before it wrote anything: stored records of ${[...new Set(failed)].join(", ")} could not be loaded, and compacting would lose them.`,
    )
  const first = writes[0]
  if (first !== undefined && backup !== null)
    log(`[host] store copied to ${backup(first.name)}`)
  for (const { name, docs, write } of writes) {
    await write()
    log(
      docs === null
        ? `[host] ${name}: records migrated`
        : `[host] ${name}: ${docs} document(s) migrated`,
    )
  }
  await exchange.flush()
  // A write is in the file only once the flush resolves: a name recorded
  // before it could outlive the write it stands for.
  input.opened.ledger.record(
    input.records.map(m => m.name),
    input.now(),
  )
  for (const docId of loaded) {
    await exchange.compact(docId)
    exchange.unload(docId)
  }
}
