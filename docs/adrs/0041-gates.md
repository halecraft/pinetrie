# ADR-0041 — Every gate runs in a lane with nothing from you: a browser in the image, a scripted model in the suites

- **Status:** Accepted
- **Area:** `packages/lanes/TECHNICAL.md`, `docs/05-stack.md`
- **Evidence:** S52
- **Amends:**
  - ADR-0034: the default image, and what a lane reaches on the host.

**Context.** Agents in lanes run the gates, and two of them could not pass
there. `e2e:browser` drove Chromium through a `playwright run-server` on the
Mac, a workaround for pi-jail's Seatbelt, which pine·trie no longer runs under.
From a lane, that server is reachable only at the gateway, and the Mac's
browser then opens the Mac's loopback, not the lane's, so the page under
test is out of reach. The same server lets a lane read the Mac's files and
open its loopback services (S52 item 5), which ADR-0034 counts as closed.

`e2e` and the browser suite's main section ran on a real model. A lane has
no key for it, so every run failed at once. Where a key exists, the checks
that need a run in progress raced the model's speed, and the model costs
money and time. The scripted sections raced too, on long scripted replies.

**Decision.**
- **The default lane image is pine·trie's set of known good tools:** Node 24,
  pnpm, git, jj, and now Chromium's headless shell with its libraries, in
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`. The browser is the build of the
  `@playwright/test` the app declares: the host resolves its version and
  passes it as a build argument, as it pins jj to its own. A project's own
  image gets no browser argument.
- **The browser suite launches its own browser.** No server, no endpoint.
- **`e2e` and `e2e:browser` run on the scripted model.** A reply is scripted
  or a standing answer. A check that needs a run in progress pauses its
  reply (`ScriptedModel.pause`) and resumes it when done, so the run lasts as
  long as the check needs.
- **What the model is given is checked offline,** by a scripted reply that
  echoes its context.
- **A real model is asked once,** in `e2e:live`'s own block, for a reply
  holding a requested token.

**Consequences.**
- Every lane's image carries the browser's 319 MB and 97 packages of
  libraries (S52 item 1; the image's size is not yet measured). The image is
  built again for each Playwright upgrade, which recreates every lane's
  container at its next start.
- A project on another Playwright version installs its own browser in its
  lane; the libraries are already there. That download does not survive the
  container's recreation.
- A project with its own `pinetrie.Containerfile` has no browser unless it
  installs one.
- On the Mac, the headless shell is installed once:
  `pnpm --filter @pinetrie/app exec playwright install chromium-headless-shell`.
- Nobody runs a Playwright server, so the route to the host it opened is
  closed.
- `@playwright/test` is declared once, by `apps/pinetrie`.

**Alternatives rejected.**
- The Mac's server with `exposeNetwork: "<loopback>"`: it reaches the page
  (S52 item 4) but keeps the route to the host, and needs a person to start
  it.
- `mcr.microsoft.com/playwright` as the base: Ubuntu, all three browsers,
  and a different base from the one the lane runtime is copied out of.
- Debian's `chromium` with `executablePath`: Playwright guarantees only its
  own builds, and the version would drift from pine·trie's Playwright.
- Browsers in a shared directory (ADR-0035): read-write, so one lane could
  replace a binary another runs; the libraries would still need the image.
- A model key granted to lanes: sharing secrets with lanes is its own
  question, and a real model would still be slow, cost money, and leave the
  checks racing.
- Longer timeouts or slower replies for the racing checks: they would race
  less often, not never.
