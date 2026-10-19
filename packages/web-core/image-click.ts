// web-core/image-click — what a click on a blob image does.

/**
 * Opened in the column's pane, or alone in a new tab: Cmd- or Ctrl-click opens
 * a tab, as a browser does for a link.
 */
export function imageClick(e: {
  readonly metaKey: boolean
  readonly ctrlKey: boolean
}): "pane" | "tab" {
  return e.metaKey || e.ctrlKey ? "tab" : "pane"
}
