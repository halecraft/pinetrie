// pi/diagnostics — a reply's report of the thinking Anthropic dropped, kept
// as a count.
//
// pi-ai stores Anthropic's `input_transformations` on each reply as an
// `anthropic_input_transformations` diagnostic, a list of every earlier
// thinking block the request dropped. The dropped blocks are sent again on
// every later request, so every later reply would store the whole list again.
// The count keeps what the list was read for: a reply whose count rose over
// the reply before it on its branch is where the lane's prefix changed. Over
// raw JSON, so the `after_response` hook (`agent.ts`) and the host's
// migration of stored replies share it. No provider is sent a reply's
// diagnostics, so changing them moves no prefix.

/** The diagnostic whose `details` this counts. */
const DROPPED = "anthropic_input_transformations"

type Raw = Readonly<Record<string, unknown>>

const isRaw = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A diagnostic with its list counted; the same value for any other, or one counted already. */
function countedDiagnostic(diagnostic: unknown): unknown {
  if (!isRaw(diagnostic) || diagnostic.type !== DROPPED) return diagnostic
  const details = diagnostic.details
  if (!isRaw(details) || !Array.isArray(details.transformations))
    return diagnostic
  return {
    ...diagnostic,
    details: { dropped: details.transformations.length },
  }
}

/**
 * A reply's `diagnostics` with each dropped-thinking list replaced by its
 * count (`{ dropped: n }`), any other diagnostic as it is; the same value when
 * nothing changes, so a caller can tell. A counted list stays as it is.
 */
export function countedDiagnostics(diagnostics: unknown): unknown {
  if (!Array.isArray(diagnostics)) return diagnostics
  const counted = diagnostics.map(countedDiagnostic)
  return counted.every((d, i) => d === diagnostics[i]) ? diagnostics : counted
}
