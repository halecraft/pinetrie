// One command on your repo, as data: what to run and as whom, never where.
// The runner adds `-R <root>` and the host's flags (`run.ts`).

export type RepoStep =
  | {
      readonly tool: "jj"
      /**
       * `host`: `--ignore-working-copy` and `operation.username=pinetrie-host`,
       * so it never snapshots the working copy, and the evolog says the host
       * made what it made, where the host's version of proposed changes cannot.
       * `you`: as you, for a step that is
       * your act or moves the working copy (`planPublishGetLatest`, an accepting
       * `planPublishMove`, `planGetLatestUndo`).
       */
      readonly as: "host" | "you"
      readonly args: readonly string[]
    }
  | { readonly tool: "git"; readonly args: readonly string[] }

export const host = (...args: string[]): RepoStep => ({
  tool: "jj",
  as: "host",
  args,
})

export const you = (...args: string[]): RepoStep => ({
  tool: "jj",
  as: "you",
  args,
})

export const git = (...args: string[]): RepoStep => ({ tool: "git", args })
