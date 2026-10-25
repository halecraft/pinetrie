# ADR-0204 — A tool call's output is attributed to the top-level statement that wrote it: a patched bash signals each statement, the observer tags every byte by its writer, and pine·trie owns that bash: one pinned version, static against glibc, in every lane's runtime

- **Status:** Accepted (Duane, 2026-10-20)
- **Area:** `docs/01-architecture.md`, `docs/06-interface.md`,
  `packages/lanes/TECHNICAL.md`, `packages/lanehost/TECHNICAL.md`,
  `packages/pi/TECHNICAL.md`
- **Evidence:** S283, S281, S298, S304, S300, S341
- **Amends:**
  - ADR-0064: the lane runtime also carries pine·trie's bash, one pinned
    version, static against glibc, off `PATH`, as the shell of tool calls.
  - ADR-0123: a row's output is shown under the statement that wrote it, when
    its bytes are attributed; undivided otherwise.
  - ADR-0135: the observer also tags every task with the statement it was
    started in, and attributes each byte of a run's output pipes to its
    writer's tag; it still stops no call.

**Context.**

- **A tool call is often several commands.** An agent writes `cd x && a`,
  `b | head`, `c` as one call, and the card shows one block of output.
  Which line printed what, or printed nothing, is guesswork.
- **Splitting the output must never change it.** Markers in the stream
  can be printed by a command too, and statements inserted between the
  agent's change `$?`, `PIPESTATUS` and `$_`. A split that can be wrong
  must say so and show the output whole.
- **Output belongs to the process that wrote it, not the moment it
  arrived.** A background job's late lines belong to the statement that
  started it. Only the kernel sees which process wrote each byte, so the
  attribution is the observer's: S283 attributed 3.8 MB across six routes
  into a pipe, with writers of different steps interleaving, without one
  byte wrong.
- **The kernel needs to be told when the shell moves to the next
  statement.** A `DEBUG` trap can tell it (S281), but only per line, with a
  list of constructs to fall back on, visibly (`trap -p`, `$-`), and any
  process can forge its signal. A patched bash tells it from inside bash's
  own execution, for every statement, invisibly, and unforgeably (S298).
- **Which bash runs a tool call is already pine·trie's choice.** pi runs
  the first `bash` on `PATH`, else `sh`, and pine·trie already carries its
  own jj, rg, fd and sd into every lane, whatever the image (ADR-0064).
- **Matching each image's bash costs a build per bash version and C
  library**, a probe of each image and a check that the build behaves
  like the image's: a static musl bash differs from a glibc image's even
  with no locale set, and each bash release differs from the last
  (`patsub_replacement` in 5.2, new `shopt` options in 5.3) (S298). All of
  that buys sameness with a shell whose version a project rarely chose.

**Decision.**

- **The observer attributes every byte of a run's output pipes to its
  writer's tag**, in the pipe's own order: a write through
  `anon_pipe_write`'s copies; every other route (`splice`, `sendfile`,
  `vmsplice`, `tee`) through the buffers its holder adds before
  `pipe_unlock` or `pipe_wait_writable` (S283). The list of entry points
  is the kernel's, checked for each kernel version the observer supports.
  The host checks that a call's attributed bytes add up to the bytes it
  read; where they do not, it shows the output undivided.
- **A run's output pipes are found where the run is**: its first task's
  descriptors 1 and 2 at its `exec` with `PINETRIE_RUN`, each kept if its
  inode is a pipe (S304). Nothing is registered for them.
- **A call's stdout and stderr are pipes the helper makes**, not what
  Node gives a child, which is Unix sockets the observer never sees
  (S341). The runtime carries a static `mkfifo` beside its bash; the
  helper makes two FIFOs with it, opens both ends of each, removes the
  names, and gives the write ends to the shell. A FIFO's writes go through
  `anon_pipe_write`, as an anonymous pipe's do. Where the pipes cannot be
  made, the call runs on sockets and shows undivided.
- **The host stores how every call that started reads, not only a split**:
  its verdict (the split, or undivided with the reason the join found) and
  what it wrote to stderr, as ranges of its text. The reasons are one list,
  and the join's pure fold decides each, the flush's too: a call whose
  flush failed is undivided as `flush-failed`, never split. A call on
  sockets says so at its start, and is undivided as `no-pipes`, not left
  to read as a byte count that did not add up.
- **A detail that shows a command's output whole says why**, in one line,
  for a command of two or more statements; a single statement's output is
  shown as any call's. The summary says nothing new, so a row keeps its
  height. A host whose observer cannot attribute output logs why once, at
  start.
- **stderr is marked in what the row draws, never in what the model
  reads**: the capture keeps each character's pipe beside pi's view, and a
  mark that cannot be placed exactly through pi's cut and sanitising is
  dropped, never a character moved.
- **The statement is a field of the run tag the observer already keeps**
  for every task (ADR-0135). A task takes its parent's tag at birth, and
  keeps it across `exec`, a move or a new namespace, so a script, a nested
  shell and a background job write for the statement that started them.
  Only a signal changes it, and a task the maps cannot hold is counted
  against its run, as now.
- **The shell signals each top-level statement.** pine·trie's bash marks
  the top-level statements of its `-c` string (the leaves of its `;`, `&`
  and newline connections), and on entry to each, before its redirections
  and before any fork, calls `prctl` with an option no kernel implements,
  carrying the statement's ordinal and line. The observer takes the
  signal at `security_task_prctl` and retags the caller.
- **Only the shell may signal.** The kernel takes a signal from the
  registered shell, from its `exec` of bash, and from tasks forked from
  one that may, until they `exec` again. A program, a script or a nested
  bash cannot move output to another statement.
- **A signal names its statement by ordinal**, which unbash's parse
  agrees with; its line is a cross-check, and a signal whose line falls
  outside its statement makes the call's output undivided.
- **pine·trie owns one bash.** One GNU release with its official
  patches, pinned by checksum, with pine·trie's patch applied as edits at
  anchors, each of which must match exactly once, so a release that moved
  one fails the build. The patch is ours, in the repo, under bash's
  licence. A new version is a deliberate bump, gated like any change.
- **It is static, against glibc**, built in a stage of pine·trie's default
  image (Debian, glibc) for the machine it is built on, and carried in the
  lane runtime off `PATH`. On a glibc image it is as fast as the image's
  own bash, and reads the image's locale data as that bash does (S300).
  On an image without glibc's locale data, a project's musl image, it
  reads text as bytes in every locale.
- **Every `bash` call runs in it**, on every image, with or without the
  observer: without one, its signals go nowhere and the output is
  undivided. The image's `bash` stays the image's, for every script and
  nested shell.
- **pine·trie makes the `bash` tool**, as it makes `grep`, `find` and
  most others (`TOOLS`, `packages/pi/tools.ts`); pi makes `read`,
  `write` and `edit` still. It keeps pi's name, parameters and
  description, and the shape of pi's result (the tail of the output,
  and a note naming the full output's file when it is cut), so the model
  meets the tool it knows. Its `execute` asks the lane's helper to run
  pine·trie's bash and stream back each raw chunk with the descriptor it
  came from. From those chunks one capture of pine·trie's, built on pi's
  exported truncation and sanitising, makes both the model's view and
  each statement's. pi's own `exec` keeps serving the other tools. S304
  showed the bytes are there to take, and that matching pi's view from
  outside pi takes a copy of its logic: owning the tool makes the view
  ours to define, so no copy has to stay pi's.

**Consequences.**

- **What people see:** a call's output under each of its statements,
  including its failed redirections, subshells and late background lines;
  or, where the attribution cannot be trusted, the output whole, with a
  line in the detail saying why. What a command wrote to stderr is in a
  colour of its own once the call has returned; live output is unmarked
  until then.
- **The same shell in every project:** the agent can be told which bash
  it has, and an image with no bash gets one.
- **A command's stdout and stderr are pipes, where pi's own tool gives
  sockets:** the bytes are the same, and `[ -p /dev/stdout ]` is true, as
  in `cmd | cat`. A program that tells the two apart sees what a shell
  pipeline gives it (S341).
- **A tool call's outer shell can differ from the project's own bash**:
  in its version; on a project's musl image, in reading text as bytes
  and in warning of an `LC_ALL` the image lacks; in `$BASH`; and in
  `enable -f`, which reports that dynamic loading is not available.
  Scripts the call runs use the image's bash.
- **Building pine·trie's image compiles bash once**, about a minute and
  Debian's compiler toolchain, kept in the build cache until the pin
  changes.
- **A trap's output goes to the statement running when the trap fires**,
  not the one that set it.
- **stdout and stderr stay two pipes**, each attributed exactly; how they
  interleave stays pi's.
- **The host joins two streams**: output chunks from the helper, and
  attributions from the observer. Output not yet attributed waits, or shows apart,
  until its attribution arrives.
- **The attribution suite gates every bash bump and kernel change**: a
  guest on the lane VM's kernel running S298's 64 statements, its
  forgeries and the shell's `exec`.
- **pine·trie maintains its `bash` tool**: about a hundred and fifty
  lines and its capture. What pi later changes in its own bash tool does
  not reach it, and the tool can tell the model more than pi's does,
  should a later decision want it to.
- **A prebuilt binary can replace the build later**, from the same patch,
  if the image build proves too slow.

**Alternatives rejected.**

- **Lane-wide reasons only on the setup or Machine page:** the observer's
  hooks are no setting, and a missing split is noticed on the card. The
  card's line is short, and the host's log names the hook.
- **The reason in the summary's footer:** a row with nothing hidden has no
  footer, so the reason would add a line when the result arrives.
- **stderr marked by line:** a line can hold both pipes' output; ranges
  are exact.
- **stderr marked live:** live output is one text stream per call and per
  statement, and marks would need another beside each; the row takes its
  marks with its result, at the same height.
- **stderr in pi's result `details`:** that is pi's shape, kept so the
  model meets the tool it knows; the stored record is pine·trie's.

- **Markers in the output, between statements:** no marker can be
  guaranteed absent from a command's own output, and an inserted
  statement changes `$?` and `PIPESTATUS`.
- **One bash per statement:** `cd`, variables, options, traps and jobs do
  not carry from one to the next.
- **Feeding bash one statement at a time:** bash runs a whole line at
  once; with the script on stdin, a command that reads stdin swallows the
  rest of it, and with it on another descriptor, every error message
  changes its prefix (S281).
- **A `DEBUG` trap through `BASH_ENV` under `set -T`:** per line only, a
  list of constructs to fall back on, visible to `trap -p`, `$-` and
  `set -v`, forgeable by any process that writes its marker, and tens of
  microseconds a command (S281).
- **Getting the bytes from pi's view:** pi mixes both pipes in the order
  their chunks arrive, decodes, sanitises and keeps the tail, so which
  pipe, which order and which byte offset a stretch of text came from
  are gone (S304).
- **An `exec` of the helper's own, porting pi's capture** (S304): it gave
  pi's view on every case tried, but only a test kept the copy pi's.
- **Patching pi** (pnpm's `patchedDependencies`), for an `onChunk`
  callback on `exec` and an exported `OutputCapture`: pi's maintainers
  cannot take the changes, so the patch would be carried across every pi
  upgrade, and made outside a lane, as it rewrites the lockfile.
- **A group per statement, `{ …; } > step-N`:** an `exec 4>&1` inside one
  keeps its pipe, and the timeline across statements is lost.
- **A patched bash built for each image's own bash** (its version and C
  library, read by `checkImage`'s probe, built per image and checked for
  sameness in it): a matrix, a probe and a check per image, for sameness
  with a shell the project rarely chose.
- **Uprobes on the image's own bash:** sameness by construction, but the
  kernel would read bash's memory by its struct layouts, per version; the
  patch keeps that coupling in bash's own source.
- **Owning bash, static against musl:** the same in every image, but up
  to 2.7 times slower than a glibc image's bash at appending to a string
  and 2.2 times at globbing; mimalloc fixes the allocation-heavy cases
  but not those, and bash's own allocator does not work on musl (S300).
- **Two builds, one per C library:** exact on a project's musl image too,
  for a second build and its selection per image. pine·trie's own image
  is glibc, and on a musl image the difference is how text is read in a
  locale, so one build serves.
- **Statements told apart by an id the system already has:**
  - a process id names one process, not its descendants, and is reused;
  - a process group or session per statement can be left by `setsid` or
    any daemon, and pi stops a call by killing its process group, which
    statements in groups of their own would survive;
  - a cgroup per statement shows in `/proc/self/cgroup`, and nested lanes
    run under rootless Docker with no cgroup delegation;
  - a PID namespace per statement gives each statement other process
    ids, which breaks `$!`, `kill` and `wait`.
- **zsh:** its `DEBUG` trap has the same limits, and it is not bash: every
  command the model writes would mean something else.
- **No eBPF, with the patched bash giving each statement its own pipes:**
  the time order across statements is lost, and descriptors saved with
  `exec` point at the wrong statement.
