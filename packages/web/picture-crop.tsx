// web/picture-crop — cropping a chosen image to your picture (ADR-0098): a
// round preview you drag, and a zoom. Where the square is, and how a drag or
// the zoom moves it, is `picture-crop.ts`'s (`@pinetrie/interface`); this
// draws it and, on "use this picture", renders the square at `PICTURE_SIZE`.

import {
  type Crop,
  cropSource,
  fitCrop,
  MOST_ZOOM,
  moveCrop,
  PICTURE_SIZE,
  pictureWords,
  zoomCrop,
} from "@pinetrie/interface"
import { useLayoutEffect, useRef, useState } from "react"

/** The preview's side, in CSS pixels. */
const VIEW = 200

/** `crop` of `image` drawn to fill `canvas`. */
function draw(canvas: HTMLCanvasElement, image: ImageBitmap, crop: Crop) {
  const { sx, sy, side } = cropSource(crop, image)
  canvas
    .getContext("2d")
    ?.drawImage(image, sx, sy, side, side, 0, 0, canvas.width, canvas.height)
}

/** The square as a PNG at `PICTURE_SIZE`, or null if the browser gives none. */
function render(image: ImageBitmap, crop: Crop): Promise<Blob | null> {
  const out = document.createElement("canvas")
  out.width = PICTURE_SIZE
  out.height = PICTURE_SIZE
  draw(out, image, crop)
  return new Promise(resolve => out.toBlob(resolve, "image/png"))
}

export function PictureCrop({
  image,
  busy,
  onUse,
  onCancel,
}: {
  image: ImageBitmap
  /** The picture is being saved: nothing can be chosen again. */
  busy: boolean
  onUse: (picture: Blob) => void
  onCancel: () => void
}) {
  const [crop, setCrop] = useState(() => fitCrop(image))
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    if (canvas.current !== null) draw(canvas.current, image, crop)
  }, [image, crop])
  return (
    <div className="picture-crop">
      <canvas
        aria-label={pictureWords.hint}
        className="picture-preview"
        height={VIEW * 2}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={e => {
          const from = drag.current
          if (from === null) return
          drag.current = { x: e.clientX, y: e.clientY }
          setCrop(c =>
            moveCrop(c, e.clientX - from.x, e.clientY - from.y, image, VIEW),
          )
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        ref={canvas}
        title={pictureWords.hint}
        width={VIEW * 2}
      />
      <label className="picture-zoom">
        {pictureWords.zoom}
        <input
          max={MOST_ZOOM}
          min={1}
          onChange={e =>
            setCrop(c => zoomCrop(c, Number(e.target.value), image))
          }
          step={0.01}
          type="range"
          value={crop.zoom}
        />
      </label>
      <div className="picture-actions">
        <button
          className="picture-cancel"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          {pictureWords.cancel}
        </button>
        <button
          className="picture-use"
          disabled={busy}
          onClick={async () => {
            const picture = await render(image, crop)
            if (picture !== null) onUse(picture)
          }}
          type="button"
        >
          {busy ? pictureWords.saving : pictureWords.use}
        </button>
      </div>
    </div>
  )
}
