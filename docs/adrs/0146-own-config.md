# ADR-0146 — pine·trie reads its own config in five layers, each setting declares who may set it and how layers combine, and credentials are state

- **Status:** Accepted (Duane, 2026-10-14)
- **Area:** `docs/01-architecture.md`, `docs/06-interface.md`,
  `packages/pi/TECHNICAL.md`, `packages/lanes/TECHNICAL.md`,
  `packages/rules/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S23, S193, S194
- **Amends:**
  - ADR-0107: models no longer come from the person's pi setup. The default
    model and pi packages are pine·trie settings, custom providers and
    credentials are in pine·trie's own directories, and a host starts with no
    model.
  - ADR-0036: skills and prompts come from pine·trie's config, not pi's. The
    mount guard refuses pine·trie's config and data directories, not pi's
    agent directory. A project's own skills are read in a lane's copy of the
    project, not mounted from the host.
  - ADR-0035: the two levels become layers, combined by each setting's
    declared rule. `lanes.shared` joins the user's and the project's lists, as
    before. The user's file is `pinetrie.json`, not `config.json`.
  - ADR-0140: `owner` and `lanes.ssh` are settings with declared layers. That
    the user's choice beats the project's is the setting's declared order, and
    a system file may forbid personal ssh. `lanes.ssh` has one shape in every
    layer: a project grants with `lanes.ssh.personal: true`.
  - ADR-0071: digests are a setting in any layer's `pinetrie.json`, on unless
    the most specific layer that sets it turns it off.

**Context.**

- **pine·trie borrows pi's directories.** S23 had pine·trie load the person's
  pi setup as pi does, and that still holds:
  - the default model from `~/.pi/agent/settings.json` and the project's
    `.pi/settings.json`;
  - credentials from `~/.pi/agent/auth.json`;
  - custom providers from `~/.pi/agent/models.json`;
  - every extension the person's pi packages list. Only provider
    registrations are applied, but each package's factory still runs;
  - skills, prompts and the global `AGENTS.md` from the agent directory, its
    packages and the project's `.pi/`.

  With no default model, the host refuses to start. Someone who does not use
  pi cannot use pine·trie, and a change made for pi changes pine·trie.
- **pine·trie's own config is two files, merged ad hoc.** The user's
  `$XDG_CONFIG_HOME/pinetrie/config.json` and the project's `pinetrie.json`.
  Each key's decoder decides which file counts:
  - `lanes.vm.slots` is read through the same decoder as the project's
    `lanes`, and only the user's copy applies;
  - the user's `lanes.ssh: false` declines what the project grants;
  - `lanes.shared` joins both lists;
  - a lane's own `pinetrie.json` may only give up what accepted work's
    grants.

  Each rule is right, but each lives in its own decoder. Nothing stops a new
  key from being read from the wrong file, or from letting a later file widen
  a grant. A malformed value takes its default silently.
- **One file serves both the person and the machine.** Today they are one
  Mac. ADR-0119 separates a lane from the machine it runs on, and a host in
  the cloud serves people with no files on it. What the machine offers
  (lane runtime, providers, ceilings) is whoever runs the host's to set.
- **A person has settings for one project** that do not belong in its
  committed `pinetrie.json`: the model they use there, say. jj keeps that
  kind of repo config outside the repo, for security, since 0.38
  (`jj config path --repo` is under `$XDG_CONFIG_HOME/jj/repos/`). A
  folder project keeps nothing of pine·trie's in its folder (ADR-0142).
- **Credentials are written by the program.** An OAuth refresh rewrites
  them. They are state, not config, and no config file should hold them.

**Decision.**

*Five layers, from the broadest to the most specific.*

| layer | file | written by |
|---|---|---|
| `system` | the first `pinetrie/pinetrie.json` under `$XDG_CONFIG_DIRS` (default `/etc/xdg`), on Linux and macOS alike | whoever runs the host |
| `user` | `$XDG_CONFIG_HOME/pinetrie/pinetrie.json` | the person |
| `project` | `pinetrie.json` at the project's root, as accepted work has it | the team, by acceptance |
| `local` | `$XDG_CONFIG_HOME/pinetrie/sessions/<session>/pinetrie.json`, keyed by the session as ADR-0118 identifies it | the person, for one project |
| `env` | the environment variables a setting names (`PINETRIE_MODEL`) | whoever starts the host |

- **The project layer is the project's `pinetrie.json` at a state:**
  - accepted work's copy, for every setting but the names below;
  - for a grant, accepted work's copy less what a lane's own copy gives up
    (`effectiveLaneConfig`, as now);
  - for the names that find accepted work (`accepted.bookmark`,
    `wip.prefix`, `publish.bookmark`, `publish.catchUp`), the working copy's
    copy at the host's start, as now: they cannot come from what they find.

  Each setting declares which copy it reads. No other setting reads the
  working copy.
- **The local layer is outside the project,** as jj's is. It may set what a
  project may not, so it must be somewhere no thread's work can reach. In a
  folder project an accept writes the agent's files into the folder
  (ADR-0142), so an offer could add the person's own config. In a jj
  project only `.pinetrie/`'s exclude would stand in the way. A copied,
  synced or cloned folder would carry it to another host. And a folder
  project keeps nothing of pine·trie's in its folder.
- **Its key is the session's.** A folder project has nowhere inside to keep
  an id, as jj keeps its `config-id` in `.jj/repo/`, so the session is the
  only key both kinds share. The local layer follows however ADR-0118
  identifies a session, and has no naming of its own.
- **Collaborators' own preferences** belong in the session, since they have
  no file on the host. They are not part of this decision. The table admits
  a layer for them later without changing how layers combine.

*Each setting is declared once, with its rule, and nothing else reads a file.*

- **A setting is a value:** its key, its schema, the layers that may set it,
  and one of two rules:
  - **pick:** the most specific layer that sets it decides. A setting may
    declare its own order where the default (`system`, `user`, `project`,
    `local`, `env`) is wrong. `lanes.ssh.personal` orders `project` before
    `user`, so the person's choice beats the project's;
  - **join:** every layer that sets it adds to it, from the setting's
    empty value: a grant, or a list of skill paths.

  Either may then be **limited** by the layers it names. A limit is applied
  with the setting's `meet`, so it can only narrow the result:
  `min` for a budget, `and` for a flag, intersection for a list. A setting
  whose type has no `meet` cannot be limited.
- **A layer's file is decoded against the settings that admit that layer,**
  and only those. A key that is unknown, set in a layer that may not set it,
  or malformed is refused. The file still loads, the refusal names the file,
  key and reason in the host's startup lines, and the setting falls through
  to the other layers. A file that is not JSON is refused whole. Nothing is
  silently ignored.
- **Settling is one pure function** over the declarations and the decoded
  layers. It returns each setting's value and where it came from: a layer
  and its file, or the default. That generalises `ModelOrigin`.
- **Code reads settled values, never a file or its JSON.** The per-key
  decoders (`decodeLaneConfig`, `decodeSshSettings`, `decodeDigestConfig`
  and the rest) become declarations. "Only the user's applies" becomes a
  layer list.
- **The rules are tested over the whole table:**
  - a limit never widens;
  - a layer the setting does not admit changes nothing;
  - a pick takes the most specific setter in its order.

  Generated layers check every declared setting, so a new one is covered
  with no test of its own.
- **The machinery is a package of its own,** `@pinetrie/config`, which
  declares only core. The app declares every setting in one table with it.
  `@pinetrie/ssh`, `@pinetrie/lanes` and `@pinetrie/jj` keep their
  decisions and take settled values as typed inputs: their boundaries let
  them declare no more (a lane's hop runs `@pinetrie/ssh` from pine·trie's
  install). The table settles at the host's start, and again for each
  state whose project copy a setting reads: accepted work when it moves,
  and a lane's own copy for its grants.

*What a project may never set.*

- **What sends a key somewhere, or runs code on the host, is never a
  project's:** providers and their base URLs are the user's `models.json`,
  and pi packages, whose extensions run on the host, admit only `system`
  and `user`. A project's `pinetrie.json` is
  written by whoever its acceptance admits, and is read by every
  collaborator's host.

*pine·trie reads nothing of pi's directories.*

| what | from now on |
|---|---|
| the default model | `model` (`provider/id`), a pick in every layer; `PINETRIE_MODEL` in `env` |
| custom providers | pi's `models.json`, a file beside the user's `pinetrie.json`, read by pi's `ModelRuntime` as it reads its own. A provider's key goes in `auth.json` by signing in, not in the file |
| pi packages (skills, prompts, provider extensions) | `packages`, local paths, joined from `system` and `user`. A package's skills and prompts become commands, and only its extensions' provider registrations apply, as now. Nothing is installed: a package that is not a folder is refused |
| skills and prompts | `skills` and `prompts`, paths, joined from `system`, `user`, `project` (inside the repo) and `local`; plus `skills/` and `prompts/` beside the user's file |
| context files | `AGENTS.md` beside the user's file, and those inside the project; none above it |
| credentials | `$XDG_DATA_HOME/pinetrie/auth.json`, mode 0600, in pi's format, written only by pine·trie |

- **pi's code still loads them, kept out of pi's directories** (S193,
  S194):
  - its `ModelRuntime`, with our `auth.json` and `models.json`;
  - its resource loader, with settings built in memory from ours, our
    config directory as its agent directory, `noExtensions`, `noSkills`,
    `noPromptTemplates` and `noThemes`, and our lists as its additional
    paths;
  - `PI_CODING_AGENT_DIR` set to our config directory before pi loads. An
    extension finds its own config through pi's `getAgentDir()`, which
    ignores the loader's agent directory: `pi-anthropic-auth` read
    `~/.pi` without it. An extension's config then lives beside ours;
  - the project untrusted in pi's settings, so pi neither lists its
    `.pi/` and `.agents/` nor reads its `SYSTEM.md`;
  - context files filtered to ours and those inside the project. pi walks
    up to `/`, and an `AGENTS.md` in the home directory reached the model.

  With all of them, no file under `~/.pi` or a project's `.pi/` is read.
- **A command's label comes from the path pine·trie listed,** not from
  pi's record of it. A listed package's root is where its
  `.claude-plugin/plugin.json` and `package.json` are read, for every
  skill and prompt under it; a loose skill or prompt is labelled by the
  layer that listed it (`user`, `project`). pi records a package's skills
  without their package, and an added path's as `temporary` (S193).
- **A project's own skills are read in a lane's own copy,** at
  `/workspace` and their path in the project. They are not mounted from the
  host: the lane has them already.
- **The host starts with no model.** A run then refuses with why, rather
  than the host refusing to start.

*A person is told where everything goes.*

- **`pnpm sign-in [provider]` and `pnpm sign-out [provider]`,** on the
  host's machine, run pi's sign-in over the terminal: its prompts, its
  sign-in URL or device code, and a pasted code where the redirect cannot
  reach the host. They write `auth.json`. They stay once the page's sign-in
  exists: a host whose machine has no browser of its own signs in this way.
- **A setup page** (`#setup`, a page as ADR-0098's are) says what this host
  read, the same for everyone and with nothing secret in it:
  - each layer's file, whether it exists, and what it refused;
  - the model and where it came from, or why there is none;
  - which providers have a credential, and from where (`auth.json`, an
    environment variable), never the credential;
  - the packages, skills, prompts and context files loaded;
  - the commands and keys that change each.

  The host's startup lines name it when the host has no model, and a run
  refused for having none links it. It is the one place pine·trie explains
  its own config, for a first start and every one after.
- **The mount guard refuses pine·trie's own directories:** a root that is,
  or holds, `$XDG_CONFIG_HOME/pinetrie` (the user's file and the `ssh/`
  service keys) or `$XDG_DATA_HOME/pinetrie` (credentials and sessions).
  It no longer names pi's agent directory.

**Consequences.**

- Someone without pi can run pine·trie. Someone with pi signs in again in
  pine·trie: nothing is copied from `~/.pi`, and two programs holding one
  OAuth grant could each invalidate the other's refresh token.
- The user's file is renamed to `pinetrie.json`. `config.json` is not read,
  and nothing reads it to say so.
- A person's skills and prompts reach pine·trie only once their paths are
  in pine·trie's config. Their pi packages are listed by path.
- Every setting read today is declared, with its layers and rule, before any
  file is read the new way. The plan does both at once: no key is read the
  old way beside the new.
- The local layer inherits the session's limits. A session is named for
  its first source today, so two projects whose folders share a name would
  share a local file, and a renamed folder would lose its own. Telling
  sessions apart is ADR-0118's to solve, and the local layer follows it.
  Until ADR-0118's session lands, the session is the project's folder name.
- Suites pass the host the places of every layer and of the data directory,
  as they pass a user config now, so a suite never reads the person's files.
- A Claude subscription works as before, through `pi-anthropic-auth`
  listed by path in `packages`, once signed in with `pnpm sign-in
  anthropic`: the request carries the token from our `auth.json` with the
  extension's billing header (S194).
- A project's `.pi/` skills and prompts stop reaching the agent until the
  project lists them in its `pinetrie.json`.
- The auth screen and the model picker build on this: they write
  `auth.json`, read `model`, and add what they need (which models are
  offered, a thread's thinking level). They are decided in an ADR of their
  own.

**Alternatives rejected.**

- **Keep reading `~/.pi`, beside our own.** Two sources for one setting,
  and pine·trie's behaviour still changes with pi's.
- **Share pi's `auth.json`.** One sign-in for both, but pi's lock is the
  only thing that keeps two refreshing programs from invalidating each
  other's tokens, and pine·trie would depend on pi's file staying where and
  as it is.
- **One override order for every key**, as git's config has. A later layer
  could widen a grant, and the user's decline of what a project grants needs
  the opposite order.
- **Each decoder keeps its own rule,** as now. Right one key at a time, and
  wrong for the next key nobody checks.
- **The local layer in the project's `.pinetrie/`.** Reachable by a
  thread's accepted work, impossible in a folder project, and trusted
  wherever the folder goes. jj moved its repo config out for the same
  reason.
- **The local layer in the session's data directory**
  (`$XDG_DATA_HOME/pinetrie/<session>/`). One folder per project, but it is
  a file written by hand, and clearing or moving a session's data would
  take the person's settings with it.
- **Custom providers as a setting** (`models.providers`), given to pi's
  `registerProvider`. It makes a model available, but not with the defaults
  `models.json` fills: a request on a model listed by its id alone failed
  reading its missing `input` (measured on pi 0.87.1). pi parses
  `models.json` only from a file, so the file stays pi's format.
- **Credentials in `$XDG_CONFIG_HOME`,** as some tools keep tokens. A
  refresh rewrites them, and a config directory is what people copy between
  machines and into dotfile repos.
- **Read `config.json` too, or refuse to start while it exists.** No
  backwards compatibility: the rename is said once, in the change that
  makes it.
