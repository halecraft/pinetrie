// interface/undivided-words — what a `bash` call's detail says when its
// output is shown whole, not under each statement, for each reason the
// host's join found (`UndividedWhy`, `@pinetrie/rules`).

import { assertNever } from "@pinetrie/core"
import type { UndividedWhy } from "@pinetrie/rules"

/** The detail's one line saying why a command's output is not split by statement. */
export function undividedWords(why: UndividedWhy): string {
  return `Not split by statement: ${reasonWords(why)}.`
}

function reasonWords(why: UndividedWhy): string {
  switch (why) {
    case "no-observer":
      return "this lane has no observer"
    case "missing-hook":
      return "the observer can't attribute output on this kernel (the host's log names the hook)"
    case "other-version":
      return "the observer is another version's"
    case "over-cap":
      return "its output passed what a lane sends"
    case "output-lost":
      return "the observer lost some of its output"
    case "count-mismatch":
      return "its attributed bytes didn't add up"
    case "unknown-statement":
      return "the shell named a statement the command doesn't have"
    case "line-outside-statement":
      return "the shell's lines didn't match the command's"
    case "no-pipes":
      return "its output wasn't a pipe"
    case "flush-failed":
      return "the observer didn't confirm its output"
    default:
      return assertNever(why)
  }
}
