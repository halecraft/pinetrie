// A server for channel.test.ts: each call names what to do.

import { runCommand } from "./run.ts"
import { serve } from "./serve.ts"

export type TestCall =
  | { readonly echo: unknown }
  | { readonly wait: number }
  | { readonly updates: number }
  | { readonly throws: string }
  | { readonly run: readonly string[]; readonly stdin?: string }
  | { readonly exit: string }
  | { readonly noise: string }

serve<{ readonly pid: number }, TestCall, number, unknown>(
  { pid: process.pid },
  async (call, { signal, update }) => {
    if ("echo" in call) return call.echo
    if ("wait" in call) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, call.wait)
        signal.addEventListener("abort", () => {
          clearTimeout(timer)
          reject(new Error("aborted"))
        })
      })
      return call.wait
    }
    if ("updates" in call) {
      for (let i = 1; i <= call.updates; i++) update?.(i)
      return "done"
    }
    if ("throws" in call) throw new Error(call.throws)
    if ("noise" in call) {
      process.stdout.write(`${call.noise}\n`)
      return "said"
    }
    if ("run" in call)
      return runCommand(call.run, {
        cwd: "/",
        bytes: true,
        signal,
        ...(call.stdin === undefined ? {} : { stdin: call.stdin }),
      })
    process.stderr.write(call.exit)
    process.exit(3)
  },
)
