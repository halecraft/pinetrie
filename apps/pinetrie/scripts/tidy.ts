// tidy [folder] [--days N] [--dry-run] — your repo's op log cut to a
// window, while no host serves it. It holds the session store's
// lock the whole time, so a host cannot start beside it. A refusal prints
// why and exits 2; a failed step exits 1.

import { homedir } from "node:os"
import { configPlaces, sessionWords } from "@pinetrie/config"
import {
  executeTidy,
  gatherTidy,
  isTidyRaced,
  planTidy,
  prepareProjectDir,
} from "@pinetrie/jj"
import { planTidyInvocation, TIDY_USAGE } from "../host/invocation.ts"
import {
  readRepoSizes,
  type TidyLock,
  takeTidyLock,
  tidyWords,
} from "../host/tidy.ts"

/** `tidy [folder] [--days N] [--dry-run]`: its exit code. */
export async function main(args: readonly string[]): Promise<number> {
  const invocation = planTidyInvocation(
    args,
    process.env.INIT_CWD ?? process.cwd(),
  )
  if (invocation.kind === "refused") {
    console.error(`${invocation.why}\n${TIDY_USAGE}`)
    return 2
  }
  const { folder, days, dryRun } = invocation
  const prepared = await prepareProjectDir(folder, { tools: true })
  if (prepared.kind !== "jj") {
    console.error(tidyWords({ kind: "not-jj", folder }))
    return 2
  }
  const { root } = prepared
  const lock = await takeTidyLock({
    dirs: configPlaces(process.env, homedir(), null).dirs,
    folder: root,
    env: process.env,
  })
  if ("refused" in lock) {
    console.error(sessionWords(lock.refused))
    return 2
  }
  try {
    return await tidy(root, lock, days, dryRun)
  } finally {
    if (lock.kind === "held") lock.release()
  }
}

/** Plan, say, and unless a dry run, run each step, then report. */
async function tidy(
  root: string,
  lock: TidyLock,
  days: number,
  dryRun: boolean,
): Promise<number> {
  const facts = await gatherTidy(root)
  const now = Math.floor(Date.now() / 1000)
  const plan = planTidy({ ...facts, served: lock.kind === "served", days, now })
  if (plan.kind === "refused") {
    console.error(tidyWords({ kind: "refused", root, why: plan.why }))
    return 2
  }
  console.log(tidyWords({ kind: "plan", root, plan, days, now, dryRun }))
  if (plan.kind === "nothing" || dryRun) return 0
  const before = await readRepoSizes(root, facts.ops.ops.length)
  const failed = await executeTidy(root, plan.steps, (step, ms) =>
    console.log(tidyWords({ kind: "step", step, ms })),
  )
  if (failed !== null) {
    console.error(tidyWords({ kind: "failed", ...failed }))
    return 1
  }
  const after = (await gatherTidy(root)).ops.ops.length
  console.log(
    tidyWords({
      kind: "done",
      before,
      after: await readRepoSizes(root, after),
      raced: isTidyRaced({ kept: plan.kept, after }),
    }),
  )
  return 0
}
