// client/names — how a speaker, and a message in a label, are shown.
//
// A message keeps the name its writer had when they sent it: that is what the
// agent read, and rewriting it on a rename would change history the agent has
// already seen, and the provider's prompt cache with it. The screen shows who
// that person is NOW, with the name they sent it under when it differs, so a
// message sent before someone named themselves does not read as a stranger's.

/**
 * A draft written together names its sender, then the others who wrote it
 * (ADR-0025): "Ada, with Bea". Each by their current name.
 */
export const withContributors = (speaker: string, others: readonly string[]) =>
  others.length === 0 ? speaker : `${speaker}, with ${others.join(", ")}`

/** "Duane (guest-x4bu)" when the name has changed since; "Duane" when it has not. */
export function speakerLabel(
  current: ReadonlyMap<string, string>,
  writer: string | undefined,
  asSent: string,
): string {
  const now = writer === undefined ? undefined : current.get(writer)
  return now === undefined || now === asSent ? asSent : `${now} (${asSent})`
}

/**
 * A message as a label: its first non-empty line, cut to `max` characters
 * with "…" when longer. Tabs, fork labels, and the header's menus use it.
 */
export function firstLine(text: string, max: number): string {
  const line =
    text
      .split("\n")
      .map(l => l.trim())
      .find(l => l !== "") ?? ""
  return line.length > max ? `${line.slice(0, max)}…` : line
}
