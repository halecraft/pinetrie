# S193 — pi's loader, given pine·trie's settings and directory, `PI_CODING_AGENT_DIR` and an untrusted project, reads nothing of `~/.pi` or a project's `.pi/`; context files above the project still arrive

- **Status:** Answered
- **Led to:** ADR-0146

**Question.** ADR-0146 has pine·trie keep pi's code but none of pi's
directories. The host would load with:
- a `SettingsManager` built in memory from pine·trie's settings;
- a `DefaultResourceLoader` whose `agentDir` is `$XDG_CONFIG_HOME/pinetrie`,
  with `noExtensions`, `noSkills`, `noPromptTemplates` and `noThemes`, and
  pine·trie's own lists in `additionalExtensionPaths`,
  `additionalSkillPaths` and `additionalPromptTemplatePaths`;
- a `ModelRuntime` with `authPath` in `$XDG_DATA_HOME/pinetrie` and
  `modelsPath` in `$XDG_CONFIG_HOME/pinetrie`.

With that:
1. Which files under `~/.pi` or the project's `.pi/` and `.agents/` does
   the process open, stat or list?
2. Does any of them reach what the host uses: the extensions and provider
   registrations, the skills, the prompts, the context files, the system
   prompt and its appendix, the models and their credentials?
3. Does `PI_CODING_AGENT_DIR`, set to pine·trie's directory, close what
   remains?
4. What else outside pine·trie's directories and the project's own files
   reaches the host?
5. A pi package (a folder whose `package.json` lists skills and prompts)
   listed in `additionalExtensionPaths`: do its skills and prompts load
   under `noSkills` and `noPromptTemplates`, and does pi record the package
   root that ADR-0036's labels are read from?

**Kill criterion.** If a file in `~/.pi` or a project's `.pi/` reaches
what the host uses, and no option or override keeps it out, then pi's
loader cannot be pine·trie's. ADR-0146 then needs a loader of its own
over pi's skill and prompt parsers.

**Throw away.** `docs/findings/S193-loader-without-pi-dirs/`: a fake home
and project with a sentinel in every place pi looks, a preload that
records every file-system call naming a path, and the probe. It runs on
pi 0.87.1, the version pine·trie pins, installed outside the repo.

## Answers

Not killed. Two settings and one override keep everything of pi's out.

1. **With ADR-0146's options alone, one file of `~/.pi` is read, and the
   project's `.pi/` and `.agents/` are scanned:**
   - `~/.pi/agent/extensions/pi-anthropic-auth/config.json`, read by the
     extension itself through pi's `getAgentDir()`, which reads
     `PI_CODING_AGENT_DIR` or falls back to `~/.pi/agent`, whatever the
     loader's `agentDir` is (S194);
   - pi's package manager still lists the project's `.pi/skills`,
     `.pi/prompts` and `.pi/extensions`, and `.agents/skills` in the
     project, the home directory and `/`. The `no*` flags drop what it
     finds; they do not stop the listing. The loader also reads the
     project's `.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md`, because a
     project is trusted by default in pi's settings, even in memory.
2. **What reaches the host's use:**
   - the extension's file adds a provider it shapes (`pi-home-shaped` in
     the probe). That is the only thing of `~/.pi` that reaches use;
   - skills, prompts and extensions are only pine·trie's lists. The models
     are only pine·trie's `models.json`, and the credential only its
     `auth.json`;
   - the project's `SYSTEM.md` becomes the loader's system prompt and
     `APPEND_SYSTEM.md` its appendix. The host discards both: its prompt is
     `buildSystemPrompt` over the context files and skills
     (`packages/pi/lanes.ts`), with neither passed;
   - a skill from a listed path gets pi's scope `temporary`, a skill in
     pine·trie's directory `user`. ADR-0036 labels a loose skill by pi's
     scope, so a project's skills would read `temporary`.
3. **`PI_CODING_AGENT_DIR` closes `~/.pi`; an untrusted project closes
   `.pi/`.** With the variable set to pine·trie's directory, no call names
   a path under `~/.pi`. With `setProjectTrusted(false)` as well, no call
   names the project's `.pi/` or `.agents/`, and the loader's system prompt
   and appendix are empty.
4. **What else arrives:**
   - **context files above the project.** pi walks from the project up to
     `/`, and every `AGENTS.md` or `CLAUDE.md` on the way is a context
     file: `~/AGENTS.md` here, for a project under the home directory. The
     host gives them to the model today. `agentsFilesOverride` can keep
     only pine·trie's own file and those inside the project;
   - `~/.agents/skills` is still listed and its `SKILL.md` stat'ed, and
     nothing of it is used.

| variant | calls naming `~/.pi` | naming the project's `.pi/`, `.agents/` | extra provider from `~/.pi` |
|---|---|---|---|
| `today` (pi's settings and agent directory) | 68 | 54 | yes |
| `ours` (ADR-0146's options) | 1 | 43 | yes |
| `ours-env` (+ `PI_CODING_AGENT_DIR`) | 0 | 43 | no |
| `ours-untrusted` (+ untrusted project) | 0 | 0 | no |
| `ours-packages` (+ two pi packages as extension paths) | 0 | 0 | no |
| `ours-installed` (+ the extension and `pi-subagents` from an install without pi, S194 item 4) | 0 | 0 | no |

5. **A listed package's skills and prompts load, but its skills lose their
   package.** pi resolves a package given as an extension path as its
   command line's `-e` does: its skills, prompts and extensions all load,
   under `noSkills` and `noPromptTemplates` too. Its prompts record the
   package (`origin: package`, the package root as `baseDir`). Its skills
   record only `cli`, `temporary` and `top-level`, with no root, so
   `gatherCommands` could not find the package's name to label them. A
   second package's skill of the same name was dropped as a collision, as
   pi always drops one.

The `today` variant is the check that the sentinels can be seen: every
place pi looks reached it, and its request carried `~/.pi`'s key.

## Consequences for ADR-0146

- The host sets `PI_CODING_AGENT_DIR` to pine·trie's config directory
  before pi loads, so every default of pi's that names its agent directory
  names ours. An extension's own config then lives there too.
- pi's settings mark the project untrusted. The project's own skills and
  prompts reach pine·trie only as paths in its `pinetrie.json`.
- Context files are pine·trie's own `AGENTS.md` and those inside the
  project. Those above it are dropped.
- A command's label comes from the path pine·trie listed, not from pi's
  record: a listed package's root is where its `.claude-plugin/plugin.json`
  and `package.json` are read, for every skill and prompt under it.
- A package listed this way runs its extensions too, so only the layers
  that may run code on the host may list packages.

## Method

`run.sh` runs `probe.mjs` once per variant (`ours-installed` only when
given an install's folder) in a fresh fake home, each in its own
process with an empty environment, `HOME` and the XDG variables pointed
into the tree, and `PI_OFFLINE=1`. `trace.mjs` is preloaded: it wraps
`node:fs`'s path-taking calls, sync, callback and promise, then syncs the
ESM exports, and records every call naming a path under the tree.
`trace-<variant>.json` holds the calls and `result-<variant>.json` what
the loader and the runtime returned. pi 0.87.1 and
`@gotgenes/pi-anthropic-auth` 3.4.2 were installed with npm outside the
repo.
