// lanehost/mountinfo — the mount holding a directory, read from
// `/proc/self/mountinfo`'s text. Docker's check of the lanes directory and
// the disks role's sample both find their filesystem here.

/** A mount, as `/proc/self/mountinfo` lists it. */
export interface Mount {
  /** Where it is mounted. */
  readonly point: string
  /** Its filesystem's type: `btrfs`, `overlay`, … */
  readonly fs: string
  /** What it was mounted from: a device's path, for a disk. */
  readonly source: string
  /** The filesystem's own options (`user_subvol_rm_allowed`, …), not the mount's. */
  readonly options: readonly string[]
}

/** mountinfo escapes a space, a tab, a newline and a backslash in octal. */
const unescapeField = (field: string): string =>
  field.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  )

/**
 * The mount holding `dir`: the one whose point is the longest prefix of it,
 * the last listed among equals, since a later mount over the same point
 * hides the earlier. Null when no line holds it.
 */
export function holdingMount(mountinfo: string, dir: string): Mount | null {
  let best: Mount | null = null
  for (const line of mountinfo.split("\n")) {
    const [left, right] = line.split(" - ")
    if (left === undefined || right === undefined) continue
    const point = unescapeField(left.split(" ")[4] ?? "")
    const [fs = "", source = "", options = ""] = right.split(" ")
    const holds = point === "/" || dir === point || dir.startsWith(`${point}/`)
    if (holds && (best === null || point.length >= best.point.length))
      best = {
        point,
        fs,
        source: unescapeField(source),
        options: options.split(","),
      }
  }
  return best
}
