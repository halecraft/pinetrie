// web/sparkline — a series drawn: interface's `SeriesView`, its geometry
// web-core's `sparkPath`. The SVG stretches to its box, so its strokes keep
// their width (`vector-effect`), and a point alone is a round cap on a line
// of no length, which stretching cannot turn into an oval.

import type { SeriesView } from "@pinetrie/interface"
import { sparkPath } from "@pinetrie/web-core"

const WIDTH = 100
const HEIGHT = 32

export function Sparkline({
  series,
  label,
}: {
  series: SeriesView
  /** The graph in words: its role's name. */
  label: string
}) {
  const { runs, dots } = sparkPath(series.points, WIDTH, HEIGHT)
  const step =
    series.points.length <= 1 ? 0 : WIDTH / (series.points.length - 1)
  return (
    <svg
      aria-label={label}
      className="sparkline"
      data-points={series.points.filter(p => p !== null).length}
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      {series.contained.map((isContained, i) =>
        isContained ? (
          <path
            className="sparkline-contained"
            // biome-ignore lint/suspicious/noArrayIndexKey: a minute's place is its identity
            key={i}
            d={`M${i * step} ${HEIGHT}v-4`}
          />
        ) : null,
      )}
      {series.lines.map(at => (
        <path
          className="sparkline-bound"
          d={`M0 ${HEIGHT - at * HEIGHT}H${WIDTH}`}
          key={at}
        />
      ))}
      {runs.map(r => (
        <g key={r.d}>
          <path className="sparkline-fill" d={`${r.d}V${HEIGHT}H${r.from}Z`} />
          <path className="sparkline-line" d={r.d} />
        </g>
      ))}
      {dots.map(d => (
        <path
          className="sparkline-dot"
          d={`M${d.x} ${d.y}h0`}
          key={`${d.x}:${d.y}`}
        />
      ))}
    </svg>
  )
}
