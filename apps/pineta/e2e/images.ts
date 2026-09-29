// e2e/images — small PNGs the suites paste and upload (ADR-0042). Each is a
// solid colour, so a real model can say which one it was shown.

const png = (base64: string): Buffer => Buffer.from(base64, "base64")

/** 40×30, solid red. */
export const RED_PNG = png(
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAKUlEQVR4nO3NoQ0AAAwCMP5/ensBh2lS31wysVnFYrFYLBaLxWKxWFx5Pp2rjeB5c/4AAAAASUVORK5CYII=",
)

/** 32×24, solid green. */
export const GREEN_PNG = png(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAI0lEQVR4nGNgWMBAWzRqwagFoxaMWjBqwagFoxaMWjA0LAAACQHgEGHDK3kAAAAASUVORK5CYII=",
)

/** 20×20, solid blue. */
export const BLUE_PNG = png(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAGUlEQVR4nGNgYPhPARrVPKp5VPOo5gHVDAAUwI6AVu8gqwAAAABJRU5ErkJggg==",
)

/** 24×16, solid yellow. */
export const YELLOW_PNG = png(
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAGklEQVR4nGN4doKBKog6powaNGrQqEEj2CAAG9+FH4hspA0AAAAASUVORK5CYII=",
)
