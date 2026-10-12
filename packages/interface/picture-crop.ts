// interface/picture-crop — the square of an image a person's picture shows:
// chosen on the profile page by dragging and zooming, drawn by the browser at
// `PICTURE_SIZE` before anything is uploaded. Every step goes through one
// clamp, which keeps the square inside the image.

/** The side of the picture the browser sends, in pixels. */
export const PICTURE_SIZE = 256

/** How far in a crop zooms: its side is at least the shorter side over this. */
export const MOST_ZOOM = 4

export interface ImageSize {
  readonly width: number
  readonly height: number
}

/**
 * The square of the image the picture shows. Its side is the image's
 * shorter side over `zoom`, and `x`, `y` its centre, in the image's pixels.
 */
export interface Crop {
  readonly zoom: number
  readonly x: number
  readonly y: number
}

const sideOf = (zoom: number, image: ImageSize): number =>
  Math.min(image.width, image.height) / zoom

const within = (n: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, n))

/** `crop` with its zoom in [1, `MOST_ZOOM`] and its square inside the image. */
function clamp(crop: Crop, image: ImageSize): Crop {
  const zoom = within(crop.zoom, 1, MOST_ZOOM)
  const half = sideOf(zoom, image) / 2
  return {
    zoom,
    x: within(crop.x, half, image.width - half),
    y: within(crop.y, half, image.height - half),
  }
}

/** The largest square, centred. */
export const fitCrop = (image: ImageSize): Crop =>
  clamp({ zoom: 1, x: image.width / 2, y: image.height / 2 }, image)

/**
 * `crop` after a drag of `dx`, `dy` pixels over a preview `view` pixels
 * wide: the image follows the pointer, so the square moves the other way.
 */
export function moveCrop(
  crop: Crop,
  dx: number,
  dy: number,
  image: ImageSize,
  view: number,
): Crop {
  const scale = sideOf(crop.zoom, image) / view
  return clamp(
    { ...crop, x: crop.x - dx * scale, y: crop.y - dy * scale },
    image,
  )
}

/** `crop` zoomed to `zoom`, about its centre. */
export const zoomCrop = (crop: Crop, zoom: number, image: ImageSize): Crop =>
  clamp({ ...crop, zoom }, image)

/** The source square `drawImage` reads, in the image's pixels. */
export function cropSource(
  crop: Crop,
  image: ImageSize,
): { readonly sx: number; readonly sy: number; readonly side: number } {
  const side = sideOf(crop.zoom, image)
  return { sx: crop.x - side / 2, sy: crop.y - side / 2, side }
}

/** The profile page's words for your picture. */
export const pictureWords = {
  upload: "upload a picture",
  replace: "choose another",
  remove: "remove",
  use: "use this picture",
  cancel: "cancel",
  zoom: "zoom",
  hint: "drag to move it",
  saving: "saving…",
  unreadable: "not an image this browser can read",
} as const
