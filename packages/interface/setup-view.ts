// interface/setup-view — the setup page, decided: what the host read of its
// config, and what it loaded. Every label is a value here and worded in
// `setup-words.ts`, the words the host's startup lines say too.

import type { CommandSummary, SetupRecord } from "@pinetrie/core"
import {
  credentialWords,
  fileStateWords,
  layerWords,
  noModelWords,
  originWords,
  refusalWords,
  setupPageWords,
} from "./setup-words.ts"

export interface SetupView {
  /** The model and where it came from, or why there is none. */
  readonly model: { readonly line: string; readonly none: boolean }
  readonly credentials: readonly string[]
  readonly files: readonly { readonly layer: string; readonly file: string }[]
  readonly refusals: readonly string[]
  /** Every setting, generically: a new one shows with no code of its own. */
  readonly settings: readonly {
    readonly key: string
    readonly describe: string
    readonly value: string
    readonly origin: string
  }[]
  readonly refusedPackages: readonly string[]
  readonly commands: readonly string[]
  readonly contextFiles: readonly string[]
}

/** The page, from the host's record and the commands it published; null before a host wrote it. */
export function setupView(
  record: SetupRecord | null,
  commands: readonly CommandSummary[],
): SetupView | null {
  if (record === null) return null
  const { model } = record
  return {
    model:
      model.kind === "model"
        ? {
            line:
              model.origins.length === 0
                ? model.label
                : `${model.label} (${originWords(model.origins)})`,
            none: false,
          }
        : {
            line: `No model: ${noModelWords(model.why, model.named)}`,
            none: true,
          },
    credentials: record.credentials.map(
      c => `${c.provider}: ${credentialWords(c.source)}`,
    ),
    files: record.files.map(f => ({
      layer: layerWords(f.layer),
      file: fileStateWords(f.file, f.state),
    })),
    refusals: record.refusals.map(refusalWords),
    settings: record.settings.map(s => ({
      key: s.key,
      describe: s.describe,
      value: s.value,
      origin: originWords(s.origins),
    })),
    refusedPackages: record.refusedPackages.map(
      p => `${p} ${setupPageWords.refusedPackage}`,
    ),
    commands: commands.map(c => `/${c.name}`),
    contextFiles: record.contextFiles,
  }
}
