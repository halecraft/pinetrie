// jj/lane/run — jj, in a lane or from a directory on the host.
//
// jj rules:
// - Every jj command passes `-R <root>`: one run from the wrong directory acts
//   on whatever repo surrounds it. `-R` must name a workspace root exactly.
// - Never pipe jj into something that closes early: jj exits 3 on a broken
//   pipe. `execFile` reads everything.
// - An editor would hang a shell with no terminal, so every jj runs with
//   `JJ_EDITOR=false` (`NO_EDITOR`): a command that wants one fails at once.
//   A lane's container sets the same variables.
// - Output meant for a program always comes from a `-T` template: jj does
//   not promise to keep its printed text stable.

import { NO_EDITOR, WORKSPACE_ROOT } from "@pinetrie/core"
import { type Ran, type Runner, run } from "@pinetrie/lanes"

/** Every jj command's flags: no pager, and output for a program. */
export const JJ_FLAGS = ["--no-pager", "--color=never"] as const

/** jj in a lane, over the lane's runner: always on `/workspace`. */
export const laneJj =
  (lane: Runner): Runner =>
  args =>
    lane(["jj", "-R", WORKSPACE_ROOT, ...JJ_FLAGS, ...args])

/**
 * jj from `dir`, with no `-R`: for asking where a repo is, and for the
 * startup reads of your repo before `@pinetrie/jj`'s runners exist.
 */
export const jjIn = (dir: string, args: readonly string[]): Promise<Ran> =>
  run("jj", [...JJ_FLAGS, ...args], { cwd: dir, env: NO_EDITOR })
