// host/migrations/0010-reference-fields — the places' rows gain a
// reference's `address` and `quote`, and a text card's `origin` (ADR-0126).
// A field added moves the schema's hash and no data: a row stored before
// reads each as "" (a text card with no origin), and no stored card is a
// reference yet. Delete this file once Duane's store has run it.

import type { Migration } from "./index.ts"

export const referenceFields: Migration = {
  name: "0010-reference-fields",
  kind: "places",
  from: "021ae2a5ad2682f64c34c2b8aedac5133a",
}
