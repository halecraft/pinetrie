// put-images — new images put in a media column, and a new version of one.

import {
  type CardRecord,
  type ImageId,
  type ImageRef,
  type ImagesTarget,
  type Intent,
  isMediaId,
  type MediaId,
  makeCard,
  type Sha256,
  type ThreadId,
  type TitledCardId,
  type WriterId,
} from "@pinetrie/core"
import { NEW_MEDIA_TITLE } from "./canvas.ts"
import { cardsOnCanvas } from "./canvas-index.ts"
import type { CardTitleRecord } from "./card-title.ts"
import type { MintContainer } from "./containers.ts"
import { rankInColumn } from "./media.ts"
import { type MovesStep, planMoveTargets } from "./moves.ts"
import {
  afterSteps,
  type MoveStep,
  type PlaceStep,
  planMake,
} from "./place-steps.ts"

/** An image a put makes: its id and its first version's blobs. */
export interface NewImage {
  readonly card: ImageId
  readonly image: VersionBlobs
}

/** A version's blobs: the copy drawn, and the image as it came. */
export type VersionBlobs = ImageRef & { readonly original: Sha256 }

/**
 * New images, as one step of their sender's history: to a spot on a canvas,
 * the first resolved as any card dropped there (`planMoveTargets`), which
 * makes a media column for it (`WRAPS`), the rest after it in that column; or
 * to a spot among a media column's images, in their order. Each is made through `planMake`, its one version
 * added by `sender` at `now`. Refused `no-place` for a column that is
 * trashed or has no record, and as a make would be.
 */
export function planPutImages(input: {
  readonly cards: readonly CardRecord[]
  readonly images: readonly NewImage[]
  readonly to: ImagesTarget
  readonly sender: WriterId
  readonly now: number
  readonly newContainer: MintContainer
}): MovesStep {
  const [first] = input.images
  if (first === undefined) return { kind: "steps", steps: [] }
  const steps: PlaceStep[] = []
  // Where the images go: a spot among a column's, or a media column made at
  // a spot on a canvas, at its end.
  let column: MediaId
  let before: ImageId | null
  let now = input.cards
  if (input.to.kind === "canvas-at") {
    const resolved = planMoveTargets({
      cards: input.cards,
      moves: [{ card: first.card, from: null, to: input.to }],
      sender: input.sender,
      newContainer: input.newContainer,
      entryThreads: new Map(),
    })
    if (resolved.kind === "refused") return resolved
    const to = resolved.moves[0]?.to
    if (to?.kind !== "image")
      return { kind: "refused", code: "no-place", now: null }
    steps.push(...resolved.first)
    column = to.column
    before = null
    now = resolved.cards
  } else {
    const { to } = input
    const held = input.cards.find(c => c.id === to.column)
    if (held === undefined || held.place.kind === "trash")
      return { kind: "refused", code: "no-place", now: null }
    column = to.column
    before = to.before
  }
  // Each just before the same image, so they keep their order.
  for (const image of input.images) {
    const ranked = rankInColumn(now, image.card, column, before)
    const respaced = ranked.respaced.map(
      (record): PlaceStep => ({ kind: "write", record }),
    )
    now = afterSteps(now, respaced)
    const made = planMake(
      now,
      makeCard(
        "image",
        image.card,
        { kind: "image", column, order: ranked.order },
        {
          versions: [{ ...image.image, by: input.sender, at: input.now }],
        },
        input.sender,
      ),
      input.sender,
    )
    if (made.kind === "refused") return made
    steps.push(...respaced, made)
    now = afterSteps(now, [made])
  }
  return { kind: "steps", steps }
}

/**
 * A new version of `image`, `version`, added by `sender` at `now`, after its
 * others: none is removed, so an older one brought back is added again.
 * Refused `gone` for an image that is trashed or has no record.
 */
export function planVersion(input: {
  readonly cards: readonly CardRecord[]
  readonly image: ImageId
  readonly version: VersionBlobs
  readonly sender: WriterId
  readonly now: number
}): MoveStep {
  const card = input.cards.find(c => c.id === input.image)
  if (card?.kind !== "image" || card.place.kind === "trash")
    return { kind: "refused", code: "gone", now: card ?? null }
  return {
    kind: "write",
    record: {
      ...card,
      content: {
        versions: [
          ...card.content.versions,
          { ...input.version, by: input.sender, at: input.now },
        ],
      },
    },
  }
}

/**
 * What `put_image` asks: a stored image, by its original's blob and the
 * file's name; its title; and where it goes.
 */
export interface PutImageAsk {
  readonly sha256: Sha256
  readonly name: string
  /** Its title; null for the file's name. */
  readonly title: string | null
  /**
   * A media column of the thread's canvas, by its title or its id: a new one
   * titled so at the canvas's end when none is; null for a new, untitled one.
   */
  readonly column: string | null
  /** An image of the thread's canvas, by its id: the put is a new version of it. */
  readonly onto: string | null
}

/** What the host does for a `put_image` ask, or why it does nothing. */
export type ImageAskPlan =
  | {
      readonly kind: "put"
      readonly intent: Extract<Intent, { kind: "put-images" }>
      /** The title of the media column the put makes; null for none, or one that exists. */
      readonly columnTitle: string | null
    }
  | {
      readonly kind: "version"
      readonly intent: Extract<Intent, { kind: "version" }>
    }
  | { readonly kind: "refused"; readonly text: string }

/**
 * A `put_image` ask as a command for the thread's person: into the media
 * column it names on the thread's canvas (by id, else by title, case and
 * spaces aside), a new one at the canvas's end when none is, or a version of
 * the image it names there. Refused for a thread on no canvas, or an image
 * or a column named by id that is not on its canvas.
 */
export function planImageAsk(input: {
  readonly ask: PutImageAsk
  readonly thread: ThreadId
  readonly cards: readonly CardRecord[]
  readonly titles: ReadonlyMap<TitledCardId, CardTitleRecord>
  /** The new image's id, minted by the host. */
  readonly card: ImageId
}): ImageAskPlan {
  const { ask, cards } = input
  const own = cards.find(c => c.id === input.thread)
  if (own?.place.kind !== "canvas")
    return { kind: "refused", text: "This thread is on no canvas." }
  const canvas = own.place.canvas
  const here = cardsOnCanvas(cards, canvas)
  if (ask.onto !== null) {
    const onto = ask.onto.trim()
    const image = cards.find(c => c.id === onto)
    const column =
      image?.kind === "image" && image.place.kind === "image"
        ? image.place.column
        : null
    return image?.kind !== "image" ||
      column === null ||
      !here.some(c => c.id === column)
      ? {
          kind: "refused",
          text: `No image on this canvas is ${onto}.`,
        }
      : {
          kind: "version",
          intent: { kind: "version", image: image.id, sha256: ask.sha256 },
        }
  }
  const images = [
    { card: input.card, sha256: ask.sha256, name: ask.title ?? ask.name },
  ]
  const wanted = ask.column?.trim() ?? ""
  const columns = here.filter(c => c.kind === "media")
  const byId = isMediaId(wanted)
    ? columns.find(c => c.id === wanted)
    : undefined
  if (isMediaId(wanted) && byId === undefined)
    return {
      kind: "refused",
      text: `No media column on this canvas is ${wanted}.`,
    }
  const same = (a: string, b: string) =>
    a.trim().toLowerCase() === b.trim().toLowerCase()
  const byTitle =
    wanted === ""
      ? undefined
      : columns.find(c =>
          same(input.titles.get(c.id)?.title ?? NEW_MEDIA_TITLE, wanted),
        )
  const found = byId ?? byTitle
  if (found !== undefined)
    return {
      kind: "put",
      intent: {
        kind: "put-images",
        images,
        to: { kind: "image-at", column: found.id, before: null },
        made: null,
      },
      columnTitle: null,
    }
  return {
    kind: "put",
    intent: {
      kind: "put-images",
      images,
      to: { kind: "canvas-at", canvas, after: here.at(-1)?.id ?? null },
      made: null,
    },
    columnTitle: wanted === "" ? null : wanted,
  }
}
