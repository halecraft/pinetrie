# S47 — owning a SQLite file through `node:sqlite`

Kyneta v4's `SqliteAdapter` must own its database file: the store reuses one
seat on every open, which is sound only if no other connection writes the
file. Kyneta's own adapters (`fromBetterSqlite3`, `fromBunSqlite`) take
ownership in a private `own()`: `PRAGMA busy_timeout`, `PRAGMA locking_mode =
EXCLUSIVE`, then `BEGIN EXCLUSIVE; COMMIT`, and read a refusal as
`code === "SQLITE_BUSY"`. Pineta wraps Node's built-in `node:sqlite` by hand
(`apps/pineta/host/store.ts`), so it copies that step, and nothing had
measured it on Node. Node 24.

**Answers.**

1. **A second connection is refused while the first owns the file**, whether
   it tries to own it too or only opens it `readOnly`. This holds on a fresh
   file with nothing written yet: `BEGIN EXCLUSIVE; COMMIT` alone takes the
   lock, and exclusive locking mode keeps it.
2. **`node:sqlite` reports the refusal as** `{ code: "ERR_SQLITE_ERROR",
   errcode: 5, errstr: "database is locked" }`. `errcode` 5 is `SQLITE_BUSY`.
   Kyneta's check, `code === "SQLITE_BUSY"`, is better-sqlite3's shape and
   never matches here: read `errcode`.
3. **The constructor's `timeout` option is the busy timeout:** with
   `timeout: 250`, the refusal came after 287 ms. A later `PRAGMA
   busy_timeout` replaces it.
4. **Closing the owner releases the file at once:** a new connection owned it
   in 0 ms and read what the first wrote. Closing a closed `DatabaseSync`
   throws `ERR_INVALID_STATE`.
5. **`Runtime.shutdown()` closes the store it was given**
   (`packages/exchange/src/runtime.ts` in Kyneta), so a host must not close
   its store again.
6. **A missing named export is refused before any code runs.** Node loads an
   ES module only once every named import resolves: `import { b } from
   "./m.mjs"`, where `m.mjs` exports only `a`, throws `SyntaxError` at link
   time, and the module's first statement never runs.

## What this means for the plan

- `openStore` owns the file with the constructor's `timeout` and the same two
  statements, and reads a refusal by `errcode === 5`.
- The e2e suite can no longer read the database file beside a running host:
  it reads through the `Store` instead.
- The host's environment gate (`checkEnvironment({ hasStepInPlace })`) could
  never fail: the host imports `stepInPlace` by name, so a build without it
  is refused at load. It is deleted.
