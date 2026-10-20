# ADR-0192 — pine·trie ships `pi-anthropic-auth` and loads it unless a listed copy replaces it or a setting turns it off

- **Status:** Accepted (Duane, 2026-10-20)
- **Area:** `packages/pi/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S23, S194, S274, S275
- **Amends:**
  - ADR-0146: a Claude subscription works with no package listed; a listed
    copy of `pi-anthropic-auth` replaces the one pine·trie ships, and
    `anthropic.subscription` turns it off.
  - ADR-0189: the published package's dependencies include the extension
    pine·trie ships, which no import names, from a list the build reads.
- **Revised:**
  - 2026-10-20 (S274): the shipped copy resolves from `packages/pi/`, loads
    and shapes the request under a global npm install and a global pnpm one,
    against the one pi each holds; what Anthropic makes of it is S275's.
  - 2026-10-20: as built, the setup page's line for none says only that
    `anthropic.subscription` is false; whose file set it is the settings
    list's origin, on the same page. The warning's fact is that no loaded
    package registered `anthropic`, which also covers a listed copy that
    failed to load.

**Context.**

- **A Claude subscription works only through `pi-anthropic-auth`'s
  provider.** pi's own OAuth path already sends the Claude Code betas, its
  user agent and its first system block. Anthropic still answers 400,
  "Third-party apps now draw from your extra usage, not your plan limits",
  until the request also carries the extension's
  `x-anthropic-billing-header` (S23, S194).
- **pine·trie loads extensions only from `packages`** (ADR-0146). Someone
  who installs pine·trie, signs in with `pinetrie sign-in anthropic` and
  names an `anthropic/…` model passes every setup check, and the first run
  fails with that 400. A second install met exactly this: its
  `pinetrie.json` had no `packages`, and the person saw no reply. To
  avoid it, they would need to know that pi has extensions, which one,
  how to install it outside pi, and to list it by path.
- **The extension suits shipping.**
  - It is MIT and about 160 KB, with no dependencies.
  - It peers on pi only, and pi's extension loader aliases those imports to
    pine·trie's own pi wherever the extension is installed (S194).
  - It replaces only the `anthropic` provider, and passes a request
    through untouched unless its key is a subscription token (`sk-ant-oat`):
    an API key's request is not changed.
  - It reads one config file of its own, through `PI_CODING_AGENT_DIR`,
    which pine·trie already binds to its config directory, and calls no
    network beyond the request (S194).
- **It moves often.** It tracks Claude Code's version and Anthropic's
  checks: 3.1.0 to 3.4.3 is twelve releases between 2026-09-22 and
  2026-10-16. A person needs a fix the day it is published, without waiting
  for a pine·trie release.
- **It presents pine·trie's requests as Claude Code's** so that a
  subscription pays for them. Listed by hand, that is the person's choice;
  shipped and loaded, it is pine·trie's, and a machine run for others may
  need to forbid it.

**Decision.**

- **`@pinetrie/pi` depends on `@gotgenes/pi-anthropic-auth`, pinned
  exactly** as every other dependency is (`docs/05-stack.md`). Its folder
  is found by resolving its `package.json` from `@pinetrie/pi`, and the
  published package's build reads it from a list beside `deep.ts`'s, so it
  ships though no import names it (amending ADR-0189).
- **The model setup gives pi's loader its folder first,** before the
  listed packages, as pine·trie's own skills come after the person's:
  - unless a listed package's `package.json` names
    `@gotgenes/pi-anthropic-auth`. That copy loads in its place, so a
    person on a newer release runs one copy, never two. The extension's
    own source warns that two copies loaded together break sign-in and
    refresh;
  - unless `anthropic.subscription` is false.
- **`anthropic.subscription`, a flag**: whether a Claude subscription's
  requests are shaped as Claude Code's, by the copy pine·trie ships. True
  by default. The user's file sets it; the machine's file limits it, so
  `false` there turns it off for everyone. A project may not set it: it
  runs code on the host (ADR-0146).
- **The setup page says which copy shapes `anthropic`:** the shipped one
  with its version, a listed one with its path and version, or none, with
  why (turned off by you, or forbidden by the machine).
- **The setup page warns** when `anthropic`'s credential is a subscription
  and no copy loads: every run on an `anthropic` model will fail, and
  why.

**Consequences.**

- Installing pine·trie, signing in to a Claude subscription and naming an
  `anthropic/…` model is enough. `packages` is for what a person adds.
- A person who lists `pi-anthropic-auth` today keeps their copy, and it
  replaces the shipped one.
- The pin moves with pine·trie's releases. A fix the shipped copy lacks
  reaches a person who installs the newer release into a folder and lists
  it, as today.
- A listed package under another name that registers `anthropic`
  itself loads after the shipped copy. What pi makes of two
  registrations of one provider is not measured; such a person turns
  `anthropic.subscription` off.
- The extension's config file
  (`<config dir>/extensions/pi-anthropic-auth/config.json`, which names
  more providers to shape) works as it does for a listed copy.
- The published package grows by about 160 KB.
- A failed run's error is still shown only in its ask's line; this
  decision makes the failure rarer, not more visible.
- pi's loader loads the shipped copy from the published package's own
  dependencies under a global npm install and a global pnpm one, and each
  install holds one pi (S274). Gotcha: pnpm links a global package into
  place, so the extension's folder is resolved from a module's real path,
  as Node runs it, never from the link's.
- Still open, for S275 before the plan: that Anthropic accepts the request
  3.4.3 shapes for pi 0.99.2. S23 measured an older pair.

**Alternatives rejected.**

- **Shape the request in pine·trie's own provider:** pine·trie would track
  Claude Code's version and Anthropic's checks itself, which the extension's
  maintainer already does, twelve releases in four weeks.
- **Install it at the first subscription sign-in:** pine·trie installs
  nothing (ADR-0146). It would need the network at sign-in, and an install
  to manage and update.
- **Only warn on the setup page:** the person would still need to know
  about pi's extensions to fix it.
- **A caret range, so new installs take the latest release:** every
  other dependency is pinned exactly, so a pine·trie release runs what was
  tested. A person who needs a newer copy lists it.
- **Load it only when `anthropic`'s credential is a subscription:** signing
  in while the host runs would then need the loader again. The extension
  already passes every other request through untouched.
- **Ask pi to send the billing header itself:** the right end state, and
  then this decision is deleted. It is not ours to make, and until pi does,
  a subscription fails out of the box.
