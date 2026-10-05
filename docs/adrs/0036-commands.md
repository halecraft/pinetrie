# ADR-0036 — Your pi skills and prompts are commands, qualified by package, expanded at send

**Status:** Accepted. Implemented by `PLAN-2026-09-28-commands`. Evidence:
S46. Amends ADR-0034: skill files are a grant every lane of its own gets.
**Amended by ADR-0055:** a second kind of command, which acts on a card, is
named last and is not typed (`bring-up-to-date` first). Typed commands stay
as decided here.

**Context.** pine·trie loads your pi configuration (ADR-0022, S23), and pi's
loader finds your skills and prompt templates: yours, the project's, and
those of every pi package your settings list. In pi's terminal, `/skill:plan`
expands a skill into a `<skill …>` block and `/review` a template. pine·trie
drives pi's harness, not pi's session, so nothing expanded a command: it
reached the model as typed. pi keeps one skill or template per name, so a
second package's `plan` was unreachable. And under ADR-0034 a lane could read
no skill file: pi lists skills by host paths, and your home directory is not
mounted.

**Decision.**
- **Every command is qualified by its package**, in pi's own form: a prompt
  template is `/<package>:<name>`, a skill `/<package>:skill:<name>`. So a
  skill and a template of the same name never collide, and installing a
  package never changes what a name meant. Completion in the composer finds
  a command by any part: typing `/plan` offers every command named `plan`.
- **A package's label** is its `.claude-plugin/plugin.json` `name`, as Claude
  names plugins; else its `package.json` name without the scope; else pi's
  scope (`user`, `project`) for a loose skill or template; `pinetrie` for
  pine·trie's own. The user config's `commands.names` renames one, keyed by pi's
  `source`. Two packages with one label are refused, both named, until one is
  renamed: a person decides, never load order.
- **Every command pi loaded is reachable,** those its collision handling
  drops included: the host loads them again by file. The model's own list of
  skills keeps pi's precedence.
- **A command is expanded on the host at send, and frozen.** The message
  stores what was typed, for people, and the command's file, its hash and
  its expansion, which the model reads. A later edit or install never
  changes what a message meant. A skill expands to pi's block, byte for byte
  (`_expandSkillCommand` in pi-coding-agent's `agent-session.js`); a
  template, with its arguments. A command is for the agent, as `@agent` is.
  An unknown `/a:b` is refused; a first word not of that form is text.
- **Skill files are read-only in every lane of its own at `/mnt/host` and
  their host path** (S46). One rule, so no granted path can shadow the
  image's own. What is mounted is each command's package root, else its own
  directory, never one that is or holds your home directory, `/` or pi's
  agent directory (`auth.json`). A skill that cannot be mounted still
  expands, and is logged as not readable in lanes.
- **Lane paths only where pine·trie writes them:** the skill list in a lane's
  system prompt, and an expanded skill's header. Skills refer to their own
  files by relative path and to other skills by name (pi's `docs/skills.md`),
  so nothing in their text is translated.
- **Every mount a lane gets is one list**, rendered by one function that
  handles the separators `container` gives `--mount` and `-v` (S46 item 4).

**Consequences.**
- Your skills and prompts work in pine·trie as in pi, with the package in front,
  and are found by typing.
- A branch that works directly, from a thread of its own, inherits command
  messages whose headers name `/mnt/host/…` paths. That is the same exposure
  as `/workspace` paths in inherited history (ADR-0034), not a new one.
- A new or changed skill package changes every lane's mounts, so each lane's
  container is recreated once at its next start (ADR-0035).
- Suites give the host a fixture pi directory (`agentDir`), and never read
  the person's own.

**Alternatives rejected.**
- Unqualified names resolved when unique: installing a package would make a
  name ambiguous, or silently change what it runs.
- Claude's `/duane:plan` for a skill: a skill and a template of one name
  would collide within a package, as `comments` and `comments.md` do.
- pi's list as it is: a second package's `plan` would be unreachable.
- Mounting skill directories at their own host paths: a skill under `/root`
  or `/usr` would shadow the image's.
- Rewriting paths inside skills' text: skills refer relatively and by name.
- Expanding when the model reads a message: a later edit would change what
  an old message meant.
- Storing only the expansion: people would read a whole skill in the thread.
