# S274 — does pi's loader load `pi-anthropic-auth` from an installed pine·trie's own dependencies, and shape a subscription request with it?

- **Status:** Answered
- **Led to:** ADR-0192

**Question.** ADR-0192 ships `@gotgenes/pi-anthropic-auth` as a
dependency of the published package `pinetrie` and gives its folder to
pi's loader. S194 loaded the extension from an npm install in a folder of
its own. Installed globally as a dependency of `pinetrie`:
1. With npm (`npm install -g`) and with pnpm (`pnpm add -g`), does the
   extension's folder resolve from `packages/pi/` of the install?
2. Through the installed package's own `openLoader`, `openRuntime` and
   `registerProviders`, does it load with no error and register
   `anthropic`?
3. Does a request on an `anthropic` model then carry the token from
   pine·trie's `auth.json` and the billing header, where the same request
   without the extension does not?
4. How many copies of pi does each install hold, and does the extension
   run against pine·trie's?

**Kill criterion.** If, under either install, the folder does not resolve
from `packages/pi/`, the extension fails to load, or the request carries
no billing header, then ADR-0192 cannot ship it as a dependency as
written.

**Throw away.** The probe and its runner in
`docs/findings/S274-shipped-extension/`, against a tarball of
`pnpm run package`'s output with the extension added to its manifest by
hand, which is what the build would write. No request reaches Anthropic:
`fetch` is replaced, records what is sent, and answers 401. The OAuth
credential is fake and unexpired, so no refresh runs.

## Answers

Not killed. Under both installs the extension resolves, loads and shapes
the request, against the one pi pine·trie ships.

1. **It resolves from `packages/pi/` under both.** npm puts it at
   `lib/node_modules/pinetrie/node_modules/@gotgenes/pi-anthropic-auth`;
   pnpm in its virtual store, `.pnpm/@gotgenes+pi-anthropic-auth@3.4.3_…/`,
   linked beside `pinetrie`'s other dependencies. Gotcha: pnpm links
   the global `pinetrie` into place, and resolving from the link's path
   finds nothing. Node runs a module from its real path, so pine·trie's own
   resolution, from its module, works.
2. **It loads with no error and registers `anthropic`,** through the
   install's own `openLoader` and `registerProviders`. pi loads its
   `src/index.ts` from `node_modules` through jiti, which pi's extension
   loader uses, so Node's refusal to strip types there does not apply.
   `checkAuth("anthropic")` reports OAuth from pine·trie's `auth.json`.
3. **The request carries the billing header; the control does not.** On
   `claude-opus-5-5`, both send `authorization: Bearer` with the token from
   pine·trie's file, `user-agent: claude-cli/2.1.280` and the Claude Code
   betas. With the extension, the system starts with
   `x-anthropic-billing-header: cc_version=2.1.280.d7b; cc_entrypoint=sdk-cli; cch=…;`,
   then "You are Claude Code, …"; without it, only the latter.
4. **One pi in each install, 0.99.2,** and the extension's own resolution
   of `@earendil-works/pi-coding-agent` reaches that copy: npm dedupes the
   peer, and pnpm links the peer to `pinetrie`'s pi. `getAgentDir()` is
   pine·trie's config directory, from `PI_CODING_AGENT_DIR`.

## Method

`docs/findings/S274-shipped-extension/run.sh <scratch>` builds the package
(`node scripts/package.ts`), adds `"@gotgenes/pi-anthropic-auth": "3.4.3"`
to its manifest, packs it, and installs the tarball with `npm install -g
--prefix` and with `pnpm add -g` under a `PNPM_HOME` of its own, on Linux
(Node 24.22, npm 11.19, pnpm 10.18). `probe.mjs` then runs against each
install in a clean environment: a fake home, pine·trie's config directory
as `PI_CODING_AGENT_DIR`, a fake OAuth credential, and `fetch` replaced.
It makes one request through a runtime with the extension's
registrations applied, and one through a second runtime over the same
files without them. `result-npm.json` and `result-pnpm.json` hold what
each printed; `copies-npm.txt` and `copies-pnpm.txt` count the copies of
pi each install holds.

## Limits

- Linux only. The Mac's npm and pnpm lay out a global install the same
  way, but it was not run there.
- That Anthropic accepts the shaped request is S275's question.
