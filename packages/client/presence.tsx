// client/presence — how other people are drawn (ADR-0024).
//
// A person's colour is kept apart from the branch palette (`rail.tsx`): a ring
// or an avatar must never read as a track. The first few people in a session
// get colours far from each other and from the tracks; the rest, a hue from
// their writer id.

import type { TreeIndex, WriterId } from "@pineta/core"
import { displayName } from "@pineta/marginalia"

/**
 * The first people's colours: magenta, white and yellow, far apart, and apart
 * from the tracks' blues and greens. A ring also has a dark gap between it and
 * the dot (`Rail`), so it reads against a track of any colour.
 */
const FIRST = ["#ff4fd8", "#ffffff", "#ffe030"]

/** A colour from a writer's id, at a saturation the tracks don't use. */
function hashed(writer: WriterId): string {
  let h = 0
  for (let i = 0; i < writer.length; i += 1)
    h = (Math.imul(h, 31) + writer.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 45% 62%)`
}

/**
 * Writers in the order they joined: by their first message (entry ids are
 * uuidv7, so id order is creation order), then those who have only named
 * themselves, by id. Every window reads the same document, so every window
 * gives each person the same colour. Pure.
 */
export function writerOrder(
  index: TreeIndex,
  named: Iterable<WriterId>,
): readonly WriterId[] {
  const out: WriterId[] = []
  for (const id of Object.keys(index.entries).sort()) {
    const w = index.entries[id]?.message?.writer
    if (w !== undefined && !out.includes(w)) out.push(w)
  }
  const rest = [...named].filter(w => !out.includes(w)).sort()
  return [...out, ...rest]
}

/** Each writer's colour: one of `FIRST` by `order`, else from their id. Pure. */
export function presenceColors(
  order: readonly WriterId[],
): (writer: WriterId) => string {
  const slot = new Map(order.map((w, i) => [w, i]))
  return writer => {
    const i = slot.get(writer)
    return (i === undefined ? undefined : FIRST[i]) ?? hashed(writer)
  }
}

/** A writer's name as the screen shows it: the one they set, or `guest-…`. */
export const nameFor = (
  nameOf: ReadonlyMap<WriterId, string>,
  writer: WriterId,
): string => displayName(writer, nameOf.get(writer))

/** The most avatars a header shows; the rest are "+n". */
const MOST = 3

/** Small circles, each a person's initial in their colour; names on hover. */
export function Avatars({
  writers,
  nameOf,
  colorOf,
}: {
  writers: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
}) {
  if (writers.length === 0) return null
  const shown = writers.slice(0, MOST)
  const rest = writers.length - shown.length
  return (
    <span
      className="avatars"
      title={`also here: ${writers.map(w => nameFor(nameOf, w)).join(", ")}`}
    >
      {shown.map(w => (
        <span
          className="avatar"
          data-writer={w}
          key={w}
          style={{ background: colorOf(w) }}
        >
          {nameFor(nameOf, w).slice(0, 1).toUpperCase()}
        </span>
      ))}
      {rest > 0 && <span className="avatar more">+{rest}</span>}
    </span>
  )
}
