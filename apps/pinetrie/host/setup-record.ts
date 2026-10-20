// host/setup-record — what the setup page shows, decided from the settled
// config and what the model setup loaded (who shapes a subscription's
// requests among it): the one `pinetrie.setup` value.
// The startup lines word the same report (`startup-lines.ts`), with the same
// words (`setup-words.ts` in `@pinetrie/interface`).

import type { ConfigOrigin } from "@pinetrie/core"
import type { PiSetup } from "@pinetrie/pi"
import type {
  ModelLine,
  SetupModel,
  SetupRecord,
  SetupSession,
} from "@pinetrie/rules"
import { type HostReport, SETTINGS } from "./settings.ts"

/**
 * The setup record. `origins` are where the config named the model; null
 * for a suite's named or scripted model, which no config names.
 */
export function planSetupRecord(input: {
  readonly report: HostReport
  readonly model: ModelLine
  readonly origins: readonly ConfigOrigin[] | null
  readonly setup: Pick<
    PiSetup,
    "credentials" | "refusedPackages" | "contextFiles" | "subscription"
  >
  readonly session: SetupSession | null
}): SetupRecord {
  const { report, model, setup } = input
  const setupModel: SetupModel =
    model.kind === "model"
      ? { kind: "model", label: model.label, origins: input.origins ?? [] }
      : model
  return {
    files: report.files.map(f => ({
      layer: f.layer,
      file: f.file,
      state: f.state,
    })),
    refusals: report.refusals,
    model: setupModel,
    credentials: setup.credentials,
    settings: Object.entries(SETTINGS).map(([key, setting]) => {
      const settled = report.settled[key as keyof typeof SETTINGS]
      return {
        key,
        describe: setting.describe,
        value: JSON.stringify(settled.value) ?? "null",
        origins: settled.origins,
      }
    }),
    refusedPackages: setup.refusedPackages,
    contextFiles: setup.contextFiles,
    subscription: setup.subscription,
    session: input.session,
  }
}
