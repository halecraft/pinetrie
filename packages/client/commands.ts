// client/commands — finding a command as you type it (ADR-0036).
//
// A command is always typed in full, `/<package>:<name>` or
// `/<package>:skill:<name>`, so no name is ever ambiguous; completion finds
// it by any part. Typing `/plan` offers `/duane:skill:plan` and
// `/pi-pstack:skill:plan` alike.

import type { CommandSummary } from "@pineta/core"

/**
 * The commands matching what is typed, while the text's first word is a
 * `/` and nothing after it has been typed yet; none otherwise. Each part of
 * what is typed, split on `:`, must be found in some part of the command's
 * name. Those whose own name (the last part) starts with what is typed come
 * first, then the rest; each group keeps its order.
 */
export function matchCommands(
  text: string,
  commands: readonly CommandSummary[],
): readonly CommandSummary[] {
  const match = /^\/(\S*)$/.exec(text)
  const typed = match?.[1]
  if (typed === undefined) return []
  const wanted = typed
    .toLowerCase()
    .split(":")
    .filter(p => p !== "")
  const found = commands.filter(c => {
    const parts = c.name.toLowerCase().split(":")
    return wanted.every(w => parts.some(p => p.includes(w)))
  })
  const last = wanted.at(-1) ?? ""
  const leads = (c: CommandSummary) =>
    (c.name.toLowerCase().split(":").at(-1) ?? "").startsWith(last)
  return [...found.filter(leads), ...found.filter(c => !leads(c))]
}
