// pi/start-pi — for tests: the scribe, the person's pi setup and the agent,
// made in the order the host makes them (ADR-0092).

import {
  type Agent,
  type AgentDocuments,
  type CreateAgentOptions,
  createAgent,
} from "./agent.ts"
import { loadPiSetup, type PiSetup, type PiSetupOptions } from "./pi-setup.ts"
import { createScribe, type Scribe } from "./scribe.ts"

export interface StartedPi {
  readonly scribe: Scribe
  readonly setup: PiSetup
  readonly agent: Agent
  /** The agent, then the scribe: the host's shutdown order. */
  close(): Promise<void>
}

export async function startPi(
  documents: AgentDocuments,
  options: PiSetupOptions &
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
  const setup = await loadPiSetup(options)
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
