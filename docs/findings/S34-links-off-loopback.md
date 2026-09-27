# S34 — links to a thread, off loopback

**Answers.**
1. **A fragment survives the invite link's redirect** (measured). Opening
   `/?key=K#e=abc` is answered with a 302 to `/`, which sets the key cookie;
   the browser lands on `/#e=abc`. So an invite link can carry a thread.
2. **A key-less link followed from another site is refused, cookie or not**
   (measured: 403). The key cookie is `SameSite=Strict`, so a browser does not
   send it on a navigation that starts on another site: a link clicked in a
   chat or mail page in the browser. The same link typed into the address bar
   is admitted (200), and one opened with no cookie is refused (403).
3. **So off loopback, a link someone can open must carry the key.** The page
   cannot read it: the cookie is `HttpOnly`. The host already builds its
   invite links, key included, one per network address (`invites` in
   `apps/pineta/host/index.ts`); a page given those can make a link that works.
4. **The page's own address is not a link to share.** A page opened on the
   host machine as `127.0.0.1` would copy a link nobody else can open; the
   host's invite links name its network addresses.

## Why it was asked

Links to a thread (`PLAN-2026-09-27-links-and-directory`) are how a person sends
someone to a message. Off loopback, admission needs the key, and the cookie
that carries it after the first visit has rules of its own.

## Result

| case | status | lands on |
|---|---|---|
| invite link with `#e=abc` | 200 (after a 302) | `/#e=abc` |
| key-less link clicked on another site, cookie set | 403 | — |
| key-less link typed, cookie set | 200 | `/#e=typed` |
| key-less link, no cookie | 403 | — |

## Not tested

- A link opened from another application (a desktop chat or mail client).
  Browsers treat some of those as having no initiating site; it does not
  matter once links carry the key.
- Browsers other than Chromium.

## Method

`sandbox/s34-links/probe.ts`, copied into `apps/pineta/e2e/` to run (the
workspace resolves `@pineta/*` only from a package that declares them) and
deleted afterwards. It starts a host on `0.0.0.0`, so it has a key; serves a
page on `localhost` (another site than `127.0.0.1`) holding a key-less link;
and drives Chromium through the Playwright server at `localhost:3100`: the
invite link with a fragment, then the link on the other site, then the same
link typed, then a context with no cookie.
