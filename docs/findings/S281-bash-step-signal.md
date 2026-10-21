# S281 — A `DEBUG` trap under `set -T`, installed by `BASH_ENV`, tells the kernel which line bash runs; a short list of constructs, all visible in the parse, must fall back

- **Status:** Answered
- **Led to:** ADR-0204

Measured in a lane (Debian 13, bash 5.2.37) and, end to end with S283's
kernel side, in a QEMU guest on the lane VM's kernel (Linux 6.18.57) with
Alpine's bash 5.3.3.

## Brief

**Question.** S283's attribution needs the shell's tag to change as it
moves from one top-level statement to the next. pi runs a command as
`bash -c <command>`, stdin closed, stdout and stderr pipes, with an
environment its caller may add to. Can a `DEBUG` trap, installed through
`BASH_ENV` so the command's text is untouched, signal each step in time for
the kernel to retag the shell? In particular:

1. **Coverage.** Does the trap fire, in the top-level shell, before any
   process or output of every kind of top-level statement: simple
   commands, pipelines, `!`, `&&`/`||`, subshells, groups, `if`, `for`,
   `while`, `case`, `[[ ]]`, `(( ))`, function definitions and calls,
   `time`, `&`, assignments, `exec` redirections, heredocs, `eval`,
   `coproc`?
2. **Mapping.** From what the trap can see (`$LINENO`, `$BASH_COMMAND`),
   can the host name the top-level statement each signal belongs to? For
   statements on lines of their own, and for statements sharing a line
   (`a; b; c`).
3. **Transparency.** What does the command see that it would not have:
   `$?`, `PIPESTATUS`, `$_`, `$LINENO`, error messages and their line
   numbers, exit status, `set -e`, open file descriptors, `trap -p`,
   variables?
4. **Defeat.** Which commands can switch the signal off or corrupt it
   (`trap … DEBUG`, `set -T`, `extdebug`, closing its descriptor), and
   can the host tell from the command's parse before running it?
5. **Feeding, compared.** Does feeding bash one statement at a time do
   any of this better?
6. **Cost.** How much slower is a tight loop with the trap than without?

**Kill criterion.** A kind of top-level statement whose first process or
output comes before its signal, with nothing in the parse to tell the host
so; or a difference in what the command prints or does that the host
cannot rule out from the parse. Either means attribution could be wrong
without the host knowing, or a command could behave differently because
pine·trie watched it.

**Throw away.** The probe (`docs/findings/S281-bash-step-signal/`), unless
a plan builds on it. It runs in the lane, on Debian 13's bash 5.2.37: the
trap's behaviour is bash's, not the kernel's, so S283's kernel side is not
repeated.

## Answers

**The trap works, at line granularity, with one form of it:** installed
by `BASH_ENV`, under `set -T`, opening the marker file by path at each
signal. End to end, every output line but two went to its statement, and
the two are a construct the parse names. Every difference a command can
see is also one the parse names. The kill criterion is not met, on the
condition that the host runs a command whose parse holds any construct
listed below without the trap, and shows its output undivided.

The end-to-end run needed one change to S283's probe: on 6.18 the write
system call inlines `vfs_write` into `ksys_write`, so a kprobe there saw
10 of 55 marker writes. The marker is
taken at tmpfs's `shmem_file_write_iter`, reached through the file's
operations and never inlined.

### The trap

```sh
# BASH_ENV, sourced by bash -c before the command
unset BASH_ENV
set -T
trap '{ [[ -n ${FUNCNAME-} || -n ${BASH_SOURCE-} ]] ||
  printf "%s\t%s\t%q\t%.0s\n" "$BASHPID" "$LINENO" "$BASH_COMMAND" "$_" >>/tmp/marks; } 2>/dev/null' DEBUG
```

- **The kernel retags the task that writes the marker,** with that task's
  own count of signals, and every task it starts inherits it (S283's
  rule). The host finds signal k of task t as t's k-th line in the
  marker file, whatever order tasks' lines fall in.
- **`set -T`** makes subshells, `&` jobs, `coproc`s and command
  substitutions run the trap, from their own pid, before their first
  command.
- **The guard** skips functions (`FUNCNAME`) and sourced files
  (`BASH_SOURCE`): there, `$LINENO` counts the definition's or the file's
  lines, and their output belongs to the statement that called them,
  whose signal came first.
- **`$_` as `printf`'s last argument** (`%.0s` prints nothing) leaves `$_`
  as the trap found it: without it, `mkdir -p d && cd "$_"` breaks.
- **`>>path`, not an open descriptor**, so no descriptor shows in
  `/proc/self/fd` or can be closed by the command; **`2>/dev/null` on the
  group** hides the trap's own commands from `set -x`.
- **`unset BASH_ENV`**, so a `bash` the command starts does not trap: its
  processes inherit the tag of the statement that started it.

### Q1: coverage

`guest.py`: 49 statements, one of each kind, under real bash with S283's
attribution; a line names its statement (`S<n>`), and its bytes must carry
a signal whose `$LINENO` is in that statement's lines.

| trap | lines right | lines wrong |
|---|---|---|
| without `set -T` | 37 | 9: `( … )`, `{ … } &`, `coproc`, `( … ) &`, `time ( … )`, `( ( … ) )`, a background job's late line, and two redirection errors |
| with `set -T` | 44 | 2: `{ echo; } > /bad` and `( echo ) > /bad` |

With `set -T`, the late line of a job started two statements earlier went
to its own statement, as did `time`'s report, a function's output and a
subshell inside it, `. file`, a nested `bash -c`, `eval` of one line,
heredocs, process substitution both ways, `exec 3>&1` and a later
`>&3`, and both failing redirections of simple commands. The two left are
a **compound command with a redirection that fails**: bash applies the
redirection, and prints its error, before running the trap for anything
inside. The parse sees a compound command with redirections, so the host
can treat it and the statement before it as one.

`coverage.py` showed the same gaps without `set -T` in the lane's bash
5.2.37, counting signals from inside each statement rather than with the
kernel.

### Q2: mapping

- **Statements on lines of their own map exactly** by `$LINENO`: a signal
  falls in its statement's lines, multi-line ones included (an `if`
  over four lines, a heredoc).
- **Statements sharing a line share a `$LINENO`.** Telling them apart
  needs `$BASH_COMMAND`, which is bash's reprint of the command, not its
  source: `x=$(echo … >&2)` arrives as `… 1\>\&2`. Matching it to the
  parse needs bash's printer and gives up when one line repeats a command
  (`make; make`), so the plan should treat a line as the unit and show
  one line's statements together. Feeding cannot split a line either
  (Q5).
- **`eval` shifts `$LINENO`:** each line of an evaluated string counts
  from the `eval`'s line, so `eval` of a two-line string signals a line
  past its own statement. A literal of one line is safe; any other
  argument to `eval` is in the fallback list.

### Q3 and Q4: transparency and defeat

`transparent.py` ran 48 commands with no trap and with each trap, and
compared stdout, stderr and exit status. With the trap above, these
differ, and each is named in the parse, so the host runs them without it:

| the command uses | what differs |
|---|---|
| `trap` with no arguments, or `trap -p` | lists our trap |
| `set -v`, `set -o verbose` | prints the trap's text |
| `$-`, `set -o`/`set +o` listing, `shopt -o`, `SHELLOPTS` | show `functrace` on |
| `trap … RETURN` | the `RETURN` trap is inherited by functions under `set -T` |
| `BASH_ARGC`, or `PIPESTATUS` before any command | `BASH_ENV`'s sourcing sets them |
| `trap … DEBUG`, `set +T`, `set +o functrace` | turn the signal off |
| `BASH_XTRACEFD` set to another descriptor | would send `set -x`'s trace of the trap past the group's `2>/dev/null` (not run: `BASH_XTRACEFD=2` was the same) |
| `eval` of anything but a one-line literal | shifts `$LINENO` (Q2) |
| a compound command with a redirection | its redirection error comes before its signal (Q1) |

The same: `$?`, `PIPESTATUS` after a command, `$_`, `$LINENO`, error
messages and their line numbers, exit status, `set -e`, `set -u`,
`extdebug`, `set -x`, a user's `ERR` trap, `caller`, `BASH_SUBSHELL`,
`env`, `cat` and `read` on stdin, a nested `bash -c`, and every
descriptor. The two traps that came before this one each failed
something it fixes: an open descriptor (seen by `ls /proc/self/fd`,
closed by `exec 9>&-`, which with `set -e` then killed the command) and
`$_` (`mkdir -p d && cd "$_"`).

One thing the parse cannot see, not run: a command that **deletes the
marker file** (`rm -rf /tmp/*`). The next signal would recreate it under
a new inode, which the kernel does not watch. The observer reports the
unlink, so the host can fall back for the rest of the call at run time. The plan should put the
marker where a command is unlikely to reach it, and watch it.

### Q5: feeding, compared

Feeding would have none of the trap's gaps in Q1 (by reasoning, not
run): the shell is idle between lines, so whatever a line starts
inherits its tag. But it cannot be made transparent:

- **bash runs a whole line at once,** from `-c` or a script, so feeding
  splits no finer than `$LINENO` does.
- **Script on stdin** (`bash -s`): a command that reads stdin reads the
  rest of the script. `printf 'cat\necho after\n' | bash -s` prints
  `echo after` and never runs it. Any program may read stdin, so the
  parse cannot rule this out.
- **Script on another descriptor** (`bash /dev/fd/3`): bash's own
  messages change their prefix, from `bash: line 1:` to `/dev/fd/3: line
  1:`, in every error the command makes.

Feeding is dropped.

### Q6: cost

Each signal opens, appends to and closes the marker file. In the lane,
best of runs that varied up to fourfold, as the lane's machine is shared:

| loop | no trap | with the trap | signals |
|---|---|---|---|
| 20,000 arithmetic steps, builtins only | 0.03 s | 1–4 s | 60,002 |
| 2,000 command substitutions | 0.34 s | 0.44–0.50 s | 6,002–8,002 |
| 1,000 runs of `/bin/true` | 0.25 s | 0.54–0.56 s | 3,002 |

So a signal costs tens of microseconds. A loop of builtins runs one to
two orders of magnitude slower; one that starts processes, about twice
as slow. A
command racing a `timeout` could behave differently. That is a cost, not
a difference in what it prints; the plan should weigh it and measure it on
a real lane.

## Sources

`docs/findings/S281-bash-step-signal/`, which a plan would build on:

- `coverage.py`: Q1 and Q2 in the lane, with signals counted from inside
  each statement.
- `transparent.py`: Q3 and Q4, every case with no trap and with each trap.
- `guest.py`: the 49 statements, the two preludes, and the check of what
  the guest printed.
- `attr.bpf.c`, `attr.h`: S283's kernel side, tagged by marker writes,
  with the counters that found `vfs_write` inlined.
- `drive.c`: runs bash as pi does, under each prelude, and prints the
  stream, the events and the marker file.
- `init`, `Containerfile`, `run.sh`: the guest, as in S283, with Alpine's
  bash.
