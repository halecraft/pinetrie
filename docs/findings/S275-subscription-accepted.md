# S275 — does Anthropic accept a subscription request that `pi-anthropic-auth` 3.4.3 shapes for pi 0.99.2?

- **Status:** Open (waiting for a run with a real subscription)
- **Led to:** ADR-0192

**Question.** ADR-0192 ships `@gotgenes/pi-anthropic-auth` 3.4.3 with
pine·trie's pi, 0.99.2. S23 found that Anthropic answers a shaped
subscription request and refuses a bare one, with older versions of
both. S274 found that 3.4.3 adds its billing header to pi 0.99.2's
request. With a real Claude subscription signed in to pine·trie:
1. Does a request on `anthropic/claude-opus-5-5` with the extension's
   registrations get a reply?
2. Is the same request without them refused, and with what?

**Kill criterion.** If the shaped request is refused, the pinned pair
does not work, and ADR-0192's pin needs another version of the extension
or of pi before it ships.

**Throw away.** `docs/findings/S275-subscription-accepted/probe.mjs`,
run on the host's machine: it needs a subscription credential in
pine·trie's `auth.json`, and no lane holds one. It makes two requests of
at most 32 output tokens, through a pine·trie clone's own `openLoader`,
`openRuntime` and `registerProviders`, with the extension from an npm
install of its own (as S194's `ours-installed`, which S274 found loads
and shapes as the shipped copy does). It reads and may refresh the real
`auth.json`, never a copy: a refresh rotates the refresh token. It prints
no token.

Run, from anywhere on the Mac:

```sh
npm install --prefix /tmp/s275 --legacy-peer-deps @gotgenes/pi-anthropic-auth@3.4.3
node <clone>/sandbox/S275/probe.mjs <clone> /tmp/s275
```

A dry run in a lane, with a fake credential, reached Anthropic and was
refused as expected for both: 401 "OAuth access token is invalid."
