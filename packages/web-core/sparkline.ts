// web-core/sparkline — a series' geometry in an SVG's own units: the path
// through each run of points, and a dot for a point alone, so a host a
// minute old still draws. A point is 0 to 1 of the series' top, as
// interface's `seriesView` scales it; a null point is a minute with nothing
// read, and the line breaks there rather than joining across it.

/** A series drawn: a path for each run of two or more points, with its first x, and a dot for each point alone. */
interface SparkGeometry {
  readonly runs: readonly {
    readonly d: string
    readonly from: number
  }[]
  readonly dots: readonly { readonly x: number; readonly y: number }[]
}

export function sparkPath(
  points: readonly (number | null)[],
  width: number,
  height: number,
): SparkGeometry {
  const step = points.length <= 1 ? 0 : width / (points.length - 1)
  const at = (i: number, v: number) => ({
    x: Number((i * step).toFixed(2)),
    y: Number((height - v * height).toFixed(2)),
  })
  const runs: { x: number; y: number }[][] = []
  points.forEach((v, i) => {
    if (v === null) return
    const run = points[i - 1] === null || i === 0 ? null : runs.at(-1)
    if (run === null || run === undefined) runs.push([at(i, v)])
    else run.push(at(i, v))
  })
  return {
    runs: runs
      .filter(r => r.length > 1)
      .map(r => ({
        d: r.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(""),
        from: r[0]?.x ?? 0,
      })),
    dots: runs.filter(r => r.length === 1).flat(),
  }
}
