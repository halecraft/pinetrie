// specs — every host record's spec (ADR-0062), in one list: what a check
// over every record reads, as a migration's verification does (ADR-0096).

import { BANNER } from "./banner.ts"
import { BOARD, WORKFLOW } from "./board.ts"
import { CARD_HISTORY, TRACE } from "./card-history.ts"
import { COMMANDS } from "./commands.ts"
import { DIGEST } from "./digest.ts"
import { BASE, LINE } from "./line.ts"
import { MARK } from "./mark.ts"
import { NAME } from "./names.ts"
import { OFFER } from "./offer.ts"
import { PARTICIPANT } from "./participant.ts"
import { QUEUE_HOLD } from "./queue-hold.ts"
import type { RecordSpec } from "./records.ts"
import { ROOT } from "./roots.ts"
import { SEAT } from "./seat.ts"
import { STOP } from "./stop.ts"
import { VERDICT } from "./verdict.ts"
import { LANE, PROJECT, REVISION } from "./work.ts"

/** What a check over every record reads of a spec: its address and its decoder. */
export type AnyRecordSpec = Pick<
  RecordSpec<unknown, string>,
  "namespace" | "home" | "decode"
>

/** Every record's spec. */
export const RECORD_SPECS: readonly AnyRecordSpec[] = [
  BANNER,
  BASE,
  BOARD,
  CARD_HISTORY,
  COMMANDS,
  DIGEST,
  LANE,
  LINE,
  MARK,
  NAME,
  OFFER,
  PARTICIPANT,
  PROJECT,
  QUEUE_HOLD,
  REVISION,
  ROOT,
  SEAT,
  STOP,
  TRACE,
  VERDICT,
  WORKFLOW,
]
