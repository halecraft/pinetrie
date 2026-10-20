// web/presence — how people are drawn, you included.
//
// A person's colour is kept apart from the branch palette (`palette.ts`): a
// ring or an avatar must never read as a track. The first few people in a
// session get colours far from each other and from the tracks; the rest, a hue
// from their writer id. A person's circle shows their picture when they have
// set one, over their initial in their colour.

import {
  blobUrl,
  messageWriters,
  type Sha256,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { displayName, stringHash } from "@pinetrie/interface"
import { type CSSProperties, useContext, useState } from "react"
import { Pictures } from "./pictures-context.ts"

/**
 * The first people's colours, the stylesheet's `--person-1` to `--person-3`.
 * A ring also has a gap in the page's colour between it and the dot (`Rail`),
 * so it reads against a track of any colour.
 */
const FIRST_COLORS = [1, 2, 3].map(n => `var(--person-${n})`)

/** A colour from a writer's id: its hue, at the saturation and lightness of the stylesheet's `--person-tone`. */
const hashed = (writer: WriterId): string =>
  `hsl(from var(--person-tone) ${stringHash(writer) % 360} s l)`

/**
 * Writers in the order they joined: by their first message in the session
 * (`messageWriters`), then those who have only named themselves, by id. Every
 * window reads the same document, so every window gives each person the same
 * colour.
 */
export function writerOrder(
  index: TreeIndex,
  named: Iterable<WriterId>,
): readonly WriterId[] {
  const wrote = messageWriters(
    index,
    Object.values(index.entries).map(e => e.id),
  )
  const rest = [...named].filter(w => !wrote.includes(w)).sort()
  return [...wrote, ...rest]
}

/** Each writer's colour: one of `FIRST_COLORS` by `order`, else from their id. */
export function presenceColors(
  order: readonly WriterId[],
): (writer: WriterId) => string {
  const slot = new Map(order.map((w, i) => [w, i]))
  return writer => {
    const i = slot.get(writer)
    return (i === undefined ? undefined : FIRST_COLORS[i]) ?? hashed(writer)
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

/**
 * A writer's circle: their initial, in their colour, and over it their
 * picture when they have one. The initial stays beneath, so a picture still
 * loading, or one that fails, shows it.
 */
export function Initial({
  writer,
  nameOf,
  colorOf,
  className,
}: CircleProps & { className: string }) {
  const picture = useContext(Pictures).get(writer)
  // The picture that failed to load: a new one is tried afresh.
  const [failed, setFailed] = useState<Sha256 | null>(null)
  return (
    <span
      className={`initial ${className}`}
      data-writer={writer}
      style={{ "--fill": colorOf(writer) } as CSSProperties}
    >
      {nameFor(nameOf, writer).slice(0, 1).toUpperCase()}
      {picture !== undefined && picture !== failed && (
        <img
          alt=""
          decoding="async"
          onError={() => setFailed(picture)}
          src={blobUrl(picture)}
        />
      )}
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
