// host/folder/record-writes — a folder operation's records (`FolderRecords`,
// decided in `@pinetrie/folder`) as the session's writes. The record specs
// are `@pinetrie/rules`', which the folder package does not declare, so this
// is the one place they become writes.

import type { ValueWrite } from "@pinetrie/core"
import type { FolderRecords } from "@pinetrie/folder"
import {
  CONFLICT,
  conflictKey,
  deleteRecord,
  STATE,
  setRecord,
} from "@pinetrie/rules"

/** `records` written: the states made, the conflicts opened, then those closed. */
export const recordWrites = (
  records: FolderRecords,
): ValueWrite<"session">[] => [
  ...records.states.map(r => setRecord(STATE, r)),
  ...records.conflicts.map(c => setRecord(CONFLICT, c)),
  ...records.closed.map(c =>
    deleteRecord(CONFLICT, conflictKey(c.lane, c.path)),
  ),
]
