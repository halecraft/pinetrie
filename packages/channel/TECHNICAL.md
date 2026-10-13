# `@pinetrie/channel`: technical notes

A held channel to a server process: one long-lived stream, one JSON line
per message. A lane's helper (`packages/pi/lane-helper.ts`) and lanehost's
server (`packages/lanehost/server.ts`) are its two servers. It declares
nothing (`workspace.test.ts`): both run it from pine·trie's install, mounted
read-only, on the lane runtime's Node.

## The envelope (`wire.ts`)

- **Requests:** `{ id, call, updates }`, and `{ abort: id }`.
- **Replies:** `{ ready, hello }` once, first; then, per call, any number of
  `{ id, update }` and one `{ id, result }` or `{ id, thrown }`.
- **Bytes cross as base64,** read from `this[key]` in the replacer:
  `Buffer`'s own `toJSON` runs first and would hand over `{ type, data }`
  (S43 item 2).
- **Errors cross as `{ name, code, message, path }`** at any depth, and are
  rebuilt as `Error`s with those fields: pi's environment returns its errors
  inside results (S44 item 5).

## The client (`client.ts`) and the server (`serve.ts`)

- **A call is a message, not a process:** 0.2 ms on the Mac through the
  lane VM's bridge, against 26 ms for a `docker exec` (S147).
- **The request goes before its abort:** the server ignores an abort for an
  id it has not been sent, so a call aborted while it waited would run.
- **The client closes by ending the server's input,** never by a signal:
  killing the `docker exec` process does not reach the server (S43 item 2).
  The server then aborts every call still running.
- **A server that exits fails every waiting call** with the tail of its
  stderr, and every later call at once.
- **Calls are answered concurrently,** each with its own `AbortSignal`.
- **Neither side dies of the other's going.** The server ignores an error
  writing to a client gone; the client passes over a line on stdout that
  is no reply (`docker exec` of a stopped container says so there),
  keeping it with stderr for the failure it precedes.

## `runCommand` (`run.ts`)

The server's side of running a command for its client: `execFile` with no
shell, stdout as text or bytes, killed by an abort. It never throws: a
program that cannot start is code -1, with why in stderr. A command that
exits before reading all its input leaves the server running: the write's
EPIPE is ignored, and its exit says what happened.
