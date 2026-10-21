// host/migrations/0029-stream-statement — the live document's stream row
// gains `statement`, the statement of a `bash` call whose output a tool
// stream holds. A starting host closes every stream before it reads one
// (`planClear`), so no row written before it is ever read, and no data
// moves: registering it accepts the new hash.

import type { Migration } from "./index.ts"

export const STREAM_STATEMENT: Migration = {
  name: "0029-stream-statement",
  kind: "live",
  from: "028e3f891b8953894c3667be8ca55a5946",
}
