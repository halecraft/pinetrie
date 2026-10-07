// web/pictures-context — each person's picture (ADR-0098), by writer, for
// every circle on the page. A context, not a prop: circles are drawn deep in
// avatar stacks, readers' menus, column headers and the footer, and only
// `Initial` reads it, so a picture set redraws circles and no message list
// (`packages/web/TECHNICAL.md`, "Renders"). `App` provides it from
// `readParticipantPictures`, which keeps its map while the pictures are the
// same.

import type { Sha256, WriterId } from "@pinetrie/core"
import { createContext } from "react"

export const Pictures = createContext<ReadonlyMap<WriterId, Sha256>>(new Map())
