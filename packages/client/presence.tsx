// client/presence — how other people are drawn (ADR-0024).
//
// A person's colour is derived from their writer id, and kept apart from the
// branch palette (`rail.tsx`): a ring or an avatar must never read as a track.

import type { WriterId } from "@pineta/core"
import { displayName } from "@pineta/marginalia"

/** A writer's colour: a hue from their id, at a saturation branches don't use. Pure. */
export function presenceColor(writer: WriterId): string {
  let h = 0
  for (let i = 0; i < writer.length; i += 1)
    h = (Math.imul(h, 31) + writer.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 45% 62%)`
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
}: {
  writers: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
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
          style={{ background: presenceColor(w) }}
        >
          {nameFor(nameOf, w).slice(0, 1).toUpperCase()}
        </span>
      ))}
      {rest > 0 && <span className="avatar more">+{rest}</span>}
    </span>
  )
}
