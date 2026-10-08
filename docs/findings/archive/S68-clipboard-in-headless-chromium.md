# S68 — can the browser suite read what a page copies, and hide the clipboard from it?

- **Status:** Answered

**Answers.**
1. **A page served at `http://127.0.0.1:<port>` is a secure context**
   (`window.isSecureContext` is `true`), so the browser suite's pages have
   `navigator.clipboard`.
2. **Without permissions, the clipboard refuses.** In a context made by
   `browser.newContext()`, `writeText` and `readText` both reject with
   `NotAllowedError` ("Write permission denied", "Read permission denied"),
   from a click handler too. So a page in such a context that copies takes
   the path where the clipboard refuses.
3. **With `permissions: ["clipboard-read", "clipboard-write"]`**, `writeText`
   resolves, from a click handler and from `page.evaluate`, and `readText`
   returns what was written.
4. **The clipboard can be hidden from page code and put back.**
   `navigator.clipboard` is a getter on `Navigator.prototype`.
   `Object.defineProperty(navigator, "clipboard", { value: undefined,
   configurable: true })` gives the instance its own property, so
   `navigator.clipboard?.writeText` is `undefined`. `delete
   navigator.clipboard` removes it, and the prototype's getter answers again.

**Why it matters.** The copy button on a message (`packages/client/copy.tsx`)
writes `node.text`, and selects the message's rendered text where there is no
clipboard. The browser suite checks both: its main page's context has the two
permissions, and hiding the clipboard as in (4) stands in for plain http,
where `isSecureContext` is false and the suite cannot make it so.

**Method.** A Node script launched Playwright's Chromium headless shell
(`chromium_headless_shell-1194`) against a page served by `node:http` on
127.0.0.1, once with no permissions and once with both, and called the
clipboard from `page.evaluate` and from a click handler.
