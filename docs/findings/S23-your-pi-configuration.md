# S23 — a person's pi configuration inside pine·trie

**Answers.**
1. **pi's own loader loads a person's pi packages unchanged.**
   `SettingsManager` and `DefaultResourceLoader` loaded all six extensions
   listed in `~/.pi/agent/settings.json`, with no errors, and returned one
   provider registration: `anthropic`, from `pi-anthropic-auth`.
2. **With that registration applied to pine·trie's `ModelRuntime`, the settings'
   default model answers through pine·trie's harness and storage.**
   `anthropic/claude-opus-5-5`, with a Claude subscription token, replied
   "S23-OK" in 1.3 s. The system prompt was pi's `buildSystemPrompt`.
3. **Without it, the same call is refused.** A bare `ModelRuntime` sends the
   subscription token without the extension's request shaping, and Anthropic
   returns 400: "Third-party apps now draw from your extra usage, not your plan
   limits."

## Why it was asked

pine·trie resolves models through pi's `ModelRuntime`, which already reads
`~/.pi/agent/models.json` and `auth.json`. A subscription (OAuth) credential
works only through `pi-anthropic-auth`, a pi extension that registers a
wrapped `anthropic` provider. pine·trie loads no extensions. The question was
whether pi's own loader can supply that provider to pine·trie without the rest of
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
`KynetaStorage`: the same path as pine·trie's host.

## Consequences

1. **pine·trie takes its models from the person's pi setup.**
   - Load `SettingsManager` and `DefaultResourceLoader` over `~/.pi/agent`.
   - Apply the extensions' provider registrations to `ModelRuntime`.
   - Default to the settings' `defaultProvider` and `defaultModel`, with the
     `PINETRIE_*` env vars overriding.
2. **Only provider registrations are applied.** Loading runs every package's
   factory, so its side effects happen, as `pi-subagents`' warning shows. But
   pine·trie applies nothing else: tools, commands, event handlers and UI hooks
   are pi's coding agent's, and pine·trie does not emit their events.
3. **The system prompt comes from `buildSystemPrompt`.** The loader supplies
   its context files and skills. Its section layout is what `pi-anthropic-auth`
   shapes: the provider rebuilds the prompt by its section tags (see the
   addendum).
   - The repo has no `AGENTS.md`, so pine·trie's house rules reach the agent only
     once one exists.
   - All 72 of the person's skills are listed in the prompt. Choosing which
     skills pine·trie offers is a later decision.
4. **Four more files are loaded by path** (`settings-manager`,
   `resource-loader`, `model-runtime`, `system-prompt` in
   `pi-coding-agent/dist/core`). They go in `packages/pi/deep.ts`, beside
   `ModelRuntime`, which already is.

## Addendum (2026-09-30): what the model receives

`buildSystemPrompt` renders every section as `<name>…</name>` text and joins
them into one string, which the harness passes on unchanged. Read from
inside a lane of its own, whose agent runs on the person's model through
`pi-anthropic-auth`, the prompt arrives reshaped:

| pi's section | as received |
|---|---|
| preamble | replaced: "You are Claude Code, …", then a short preamble of the provider's |
| `<tools>` | rewritten to "(none)"; pi's closing sentence is gone |
| `<rules>` | intact, with pine·trie's `promptGuidelines` |
| `<docs>` | gone |
| `<project_context>`, `<skills>`, `<cwd>` | intact |

A section pine·trie adds through `buildSystemPrompt`'s `sections` was not
observed; it may be dropped as `<docs>` is. What pine·trie must say to every
model goes in `<rules>` (ADR-0046). Observed only as the prompt a lane's
agent was given; the extension's source was not read.

## Method

A disposable probe in `packages/pi`, not checked in, run with `node` against
the live Anthropic API with the person's own `~/.pi/agent` configuration. The
control and the subject differ only in whether the extensions' provider
registrations are applied.
