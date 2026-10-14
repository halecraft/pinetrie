// pi/start-pi — for tests: the scribe, the model setup and the agent, made
// in the order the host makes them. Unless a test gives its own, the places
// are an empty folder of the test file's own, and pi's agent directory is
// bound to it.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type Agent,
  type AgentDocuments,
  type CreateAgentOptions,
  createAgent,
} from "./agent.ts"
import { bindAgentDir } from "./agent-dir.ts"
import type { ModelPlaces } from "./config.ts"
import { loadPiSetup, type PiSetup, type PiSetupOptions } from "./pi-setup.ts"
import { createScribe, type Scribe } from "./scribe.ts"

export interface StartedPi {
  readonly scribe: Scribe
  readonly setup: PiSetup
  readonly agent: Agent
  /** The agent, then the scribe: the host's shutdown order. */
  close(): Promise<void>
}

let emptyPlaces: ModelPlaces | undefined

/** An empty config folder, one per test file: no credential, no `models.json`, nothing listed. */
export function testPlaces(): ModelPlaces {
  if (emptyPlaces === undefined) {
    const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-pi-test-"))
    emptyPlaces = {
      configDir: dir,
      credentials: path.join(dir, "auth.json"),
      models: path.join(dir, "models.json"),
    }
  }
  return emptyPlaces
}

/** `loadPiSetup` with `testPlaces()` and its binding, unless given. */
export const loadTestSetup = (
  options: Omit<PiSetupOptions, "places" | "binding"> &
    Partial<Pick<PiSetupOptions, "places" | "binding">>,
): Promise<PiSetup> => {
  const places = options.places ?? testPlaces()
  return loadPiSetup({
    ...options,
    places,
    binding: options.binding ?? bindAgentDir(places.configDir),
  })
}

export async function startPi(
  documents: AgentDocuments,
  options: Omit<PiSetupOptions, "places" | "binding"> &
    Partial<Pick<PiSetupOptions, "places" | "binding">> &
    Omit<CreateAgentOptions, "documents" | "scribe" | "setup" | "tools"> & {
      readonly replicaId?: string
      readonly tools?: CreateAgentOptions["tools"]
    },
): Promise<StartedPi> {
  const scribe = createScribe({
    documents,
    replicaId: options.replicaId ?? "test",
    ...(options.blobs === undefined ? {} : { blobs: options.blobs }),
  })
  const setup = await loadTestSetup(options)
  const agent = await createAgent({
    ...options,
    documents,
    scribe,
    setup,
    tools: options.tools ?? null,
  })
  return {
    scribe,
    setup,
    agent,
    async close() {
      await agent.close()
      await scribe.close()
    },
  }
}
