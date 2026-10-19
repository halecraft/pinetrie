// web/media-column — a media column on a canvas: its title, which anyone
// renames, and its images in one order, each drawn at the column's width from
// its fitted copy at its stored size, so its box is held before its bytes
// load. Two wide, two to a row, so alternatives sit side by side. Each image
// has its title, a stepper through its versions, ◀ and ▶ and a drag to move
// it among the others, a bin, and its margin of comments. A file dropped on
// the column puts its images at the end; on an image's edge, a new image
// before or after it (`imageEdge`); onto the image, a version of it.

import {
  blobUrl,
  type CardId,
  type CardRecord,
  type CardWidth,
  type ImageId,
  type ImagesTarget,
  imageMargin,
  type MediaId,
} from "@pinetrie/core"
import {
  type ColumnAct,
  commentVersionWords,
  dropProps,
  type ImageView,
  type Intent,
  imageSpot,
  MEDIA_EMPTY,
  type MediaColumnView,
  marginCards,
  type Reader,
  type ReadOnly,
  type SeatRecord,
  versionWords,
} from "@pinetrie/interface"
import type { SessionClient } from "@pinetrie/session"
import { newCardId } from "@pinetrie/session/connect"
import { dragProps, imageEdge } from "@pinetrie/web-core"
import { useRef, useState } from "react"
import { Button, IconButton } from "./button.tsx"
import { fileDropAtProps, fileDropProps } from "./file-drop.ts"
import { TrashIcon } from "./icons.tsx"
import { uploadImages } from "./image-upload.ts"
import { ListColumnHead } from "./list-column-head.tsx"
import { Margin, MarginCount } from "./margin.tsx"
import { TitleField } from "./title-field.tsx"

export function MediaColumn(p: {
  session: SessionClient
  view: MediaColumnView
  /** Every card: an image's comments are read from its margin. */
  cards: readonly CardRecord[]
  /** How many columns wide its card is drawn. */
  width: CardWidth
  reader: Reader
  readOnly: ReadOnly | null
  seats: readonly SeatRecord[]
  onIntent: (intent: Intent) => void
  onTyping: (card: CardId) => void
}) {
  const { view } = p
  const column = view.column
  // An image's acts are its column's, by the media column's id.
  const act = (a: ColumnAct) =>
    p.onIntent({
      kind: "column",
      column: { kind: "card", card: column },
      act: a,
    })
  // How many files the last drop left out, which only an image may be.
  const [left, setLeft] = useState(0)
  const put = async (files: readonly File[], to: ImagesTarget) => {
    const up = await uploadImages(p.session.upload, files)
    setLeft(up.left)
    p.onIntent({
      kind: "put-images",
      images: up.images,
      to,
    })
  }
  const writable = p.readOnly === null
  return (
    <section
      className="media-column"
      data-card={column}
      data-kind="media"
      data-column={column}
      data-width={p.width}
      {...(writable
        ? {
            ...fileDropProps(files => {
              void put(files, { kind: "image-at", column, before: null })
            }),
            ...dropProps({ kind: "images", column, on: null }),
          }
        : {})}
    >
      <ListColumnHead
        card={column}
        count={view.images.length}
        kind="media"
        onIntent={p.onIntent}
        readOnly={p.readOnly}
        title={view.title}
        titled={view.titled}
        width={p.width}
      />
      <div className="media-images" data-width={p.width}>
        {view.images.length === 0 && (
          <p className="notes-empty">{MEDIA_EMPTY}</p>
        )}
        {view.images.map(image => (
          <MediaImage
            across={p.width === 2}
            put={(files, to) => void put(files, to)}
            act={act}
            among={view.images.map(i => i.image)}
            cards={p.cards}
            column={column}
            image={image}
            key={image.image}
            onIntent={p.onIntent}
            onTyping={p.onTyping}
            readOnly={p.readOnly}
            reader={p.reader}
            seats={p.seats}
            session={p.session}
          />
        ))}
      </div>
      {left > 0 && (
        <p className="media-left">
          {left === 1 ? "1 file" : `${left} files`} left out: only images go in
          a media column
        </p>
      )}
    </section>
  )
}

/** One image of a media column, with its versions and its margin. */
function MediaImage(p: {
  image: ImageView
  column: MediaId
  among: readonly ImageId[]
  cards: readonly CardRecord[]
  act: (a: ColumnAct) => void
  session: SessionClient
  reader: Reader
  readOnly: ReadOnly | null
  seats: readonly SeatRecord[]
  onIntent: (intent: Intent) => void
  onTyping: (card: CardId) => void
  /** Images sit two to a row: their edges are left and right. */
  across: boolean
  /** Files put as new images at a spot of the column. */
  put: (files: readonly File[], to: ImagesTarget) => void
}) {
  const { image } = p
  const figure = useRef<HTMLElement>(null)
  // Which edge of the image a point is at.
  const edgeAt = (at: { x: number; y: number }) => {
    const el = figure.current
    return el === null
      ? "onto"
      : imageEdge(at, el.getBoundingClientRect(), p.across)
  }
  // A file dropped at an edge is a new image there; onto the image, a
  // version of it. While one is dragged over, its edge is drawn.
  const fileDrop = fileDropAtProps(
    (files, at) => {
      const spot = imageSpot(image.image, edgeAt(at), p.among)
      if (spot.kind === "version") void version(files)
      else
        p.put(files, {
          kind: "image-at",
          column: p.column,
          before: spot.before,
        })
    },
    at => {
      const el = figure.current
      if (el === null) return
      const edge = at === null ? "onto" : edgeAt(at)
      if (edge === "onto") delete el.dataset.dropEdge
      else el.dataset.dropEdge = edge
    },
  )
  const newest = image.versions.length - 1
  // Which version is drawn: the newest until the reader steps back.
  const [step, setStep] = useState<number | null>(null)
  const at = Math.min(step ?? newest, newest)
  const shown = image.versions[at]
  const [renaming, setRenaming] = useState(false)
  const [open, setOpen] = useState(false)
  const writable = p.readOnly === null
  const on = imageMargin(image.image)
  const version = async (files: readonly File[]) => {
    const up = await uploadImages(p.session.upload, files.slice(0, 1))
    const [first] = up.images
    if (first !== undefined)
      p.onIntent({
        kind: "add-version",
        image: image.image,
        sha256: first.sha256,
      })
    setStep(null)
  }
  if (shown === undefined) return null
  return (
    <figure
      className="media-image"
      data-card={image.image}
      ref={figure}
      {...(writable
        ? {
            ...fileDrop,
            ...dropProps({
              kind: "images",
              column: p.column,
              on: { image: image.image, edge: "onto" },
            }),
          }
        : {})}
    >
      <div
        className="media-image-grip"
        {...(writable ? dragProps({ kind: "card", card: image.image }) : {})}
      >
        <a href={blobUrl(shown.original)} rel="noopener" target="_blank">
          <img
            alt={image.title}
            decoding="async"
            height={shown.height}
            loading="lazy"
            src={blobUrl(shown.sha256)}
            width={shown.width}
          />
        </a>
        <figcaption className="media-image-bar">
          {renaming && writable ? (
            <TitleField
              label="title for this image"
              onEnd={() => setRenaming(false)}
              onSend={title =>
                p.onIntent({
                  kind: "rename",
                  of: { kind: "card", card: image.image },
                  title,
                })
              }
              placeholder={image.title}
              stored={image.titled}
            />
          ) : (
            <Button
              look="plain"
              className="media-image-title"
              disabled={!writable}
              onClick={() => setRenaming(true)}
              title="rename this image"
            >
              {image.title}
            </Button>
          )}
          {image.versions.length > 1 && (
            <span className="media-versions">
              <IconButton
                label="an older version"
                disabled={at === 0}
                onClick={() => setStep(at - 1)}
              >
                ‹
              </IconButton>
              {versionWords(at, image.versions.length)}
              <IconButton
                label="a newer version"
                disabled={at === newest}
                onClick={() => setStep(at + 1 === newest ? null : at + 1)}
              >
                ›
              </IconButton>
            </span>
          )}
          {writable && (
            <span className="media-moves">
              <IconButton
                label="move it before the one before it"
                onClick={() =>
                  p.act({
                    kind: "reorder",
                    card: image.image,
                    among: p.among,
                    step: -1,
                  })
                }
              >
                ◀
              </IconButton>
              <IconButton
                label="move it after the one after it"
                onClick={() =>
                  p.act({
                    kind: "reorder",
                    card: image.image,
                    among: p.among,
                    step: 1,
                  })
                }
              >
                ▶
              </IconButton>
              <IconButton
                label="trash this image"
                className="trash-card"
                onClick={() => p.act({ kind: "trash", card: image.image })}
                title="trash this image · ⌘Z brings it back"
              >
                <TrashIcon />
              </IconButton>
            </span>
          )}
          {open ? null : (
            <MarginCount
              beside="image"
              count={image.comments}
              onOpen={() => setOpen(true)}
            />
          )}
        </figcaption>
      </div>
      {open && (
        <Margin
          beside="image"
          comments={marginCards(p.cards, on)}
          onAct={p.act}
          onComment={() => {
            const card = newCardId()
            p.act({
              kind: "new-card",
              card,
              to: { kind: "margin", on, seen: shown.sha256 },
              text: "",
            })
            p.act({ kind: "focus-card", card })
          }}
          onShut={() => setOpen(false)}
          onTyping={p.onTyping}
          readOnly={p.readOnly}
          reader={p.reader}
          seats={p.seats}
          session={p.session}
          versionOf={seen => commentVersionWords(seen, image.versions)}
        />
      )}
    </figure>
  )
}
