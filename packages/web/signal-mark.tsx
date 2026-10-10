// web/signal-mark — a signal's mark (ADR-0126): today the unsent signal, a
// card of yours holding text (ADR-0048, step 2), on a tab, a rail dot or an
// Archive row (`unsentSignals`). One element, so the browser suite finds every
// mark by `.signal[data-signal]`.

/** A small dot in your colour, which your avatar uses. */
export function SignalMark({ color }: { color: string }) {
  return (
    <span
      aria-label="your unsent card"
      className="signal"
      data-signal="unsent"
      role="img"
      style={{ background: color }}
      title="your unsent card is here"
    />
  )
}
