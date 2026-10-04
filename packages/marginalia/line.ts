// line — the integration line and a thread's base on it (ADR-0060,
// ADR-0061): the line's record from what the host read (`planLineRecord`),
// a `line` command (`planLineAction`), the base a thread follows
// (`effectiveBase`), and what catching up with it would do (`catchUpOf`).
// A `line` command's steps are `@pineta/repo`'s (`lineSteps`).

import {
  type BaseRecord,
  type CommitId,
  ERR,
  type LineAction,
  type LineDecision,
  type LineFacts,
  type LineRecord,
  type ThreadBase,
} from "@pineta/core"

/**
 * The line's record, the page's cache, from what the host read of it
 * (ADR-0060): what setting it up would write to your repo's config
 * (`proposed`, `lineProposal`), and whether this host takes `line`
 * commands.
 */
export function planLineRecord(input: {
  readonly facts: LineFacts
  /** The line's bookmark, and the prefix that makes a bookmark a WIP. */
  readonly line: { readonly onto: string; readonly wipPrefix: string }
  readonly proposed: { readonly heads: string; readonly log: string }
  readonly commands: boolean
}): LineRecord {
  const { facts, line, proposed } = input
  return {
    onto: line.onto,
    wipPrefix: line.wipPrefix,
    commit: facts.commit,
    heads: { current: facts.heads, proposed: proposed.heads },
    log: { current: facts.log, proposed: proposed.log },
    wips: facts.wips,
    yours: facts.yours,
    commands: input.commands,
  }
}

/**
 * A `line` command, decided from the record read in its own step: refused
 * on a host that admits others (it acts on the repo as its owner), refused
 * when there is nothing to do. Setting up writes exactly the immutable heads
 * and log the record proposed, the text you were shown.
 */
export function planLineAction(
  action: LineAction,
  record: LineRecord,
): LineDecision {
  const { onto } = record
  if (!record.commands) return { kind: "refused", code: ERR.NOT_YOURS }
  switch (action) {
    case "setup":
      return record.commit !== null
        ? { kind: "refused", code: ERR.REFUSED }
        : {
            kind: "setup",
            onto,
            heads: record.heads.proposed,
            log: record.log.proposed,
          }
    case "land":
      if (record.commit === null) return { kind: "refused", code: ERR.NO_LINE }
      return record.yours.ahead === null || record.yours.ahead === 0
        ? { kind: "refused", code: ERR.REFUSED }
        : { kind: "land", onto }
    case "follow":
      // Only with a preview: it is what you were shown before you chose it.
      if (record.commit === null) return { kind: "refused", code: ERR.NO_LINE }
      return record.yours.follow === null
        ? { kind: "refused", code: ERR.REFUSED }
        : { kind: "follow", onto }
  }
}

/**
 * The base a thread is brought up to date with and taken to (ADR-0060): its
 * WIP while the WIP is there, else the line: for a line thread, a WIP that
 * landed, and one gone (which only "continue on the line" moves). Null, the
 * lane's base not yet read, is the line.
 */
export const effectiveBase = (
  base: Pick<BaseRecord, "base" | "state"> | null,
): ThreadBase =>
  base?.base.kind === "wip" && base.state === "ok"
    ? base.base
    : { kind: "line" }

/** Where a thread's base moved since its lane last took from it (`baseMoved`). */
export interface BaseMove {
  readonly base: ThreadBase
  /** The base's bookmark: the line's, or the WIP's. */
  readonly bookmark: string
  /** The commit the lane's newest `Pineta-Base` names, and the base's now. */
  readonly from: CommitId
  readonly to: CommitId
}

/**
 * How a thread's base has moved on since its lane last forked from it or
 * caught up (ADR-0060), or null: the commit its newest `Pineta-Base` names
 * (`start`) against where the base is now, the line's commit or the WIP's.
 * Never for a WIP gone, which only "continue on the line" moves, nor before
 * the line is set up. Commits only: whether catching up would change a file
 * is `catchUpOf`'s.
 */
function baseMoved(
  base: BaseRecord | undefined,
  line: LineRecord | null,
): BaseMove | null {
  if (base === undefined || line === null || line.commit === null) return null
  if (base.state === "gone") return null
  const thread = effectiveBase(base)
  const now =
    thread.kind === "line"
      ? { bookmark: line.onto, commit: line.commit }
      : line.wips.find(w => w.bookmark === thread.bookmark)
  return now === undefined || now.commit === base.start
    ? null
    : { base: thread, bookmark: now.bookmark, from: base.start, to: now.commit }
}

/**
 * What catching up would do to a thread, as the page can tell (S97):
 * - `current`: its base has not moved since the lane last took from it;
 * - `unknown`: it moved, and the host has not yet read what that changes;
 * - `nothing-new`: it moved, but by work the lane already holds, as after
 *   you took its own offer: catching up changes no file;
 * - `brings`: catching up changes `files` files in the lane.
 */
export type CatchUpNow =
  | { readonly kind: "current" }
  | { readonly kind: "unknown"; readonly move: BaseMove }
  | { readonly kind: "nothing-new"; readonly move: BaseMove }
  | {
      readonly kind: "brings"
      readonly move: BaseMove
      readonly files: number
    }

/**
 * `CatchUpNow` from the lane's base record and the line's: the host's read
 * (`BaseRecord.catchUp`) counts only when it was made at the commit the base
 * is at now; else what it would change is unknown.
 */
export function catchUpOf(
  base: BaseRecord | undefined,
  line: LineRecord | null,
): CatchUpNow {
  const move = baseMoved(base, line)
  if (move === null) return { kind: "current" }
  const read = base?.catchUp
  if (read === undefined || read === null || read.to !== move.to)
    return { kind: "unknown", move }
  return read.files.length === 0
    ? { kind: "nothing-new", move }
    : { kind: "brings", move, files: read.files.length }
}
