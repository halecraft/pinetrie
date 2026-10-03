// repo/step — one command on your repo, as data: what to run, and as whom,
// never where. The runner adds `-R <root>` and the host's flags (`run.ts`), so
// no plan names the root.

/** One command on your repo. */
export type RepoStep =
  | {
      readonly tool: "jj"
      /**
       * `host`: `--ignore-working-copy` and `operation.username=pineta-host`,
       * so it never snapshots your files and the evolog says the host made
       * what it made (S48 items 1 and 8). `you`: as you, for a step that is
       * your act or moves your files (`planLand`, `planFollow`).
       */
      readonly as: "host" | "you"
      readonly args: readonly string[]
    }
  | { readonly tool: "git"; readonly args: readonly string[] }

/** jj as the host. */
export const host = (...args: string[]): RepoStep => ({
  tool: "jj",
  as: "host",
  args,
})

/** jj as you. */
export const you = (...args: string[]): RepoStep => ({
  tool: "jj",
  as: "you",
  args,
})

/** git in your repo. */
export const git = (...args: string[]): RepoStep => ({ tool: "git", args })
