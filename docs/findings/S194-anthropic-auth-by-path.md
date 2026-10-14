# S194 — `pi-anthropic-auth`, loaded by path, shapes a subscription request with pine·trie's `auth.json`; it reads its own config through `~/.pi` unless `PI_CODING_AGENT_DIR` names pine·trie's directory

- **Status:** Answered
- **Led to:** ADR-0146

**Question.** S23 found that a Claude subscription token works only through
`pi-anthropic-auth`'s `anthropic` provider. ADR-0146 loads extensions only
from paths in pine·trie's settings, and keeps credentials in
`$XDG_DATA_HOME/pinetrie/auth.json`.
1. Loaded through `additionalExtensionPaths` with `noExtensions`, does the
   extension load, and register its provider?
2. Does a request on an `anthropic` model carry the OAuth token from
   pine·trie's `auth.json`, shaped as the extension shapes it? The control
   is the same request without the extension.
3. What does the extension read or call on its own: files (its config,
   resolved through pi's `getAgentDir()`) and the network?
4. Installed on its own, with npm and without pi beside it (as a person
   moving off `~/.pi/agent/npm` would), do it and `pi-subagents` still load
   and shape the request?

**Kill criterion.** If the extension reads its credential or shaping from
`~/.pi`, or a request through it carries no token from pine·trie's file,
then a subscription cannot work under ADR-0146 as written. pine·trie would
then need `PI_CODING_AGENT_DIR` set for the extension, or a provider of its
own.

**Throw away.** The probe in `docs/findings/S193-loader-without-pi-dirs/`,
run with `@gotgenes/pi-anthropic-auth` 3.4.2 installed from npm. No request
reaches Anthropic: `fetch` is replaced, records what is sent, and answers
401. The OAuth credential is fake and unexpired, so no refresh runs. That
Anthropic accepts the shaped request is S23's answer, and the path the
credential is read from does not change it.

## Answers

Not killed. The extension works from pine·trie's files once
`PI_CODING_AGENT_DIR` names pine·trie's directory.

1. **It loads and registers.** A path in `additionalExtensionPaths` loads
   under `noExtensions` (pi keeps those paths as its command line's), with
   no error. It unregisters pi's `anthropic` and registers its own,
   resolving its peer imports from the `node_modules` it is installed in.
2. **The request carries pine·trie's token, shaped.** Both requests send
   `authorization: Bearer` with the token from pine·trie's `auth.json`, and
   `checkAuth("anthropic")` reports OAuth.
   - Without the extension, pi's own OAuth path already sends the Claude
     Code betas, `user-agent: claude-cli/2.1.280`, `x-app: cli` and "You
     are Claude Code, …" as the first system block.
   - With it, the system starts with one more block,
     `x-anthropic-billing-header: cc_version=2.1.280…; cc_entrypoint=sdk-cli; cch=…;`.
     The extension's source says a request without it is answered with the
     "extra usage" 400 that S23's control met.
3. **What it reads and calls:**
   - at load, its config file
     `<getAgentDir()>/extensions/pi-anthropic-auth/config.json`, which
     names more providers to shape. `getAgentDir()` ignores the loader's
     `agentDir`: without `PI_CODING_AGENT_DIR` it is `~/.pi/agent`, and the
     probe's file there added a shaped provider (S193). With the variable
     set to pine·trie's directory, the file is read from there;
   - a project layer of the same file, read only on pi's `session_start`.
     pine·trie emits no events of pi's coding agent, so it is never read;
   - no network at load or at the request beyond the request itself. It
     fetches the account profile only for its `/anthropic-auth:status`
     command, which pine·trie does not offer.
4. **An install of its own works.** `npm install --legacy-peer-deps
   @gotgenes/pi-anthropic-auth pi-subagents` into a fresh folder put no pi
   beside them. Listed from there (variant `ours-installed`), both load with
   no error. The extension registers `anthropic` and shapes the request as
   above, and `pi-subagents` brings its skills and prompts. pi's extension
   loader aliases `@earendil-works/*` to the host's own pi
   (`dist/core/extensions/loader.js`, `getAliases`), so an extension's peer
   imports resolve to pine·trie's 0.87.1 whatever is installed beside it.

## Limits

- The person's installed extension was named `pi-anthropic-auth` in S23;
  this is `@gotgenes/pi-anthropic-auth` 3.4.2 from npm, taken to be the
  same package.
- That Anthropic bills the shaped request to the subscription was not
  measured here: no credential reaches a lane.

## Method

As S193: the `ours`, `ours-env`, `ours-untrusted` and `ours-installed`
variants each make
one request on `claude-sonnet-4-5` through the runtime with the
extension's registrations applied, and one through a second runtime over
the same files without them. `result-<variant>.json` records each
request's URL, headers and the first 120 characters of each system
block.
