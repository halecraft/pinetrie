// client/presence — how people are drawn, you included (ADR-0024).
//
// A person's colour is kept apart from the branch palette (`rail.tsx`): a ring
// or an avatar must never read as a track. The first few people in a session
// get colours far from each other and from the tracks; the rest, a hue from
// their writer id.

import { type TreeIndex, type WriterId, writersOf } from "@pinetrie/core"
import { displayName } from "@pinetrie/rules"

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
 * Writers in the order they joined: by their first message in the session
 * (`writersOf`), then those who have only named themselves, by id. Every
 * window reads the same document, so every window gives each person the same
 * colour. Pure.
 */
export function writerOrder(
  index: TreeIndex,
  named: Iterable<WriterId>,
): readonly WriterId[] {
  const wrote = writersOf(
    index,
    Object.values(index.entries).map(e => e.id),
  )
  const rest = [...named].filter(w => !wrote.includes(w)).sort()
  return [...wrote, ...rest]
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

/** A writer's name as the screen shows it: the one they set, or their email's part before the `@`. */
export const nameFor = (
  nameOf: ReadonlyMap<WriterId, string>,
  writer: WriterId,
): string => displayName(writer, nameOf.get(writer))

/** The most avatars a header shows; the rest are "+n". */
const MOST = 3

interface CircleProps {
  writer: WriterId
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
}

/** A writer's circle: their initial, in their colour. */
export function Initial({
  writer,
  nameOf,
  colorOf,
  className,
}: CircleProps & { className: string }) {
  return (
    <span
      className={`initial ${className}`}
      data-writer={writer}
      style={{ background: colorOf(writer) }}
    >
      {nameFor(nameOf, writer).slice(0, 1).toUpperCase()}
    </span>
  )
}

/**
 * A person shown here. The browser suite counts people by `.avatar`, so
 * nothing else is drawn with it: not you, not the agent, not "+n".
 */
export function Avatar(props: CircleProps) {
  return <Initial {...props} className="avatar" />
}

/** Several people's circles, the first few shown, then "+n"; names on hover. */
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
        <Avatar colorOf={colorOf} key={w} nameOf={nameOf} writer={w} />
      ))}
      {rest > 0 && <span className="initial more">+{rest}</span>}
    </span>
  )
}
