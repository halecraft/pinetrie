// removals — what getting the latest removed from a lane's disk, as values,
// and the one function that words them for the model. The words state what
// was seen, never what to run: a recipe's command is a whole tool call's
// text, and the last to write under its outputs, not certainly their maker.

import {
  type DiskPath,
  firstLine,
  type NonEmpty,
  PRODUCT_NAME,
} from "@pinetrie/core"
import { count, namesAndMore } from "./counts.ts"

/** Why a recipe's outputs went stale. */
export type RemovalCause =
  | { readonly kind: "unchecked" }
  | { readonly kind: "changed"; readonly path: string }
  | { readonly kind: "image" }

/** What one stale recipe's removal took: never a cache. */
export interface StaleRemoval {
  /** Topmost, sorted. */
  readonly paths: NonEmpty<DiskPath>
  readonly cause: RemovalCause
  /** The recipe's command as recorded; "" when none was seen. */
  readonly command: string
}

declare const removalsTextBrand: unique symbol

/** The removals as the model reads them, at most `REMOVALS_MOST` characters; "" for none. */
export type RemovalsText = string & { readonly [removalsTextBrand]: true }

/** The longest removals text: a resolution's floor reserves this many characters for it. */
export const REMOVALS_MOST = 1_500

/** The section's title; each message heads it in its own style. */
export const REMOVALS_HEADING = "What getting the latest removed"

/** Removals worded, the rest counted. */
const WORDED = 3
/** Paths named in a removal, the rest counted. */
const NAMED = 3
const PATH_MOST = 120
const COMMAND_MOST = 200

const code = (text: string): string => `\`${text}\``

const causeWords = (cause: RemovalCause): string => {
  switch (cause.kind) {
    case "changed":
      return `${code(firstLine(cause.path, PATH_MOST))} changed, so what was made from it went`
    case "image":
      return "The lane's image changed, so what was made on the old one went"
    case "unchecked":
      return `${PRODUCT_NAME} could not check what these were made from, so they went`
  }
}

const commandWords = (command: string): string => {
  const line = firstLine(command.replaceAll("\n", " ⏎ "), COMMAND_MOST)
  return line === ""
    ? "No command was seen writing there."
    : `The last command seen writing there was ${code(line)}.`
}

const removalItem = (r: StaleRemoval): string =>
  `- ${causeWords(r.cause)}: ${namesAndMore(
    r.paths.map(p => code(firstLine(p, PATH_MOST))),
    NAMED,
  )}. ${commandWords(r.command)}`

/** The removals as the model reads them, cut at `REMOVALS_MOST`; "" for none. */
export function removalsText(removals: readonly StaleRemoval[]): RemovalsText {
  if (removals.length === 0) return "" as RemovalsText
  const more = removals.length - WORDED
  const items = [
    ...removals.slice(0, WORDED).map(removalItem),
    ...(more > 0
      ? [
          `- and ${count(more, "more command's outputs", "more commands' outputs")}`,
        ]
      : []),
  ]
  const text = `${items.join("\n")}\n\nA command named here is a hint, not necessarily the one to run: make what went again as you would after a pull.`
  return (
    text.length > REMOVALS_MOST ? `${text.slice(0, REMOVALS_MOST - 1)}…` : text
  ) as RemovalsText
}
