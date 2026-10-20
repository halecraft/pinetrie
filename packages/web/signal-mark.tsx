// web/signal-mark — a signal's mark: every signal, the unsent pip in your
// colour on a tab, a rail dot or ▦, and a status's before a canvas's label. One
// element, so the browser suite finds every mark by `.signal[data-signal]`, and
// `signalWords` words each.

import { moving, type Signal, signalWords } from "@pinetrie/interface"

/**
 * `signal`'s mark: unsent in `color`, your colour; done is a ✓ that fades.
 * `arrived` is when a needs-you arrived as you watched: it pulses only as it
 * mounts fresh. `title` says more than the signal's own words, where there
 * is more to say.
 */
export function SignalMark({
  signal,
  color,
  arrived = null,
  title,
  quiet = false,
}: {
  signal: Signal
  color?: string
  arrived?: number | null
  title?: string
  /** A status not raised for you (`Status.raised`): drawn grey. */
  quiet?: boolean
}) {
  const words = signalWords(signal)
  return (
    <span
      aria-label={words}
      className="signal"
      data-arrived={moving(arrived, Date.now()) ? "" : undefined}
      data-quiet={quiet ? "" : undefined}
      data-signal={signal}
      // A new arrival is a new element, so its pulse plays again.
      key={arrived ?? "still"}
      role="img"
      style={color === undefined ? undefined : { background: color }}
      title={title ?? words}
    >
      {signal === "done" ? "✓" : null}
    </span>
  )
}
