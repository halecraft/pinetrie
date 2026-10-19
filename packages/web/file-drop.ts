// web/file-drop — the one file that touches the browser's own drag and drop:
// a file dragged in from the desktop. Every drag that starts in the page is
// the pointer engine's (`use-drag.ts`). `boundaries.test.ts` keeps every
// other file off `dataTransfer` and `onDrop`.

import { pastedFiles } from "@pinetrie/interface"
import type { DragEvent } from "react"
import { useEffect } from "react"

/** Whether a drag brings files. Its files are hidden until the drop; its types are not. */
const bringsFiles = (data: DataTransfer | null): boolean =>
  data?.types.includes("Files") === true

/**
 * The props that make an element take dropped files: a file drag over it is
 * accepted as a copy, and a drop hands `onFiles` its files. Other drags pass
 * through, as text dragged within the page still does. The innermost element
 * that takes files takes the drop alone: an image in a media column takes it
 * as a version, not the column as a new image.
 */
export function fileDropProps(onFiles: (files: File[]) => void): {
  readonly onDragOver: (e: DragEvent) => void
  readonly onDragLeave: (e: DragEvent) => void
  readonly onDrop: (e: DragEvent) => void
} {
  return fileDropAtProps(onFiles)
}

/** A point in the window. */
type Point = { readonly x: number; readonly y: number }

/**
 * `fileDropProps`, its drop also handing `onFiles` the point it was dropped
 * at, in the window: where on the strip or on an image a drop lands depends
 * on it. `onOver`, given, hears the point while files are dragged over the
 * element, and null once they leave it or are dropped.
 */
export function fileDropAtProps(
  onFiles: (files: File[], at: Point) => void,
  onOver?: (at: Point | null) => void,
): {
  readonly onDragOver: (e: DragEvent) => void
  readonly onDragLeave: (e: DragEvent) => void
  readonly onDrop: (e: DragEvent) => void
} {
  return {
    onDragOver: e => {
      if (!bringsFiles(e.dataTransfer)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = "copy"
      onOver?.({ x: e.clientX, y: e.clientY })
    },
    onDragLeave: e => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null))
        onOver?.(null)
    },
    onDrop: e => {
      if (!bringsFiles(e.dataTransfer)) return
      e.preventDefault()
      e.stopPropagation()
      onOver?.(null)
      const files = pastedFiles(e.dataTransfer)
      if (files.length > 0) onFiles(files, { x: e.clientX, y: e.clientY })
    },
  }
}

/**
 * For as long as the page is mounted, a file dropped where nothing takes it
 * is refused, not opened: the browser's own answer would load the file in
 * the tab, leaving the page. An element that takes files cancels the event
 * first (`fileDropProps`), so this sees it handled.
 */
export function useFileDropGuard(): void {
  useEffect(() => {
    const refuse = (e: globalThis.DragEvent) => {
      if (e.defaultPrevented || !bringsFiles(e.dataTransfer)) return
      e.preventDefault()
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "none"
    }
    window.addEventListener("dragover", refuse)
    window.addEventListener("drop", refuse)
    return () => {
      window.removeEventListener("dragover", refuse)
      window.removeEventListener("drop", refuse)
    }
  }, [])
}
