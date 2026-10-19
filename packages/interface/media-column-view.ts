// interface/media-column-view — media columns as the page draws them: each a
// title and its images in one order, each image its title, its versions and
// how many comments its margin holds. `MediaColumn`
// (`packages/web/media-column.tsx`) draws one on a canvas.

import {
  type CanvasId,
  type CardRecord,
  type ImageId,
  type ImageVersion,
  imageMargin,
  type MediaId,
  printAddress,
  type Sha256,
  type ThreadId,
  type TitledCardId,
} from "@pinetrie/core"
import {
  type CardTitleRecord,
  imagesIn,
  NEW_MEDIA_TITLE,
  UNTITLED_IMAGE,
} from "@pinetrie/rules"
import type { StartButton } from "./start-button.ts"

/** One image, as drawn. */
export interface ImageView {
  readonly image: ImageId
  /** Its title, or `UNTITLED_IMAGE` while it has none. */
  readonly title: string
  /** Its stored title, or null: what the rename field starts with. */
  readonly titled: string | null
  /** Its versions, oldest first; the newest is drawn. */
  readonly versions: readonly ImageVersion[]
  /** How many comments its margin holds. */
  readonly comments: number
}

/** One media column, as drawn. */
export interface MediaColumnView {
  readonly column: MediaId
  /** Its title, or `NEW_MEDIA_TITLE` while it has none. */
  readonly title: string
  /** Its stored title, or null. */
  readonly titled: string | null
  /** Its images, in order. */
  readonly images: readonly ImageView[]
}

/**
 * Every media column in `cards`, wherever it is (a canvas, an inventory, a
 * trash), each with its images; by id.
 */
export function mediaColumns(input: {
  readonly cards: readonly CardRecord[]
  readonly titles: ReadonlyMap<TitledCardId, CardTitleRecord>
  /** How many comments each margin holds, by what it is on, printed (`marginCounts`). */
  readonly margins: ReadonlyMap<string, number>
}): ReadonlyMap<MediaId, MediaColumnView> {
  const views = new Map<MediaId, MediaColumnView>()
  for (const c of input.cards) {
    if (c.kind !== "media") continue
    const titled = input.titles.get(c.id)?.title ?? null
    views.set(c.id, {
      column: c.id,
      title: titled ?? NEW_MEDIA_TITLE,
      titled,
      images: imagesIn(input.cards, c.id).map(i => {
        const own = input.titles.get(i.id)?.title ?? null
        return {
          image: i.id,
          title: own ?? UNTITLED_IMAGE,
          titled: own,
          versions: i.content.versions,
          comments: input.margins.get(printAddress(imageMargin(i.id))) ?? 0,
        }
      }),
    })
  }
  return views
}

/** Which version is drawn, of how many: "2 of 3". Null for an image with one. */
export const versionWords = (shown: number, of: number): string | null =>
  of <= 1 ? null : `${shown + 1} of ${of}`

/** A media column with none: where a drop puts one. */
export const MEDIA_EMPTY = "drop images here"

/**
 * Which version of an image a comment was written on, when a newer one is
 * drawn: "on version 2"; null for the newest, or a version no longer known.
 */
export function commentVersionWords(
  seen: string,
  versions: readonly ImageVersion[],
): string | null {
  const at = versions.findLastIndex(v => v.sha256 === seen)
  return at < 0 || at === versions.length - 1 ? null : `on version ${at + 1}`
}

/**
 * The pane's put: the image it shows in a new media column just after the
 * thread, and in its ▾, each media column of the canvas, at its end.
 */
export function putOnCanvasButton(input: {
  readonly sha256: Sha256
  readonly name: string
  readonly canvas: CanvasId
  readonly thread: ThreadId
  readonly columns: readonly { readonly id: MediaId; readonly title: string }[]
}): StartButton {
  const { sha256, name } = input
  const [first, ...rest] = input.columns.map(c => ({
    key: `into-${c.id}`,
    label: `into ${c.title}`,
    name: `put into ${c.title}`,
    title: `put this image at the end of the media column ${c.title}, for everyone`,
    intent: {
      kind: "putImages",
      images: [{ sha256, name }],
      to: { kind: "image-at", column: c.id, before: null },
    } as const,
  }))
  return {
    main: {
      key: "put-on-canvas",
      label: "put on canvas",
      name: "put on canvas",
      title:
        "put this image in a new media column just after this thread, for everyone",
      intent: {
        kind: "putImages",
        images: [{ sha256, name }],
        to: { kind: "canvas-at", canvas: input.canvas, after: input.thread },
      },
    },
    more:
      first === undefined
        ? null
        : { items: [first, ...rest], label: "put into a media column" },
  }
}

/** How many files a drop left out, and why. */
export const leftOutWords = (n: number): string =>
  `${n === 1 ? "1 file" : `${n} files`} left out: only images go in a media column`
