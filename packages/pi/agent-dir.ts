// pi/agent-dir — pi's agent directory, bound to pine·trie's config directory
// for the whole process. pi's `getAgentDir()` reads `PI_CODING_AGENT_DIR` at
// each call and ignores the loader's own directory, and an extension finds
// its config through it: unbound, `pi-anthropic-auth` reads `~/.pi`.
// The model setup and sign-in take the binding, so neither runs unbound.

declare const BOUND: unique symbol

/** Proof that pi's agent directory is pine·trie's, for this process. */
export interface AgentDirBinding {
  readonly dir: string
  readonly [BOUND]: true
}

let bound: string | null = null

/**
 * Bind pi's agent directory to `dir`, once per process. Binding it again to
 * the same directory is a no-op; to another throws, since an extension's
 * config would then be read from whichever bound last.
 */
export function bindAgentDir(dir: string): AgentDirBinding {
  if (bound !== null && bound !== dir)
    throw new Error(
      `pi's agent directory is bound to ${bound} in this process; it cannot be bound to ${dir} too`,
    )
  bound = dir
  process.env.PI_CODING_AGENT_DIR = dir
  return { dir } as AgentDirBinding
}
