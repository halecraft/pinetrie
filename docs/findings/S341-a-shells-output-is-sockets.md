# S341 — Node gives a `bash` call's shell sockets, which the observer never sees; two FIFOs the helper makes are pipes it attributes

- **Status:** Answered
- **Led to:** ADR-0204

Measured in a lane on 2026-10-23, against the lane VM's kernel (Linux
6.18.58) through the outer host's observer, version `cff0127e4135`, whose
hello said `attribution: {on: true}`.

**Question.** ADR-0204's observer attributes the bytes written to a run's
output pipes. Inside a lane whose observer had attribution on, every `bash`
call of the host suite's `tools` scenario still showed undivided, its
stored split absent. Why, and what gives the shell pipes?

1. What are a `bash` call's descriptors 1 and 2?
2. Does the join see the run's statement signals, its output, or neither?
3. Does a FIFO's write go through the function the observer attributes?
4. With two FIFOs as the shell's stdout and stderr, does the call split?

**Kill criterion.** A FIFO's writes bypass `anon_pipe_write`, or the call
still does not split.

**Throw away.** The probe's edits to `lane-shell.ts`, `bash-tool.ts` and
`statement-join.ts`, and its logs.

## Answers

1. **Sockets.** The helper spawns the shell with Node's `stdio: ["ignore",
   "pipe", "pipe"]`, as pi's own `exec` does. libuv makes each of those a
   Unix socket pair, not a pipe: a child's `readlink /proc/self/fd/1`
   printed `socket:[557382]`, its fd 2 `socket:[557384]`. S304 measured
   the helper's `spawn` for the bytes it keeps, and the kernel's
   attribution with a C driver whose `pipe()`s are pipes; the two were not
   measured together.

2. **The signals, and no output.** A four-statement call's join started
   from `{on: true}`, received a `statement` event for each of its four
   statements, and not one `output` event. It ended `count-mismatch`, 15
   bytes received and none placed. The observer finds a run's output pipes
   at its first signal from descriptors 1 and 2, keeping each only if its
   inode is a pipe, and attributes only pipe writes: on sockets it has
   nothing to attribute.

3. **Yes.** In Linux 6.18's `fs/pipe.c`, a FIFO's `write_iter` is
   `fifo_pipe_write`, which calls `anon_pipe_write`, the anonymous pipe's
   own, so the observer's kprobe sees it. A FIFO's open file holds the
   same `pipe_inode_info`.

4. **Yes.** The helper made two FIFOs with `mkfifo`, opened each one's read
   end non-blocking and its write end, removed the names, and gave the
   write ends to the shell as its stdout and stderr, reading the others
   through `net.Socket`. The call `echo one`, `{ sleep 0.2; echo late; } &`,
   `echo three`, `wait` was stored as `one`, `late`, `three` and nothing:
   the background job's late line under the statement that started it.
   The rest of the scenario passed as before.

**What the command sees.** A pipe where pi's own tool gives a socket: `[ -p
/dev/stdout ]` is true, as it is in `cmd | cat`, and the buffer is a pipe's
64 KiB. The bytes are the same. `readlink /proc/self/fd/1` names a deleted
file rather than `pipe:[n]`.

**What was read rather than run.** Linux v6.18 `fs/pipe.c`
(`fifo_pipe_write`, `pipefifo_fops`, `pipeanon_fops`); libuv's process
spawning, which makes a child's piped stdio with `socketpair`; pi 0.99.2's
`dist/core/exec.js`, which spawns with `stdio: ["ignore", "pipe", "pipe"]`.
