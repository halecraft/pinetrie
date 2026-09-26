# S23 — a person's pi configuration inside Pineta

**Answers.**
1. **pi's own loader loads a person's pi packages unchanged.**
   `SettingsManager` and `DefaultResourceLoader` loaded all six extensions
   listed in `~/.pi/agent/settings.json`, with no errors, and returned one
   provider registration: `anthropic`, from `pi-anthropic-auth`.
2. **With that registration applied to Pineta's `ModelRuntime`, the settings'
   default model answers through Pineta's harness and storage.**
   `anthropic/claude-opus-5-5`, with a Claude subscription token, replied
   "S23-OK" in 1.3 s. The system prompt was pi's `buildSystemPrompt`.
3. **Without it, the same call is refused.** A bare `ModelRuntime` sends the
   subscription token without the extension's request shaping, and Anthropic
   returns 400: "Third-party apps now draw from your extra usage, not your plan
   limits."

## Why it was asked

Pineta resolves models through pi's `ModelRuntime`, which already reads
`~/.pi/agent/models.json` and `auth.json`. A subscription (OAuth) credential
works only through `pi-anthropic-auth`, a pi extension that registers a
wrapped `anthropic` provider. Pineta loads no extensions. The question was
whether pi's own loader can supply that provider to Pineta without the rest of
pi's coding agent.

## Result

| step | result |
|---|---|
| extensions loaded | `model-failover`, `tree-vim`, `pi-mcp-adapter`, `pi-anthropic-auth`, `pi-subagents`, `pstack` |
| load errors | none; `pi-subagents` logs that it cannot find a running pi |
| provider registrations | `anthropic` (pi-anthropic-auth); no native providers |
| settings default | `anthropic/claude-opus-5-5` |
| system prompt | `buildSystemPrompt`: 1,888 chars, 0 context files, 72 skills |
| control, no extensions | 400 `invalid_request_error` in 411 ms; no text |
| with the registration | "S23-OK", stop `stop`, 169 input / 7 output tokens, 1,266 ms |

The call went through `createAgentHarness`, `StorageBackedSession` and
`KynetaStorage`: the same path as Pineta's host.

## Consequences

1. **Pineta takes its models from the person's pi setup.**
   - Load `SettingsManager` and `DefaultResourceLoader` over `~/.pi/agent`.
   - Apply the extensions' provider registrations to `ModelRuntime`.
   - Default to the settings' `defaultProvider` and `defaultModel`, with the
     `PINETA_*` env vars overriding.
2. **Only provider registrations are applied.** Loading runs every package's
   factory, so its side effects happen, as `pi-subagents`' warning shows. But
   Pineta applies nothing else: tools, commands, event handlers and UI hooks
   are pi's coding agent's, and Pineta does not emit their events.
3. **The system prompt comes from `buildSystemPrompt`.** The loader supplies
   its context files and skills. Its section layout is what `pi-anthropic-auth`
   shapes.
   - The repo has no `AGENTS.md`, so Pineta's house rules reach the agent only
     once one exists.
   - All 72 of the person's skills are listed in the prompt. Choosing which
     skills Pineta offers is a later decision.
4. **Four more files are loaded by path** (`settings-manager`,
   `resource-loader`, `model-runtime`, `system-prompt` in
   `pi-coding-agent/dist/core`). They go in `packages/pi/deep.ts`, beside
   `ModelRuntime`, which already is.

## Method

A disposable probe in `packages/pi`, not checked in, run with `node` against
the live Anthropic API with the person's own `~/.pi/agent` configuration. The
control and the subject differ only in whether the extensions' provider
registrations are applied.
