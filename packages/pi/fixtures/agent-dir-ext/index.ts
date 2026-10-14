// A fixture extension that finds its own config as pi-anthropic-auth does,
// through pi's `getAgentDir()`, and registers a provider named by it: the
// test reads which directory it was given from the provider's name.
import { readFileSync } from "node:fs"
import path from "node:path"
import { getAgentDir } from "@earendil-works/pi-coding-agent"

export default function (pi: {
  registerProvider(name: string, config: object): void
}): void {
  let name = "no-config"
  try {
    const file = path.join(getAgentDir(), "agent-dir-ext.json")
    name = (JSON.parse(readFileSync(file, "utf8")) as { name: string }).name
  } catch {}
  pi.registerProvider(name, {
    baseUrl: "http://127.0.0.1:9/v1",
    api: "openai-completions",
    models: [],
  })
}
