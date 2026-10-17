// ssh/programs — the OpenSSH programs the host runs: `ssh -G` for the
// broker, and `ssh-agent` with `ssh-add` for service identities, which also
// checks every session binding's signature.

import { type ChildProcess, execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import type { UsableServiceKey } from "./keys.ts"

export interface Ran {
  /** -1 when the program could not start, with why in `stderr`. */
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type Run = (
  argv: readonly string[],
  env?: Readonly<Record<string, string>>,
) => Promise<Ran>

/** Runs a program with no shell and no input. Never throws. */
export const runProgram: Run = ([program, ...args], env) =>
  new Promise(resolve => {
    if (program === undefined) {
      resolve({ code: -1, stdout: "", stderr: "no program" })
      return
    }
    const child = execFile(
      program,
      args,
      { env: { ...process.env, ...env }, timeout: 10_000 },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : -1
        resolve({ code, stdout, stderr: stderr || (error?.message ?? "") })
      },
    )
    child.stdin?.end()
  })

interface ServiceAgent {
  readonly socket: string
  readonly added: readonly UsableServiceKey[]
  /** Keys `ssh-add` refused, with what it said. */
  readonly failed: readonly { readonly name: string; readonly said: string }[]
  close(): void
}

/** How long `ssh-agent` gets to make its socket before it counts as failed. */
const AGENT_START_MS = 5000

/**
 * `ssh-agent` in the foreground, its socket in `dir`, holding `keys`; null
 * when it does not start (no `ssh-agent` on the host). `ssh-add` gets no
 * terminal and `SSH_ASKPASS_REQUIRE=never`, so a key with a passphrase,
 * which `keys.ts` refuses first, fails rather than waits.
 */
export async function startServiceAgent(input: {
  readonly dir: string
  readonly keys: readonly UsableServiceKey[]
  readonly run?: Run
}): Promise<ServiceAgent | null> {
  const run = input.run ?? runProgram
  const socket = path.join(input.dir, "service.sock")
  const child: ChildProcess = spawn("ssh-agent", ["-D", "-a", socket], {
    stdio: "ignore",
  })
  const started = await new Promise<boolean>(resolve => {
    const since = Date.now()
    child.once("error", () => resolve(false))
    child.once("exit", () => resolve(false))
    const poll = () => {
      if (existsSync(socket)) resolve(true)
      else if (Date.now() - since > AGENT_START_MS) resolve(false)
      else setTimeout(poll, 20)
    }
    poll()
  })
  if (!started) {
    child.kill()
    return null
  }
  const added: UsableServiceKey[] = []
  const failed: { name: string; said: string }[] = []
  for (const key of input.keys) {
    const ran = await run(["ssh-add", "-q", key.path], {
      SSH_AUTH_SOCK: socket,
      SSH_ASKPASS_REQUIRE: "never",
    })
    if (ran.code === 0) added.push(key)
    else failed.push({ name: key.name, said: ran.stderr.trim() })
  }
  return { socket, added, failed, close: () => child.kill() }
}
