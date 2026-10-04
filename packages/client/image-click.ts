// client/image-click — what a click on a blob image does.

/**
 * Opened in the column's pane (ADR-0078), or alone in a new tab: Cmd- or
 * Ctrl-click opens a tab, as a browser does for a link.
 */
export function imageClick(
  e: Pick<MouseEvent, "metaKey" | "ctrlKey">,
): "pane" | "tab" {
  return e.metaKey || e.ctrlKey ? "tab" : "pane"
}
