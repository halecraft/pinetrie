// rules/markdown — a message's markdown parsed into mdast, one way for every
// reader in rules (ADR-0042, ADR-0126). It uses the micromark and mdast
// packages that the client's remark-parse and remark-gfm wrap, at the same
// versions, so the images, links and blocks found here are in the tree the
// page draws, and a block's number is the same in both.

import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { gfm } from "micromark-extension-gfm"

/** `text` as an mdast tree, with GitHub's extensions (tables among them). Pure. */
export const parseMarkdown = (text: string): ReturnType<typeof fromMarkdown> =>
  fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
