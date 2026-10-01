// client/image-click — what a click on a blob image does.

/** Shown over the page, or opened alone in a new tab. */
export type ImageClick = "view" | "tab"

/** Cmd- or Ctrl-click opens a tab, as a browser does for a link. */
export function imageClick(
  e: Pick<MouseEvent, "metaKey" | "ctrlKey">,
): ImageClick {
  return e.metaKey || e.ctrlKey ? "tab" : "view"
}
