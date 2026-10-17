# S219 — pi 1.x is no version bump: pi-agent-core 1.0 removed the harness, `Storage` and the conformance suite pine·trie is built on; 0.99.2, the last before it, is

- **Status:** Answered

**Question.** pine·trie pins `@earendil-works/pi-agent-core`, `pi-ai` and
`pi-coding-agent` at 0.87.1 (2026-09-22). The latest is 1.3.0
(2026-10-15), after 0.99, 1.0 (2026-10-01), 1.1 and 1.2. Can pine·trie move
to 1.3.0 by changing the three versions, with `pnpm run conformance` and
`pnpm run verify` as the gates? Where it cannot, what moved, and what are
the ways forward? And is there a release after 0.87.1 that still has
the harness?

**Kill criterion.** If an API `packages/pi` uses is gone from 1.3.0 with no
equivalent in the three packages, the upgrade is not a bump: it is a
decision, and nothing is upgraded until it is made.

**Throw away.** The packed tarballs under `/tmp/pi` and the copy of the
workspace under `/tmp/ws` that installed the mixed versions.

## Answers

**No: it is not a bump.** pi-agent-core 1.0 removed its whole harness.

1. **pi-agent-core 1.x is the bare `Agent` and nothing else.** Its export
   map at 0.87.1 is `.`, `./node`, `./harness/context`,
   `./experimental/pico3`, `./harness/env/nodejs`,
   `./harness/runtime/reducer`, `./harness/session` and
   `./harness/session/testing`. At 1.0.0 and 1.3.0 it is `.` alone. Its
   `dist/` shrank from 5.9 MB to 304 KB: `agent`, `agent-loop`, `proxy`,
   `stream-fn` and `types`. 0.99.0 still had the harness. 1.3.0's `.d.ts`
   files name none of `Storage`, `StorageBackedSession`,
   `prepareStorageCommit`, `validateCommittedWrites`,
   `resolveListReadOptions`, `createAgentHarness`, `insertEntry`,
   `BACKGROUND_CONTEXT`, `ExecutionEnv`, `NodeExecutionEnv`, the coding
   tools, `compact`, `convertToLlm`, `estimateTokens` or `uuidv7`.
   `packages/pi` imports every one of them. Two of `deep.ts`'s files
   (`dist/harness/utils/usage.js`, `dist/harness/runtime/index.js`) are
   gone.
2. **The Storage conformance suite is gone with it**
   (`./harness/session/testing`). `apps/conformance` has nothing to run.
3. **pi-coding-agent 1.x does not use a harness.** Its `dist` imports
   `pi-agent-core`'s root alone, for `Agent`. Its 1.2.0 changelog removes
   the experimental server, client and plugin stack, and the chord
   dependency. Of `deep.ts`'s eight coding-agent files, all are still at
   1.3.0 (`model-runtime`, `settings-manager`, `resource-loader`,
   `system-prompt`, `skills`, `prompt-templates`, `utils/mime`,
   `utils/image-resize`). Their contents were not checked.
4. **The harness lives on as `@earendil-works/pi-durable`**, released
   1.0.0 on 2026-10-01 as "a durable agent harness", and labelled
   **"Experimental. The API changes without notice between releases."**
   It is a different design, not the old harness moved:
   - conversations, forks, tasks, submissions and Chord documents. There
     are no lanes, and no `StorageBackedSession`;
   - a different `Storage` (`types.d.ts:861`): `commit`, `mintId` (a
     global numeric id, greater than every one before), conversation,
     entry, task and submission scans, and `findLatestHeadMarker`;
   - its own conformance suites (`./testing`: `storage-conformance`,
     `env-conformance`);
   - breaking changes in each minor version: `order` on every scan (1.1),
     tagged task unions, and any storage error failing the session (1.2).
5. **Mixing versions does not type-check.** A copy of the workspace with
   pi-agent-core at 0.87.1 and pi-ai and pi-coding-agent at 1.3.0 installs
   two pi-ai copies, and `tsc --noEmit` fails in `packages/pi`:
   - `agent.ts:226` and `agent.ts:290`: 1.3.0's `ModelRuntime` is no
     0.87.1 `Models`. `TranscriptContext` gained a brand
     (`[transcriptContextBrand]`), so `Provider.stream` does not match;
   - `config.ts` and `scripted.ts`: pi-ai's images API was renamed
     (`createImagesModels`, `ImagesApi`, `ImagesModel`, `ImagesModels` and
     `createImagesProvider` are gone; `ImageApi` and `ImageModel` exist),
     and `providers/openrouter-images` is gone.

   Nothing was run past `tsc`.

### 0.99.2, the last release before 1.0, is a bump

6. **0.99.0, 0.99.1 and 0.99.2 keep the harness.** Each package's export
   map is 0.87.1's, but for pi-ai's added `./models`. All of `deep.ts`'s
   files are there. Outside the unused `harness/pico3`, the only
   pi-agent-core `.js` files that differ from 0.87.1 are `agent.js` and
   `agent-loop.js`; `harness/runtime/harness.js` is byte-identical, and
   the harness `.d.ts` files differ only in pico3, an added
   `Lane.command`, a JSONL storage's types and two optional parameters in
   `session/values.d.ts`.
7. **pi-ai's images API changed in 0.99.0.** Image models are now
   `type: "image"` entries of a provider's catalog (`openrouter`'s lists
   OpenRouter's, the `recraft` models included), generated through
   `Models.generateImages`, which `ModelRuntime` implements.
   `createImagesModels`, `createImagesProvider`, the `Images*` types and
   `providers/openrouter-images` are gone. That was the only type error
   at 0.99.2 (`packages/pi/config.ts`, `scripted.ts`).
8. **pi-coding-agent's root now imports** (its experimental server is
   gone), but neither root exports `createAgentHarness`, `addUsage`,
   `emptyUsage`, `buildSystemPrompt`, `loadPromptTemplates` or
   `detectSupportedImageMimeType`, so `deep.ts` still loads its files.
9. **At 0.99.2, after the images port, `pnpm run typecheck` passes,
   `pnpm run conformance` passes 21/21 against both stores, and
   `pnpm test` passes.**

### Ways forward

None is chosen here. Each needs an ADR.

- **Stay on 0.99.2.** Nothing changes, but pi's harness is frozen
  upstream: no fixes, no new models in pi-ai's catalog beyond what custom
  providers (`models.json`) add. ADR-0001's "diff upstream periodically"
  has nothing to diff against.
- **Mix:** keep pi-agent-core 0.99.2 for the harness, and move pi-ai and
  pi-coding-agent to 1.x for providers, sign-in and resource loading.
  This means adapting between two pi-ai versions at the harness's
  `models` (the `TranscriptContext` brand); the images API is already
  ported at 0.99.2. Whether 0.99.2's harness runs
  with a 1.x model stream is not measured.
- **Vendor 0.99.2's harness** into the repo, as code of our own, and move
  pi-ai and pi-coding-agent forward over it. Same adapter problem as the
  mix, but the harness becomes ours to fix.
- **Move to pi-durable**: a new adapter for its `Storage` over Kyneta,
  threads and lanes mapped onto conversations and forks, and the agent,
  scribe, compaction and tools rebuilt on its tasks. That is most of
  `packages/pi` (about 12,000 lines with its tests), on an API that says it changes
  without notice. ADR-0001, ADR-0003, ADR-0013 and ADR-0015 rest on the
  old harness.

## Evidence

- The tarballs, from `npm pack @earendil-works/<package>@<version>`:
  pi-agent-core 0.87.1, 0.99.0, 0.99.1, 0.99.2, 1.0.0 and 1.3.0; pi-ai and
  pi-coding-agent 0.87.1, 0.99.0, 0.99.1, 0.99.2 and 1.3.0; pi-durable 1.3.0. Their export maps
  were read from `package.json`, and their `dist` directories were listed
  and searched for the names above.
- pi-coding-agent's `CHANGELOG.md`, 0.87.1 to 1.3.0, and pi-durable's
  `CHANGELOG.md` and `README.md`, both at 1.3.0.
- `npm search @earendil-works` for where the harness went.
- The mixed install: the workspace copied to `/tmp/ws`, Kyneta linked at
  `/tmp/kyneta`, `packages/pi/package.json` set to pi-ai and
  pi-coding-agent 1.3.0, `pnpm install --no-frozen-lockfile`, then
  `npx tsc --noEmit`. The same for all three at 0.99.2, whose lockfile is
  the one now in the repo: its diff against 0.87.1's touches only pi's
  packages and their dependencies.
- `diff -rq` of pi-agent-core's `dist` at 0.87.1 and 0.99.2.
