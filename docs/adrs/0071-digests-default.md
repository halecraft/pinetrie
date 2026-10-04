# ADR-0071 — Digests are on by default; the user config turns them off

**Status:** Accepted. Amends ADR-0056 (a summary written by a model is no
longer opt-in). Amended by ADR-0075: only a long ask is digested, so a short
one costs no request. Amended by ADR-0077: a short ask's end costs a request
again, for its verdict alone.

**Context.** ADR-0056 made each ask's digest opt-in: only
`{ "digests": { "enabled": true } }` in `~/.config/pineta/config.json` turned
it on. A person who never edits that file never sees a summary, and does not
know they exist. A digest costs a model request per ask (fewer while no one
reads the running thread), on the model commit messages use, and puts no
tokens in any agent's context.

**Decision.**
- **Digests are on unless `{ "digests": { "enabled": false } }`** is in the
  user config. Any other value, a missing key or a missing or malformed file
  leaves them on (`decodeDigestConfig`, `packages/marginalia/digest.ts`).
- Everything else in ADR-0056 about digests stands: when they are asked,
  what goes out, the `ask-digest` skill, and that no agent reads them.

**Consequences.** Every host asks for digests unless told not to, the
suites' hosts included. A scripted model answers a digest request as it
answers a commit message's. Someone paying per token pays for the
requests until they turn digests off.

**Alternatives rejected.** Keeping digests opt-in (a feature hidden behind a
config key few people find). Turning digests off for a malformed `digests`
value as well as for `false` (only an explicit `false` says the person wants
them off; anything else is a mistake, and the default is the safer reading).
