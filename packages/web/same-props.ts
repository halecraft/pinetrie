// web/same-props — `React.memo`'s rule from a table of how each prop is
// compared, pure: `Message`'s (`message-props.ts`) and the review's
// (`review-pane.tsx`) (S54).

import { sameData } from "@pinetrie/interface"

/** `value`: plain data rebuilt on every render, compared by content. `identity`: kept while unchanged. */
export type PropRule = "identity" | "value"

/**
 * Whether two sets of props draw the same, prop by prop as `rules` says. The
 * table names every prop, so a prop added to `P` fails to compile until it is
 * given a rule.
 */
export function sameProps<P extends object>(
  rules: {
    readonly [K in keyof P]-?: PropRule
  },
): (a: P, b: P) => boolean {
  const keys = Object.keys(rules) as (keyof P)[]
  return (a, b) =>
    keys.every(k =>
      rules[k] === "value" ? sameData(a[k], b[k]) : Object.is(a[k], b[k]),
    )
}
