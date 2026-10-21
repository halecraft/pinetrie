# S298 — A patched bash signals every top-level statement exactly and unforgeably; it behaves like the image's bash only when built against the image's C library and at the image's bash version

- **Status:** Answered
- **Led to:** ADR-0204

Measured end to end in a QEMU guest on the lane VM's kernel (Linux
6.18.57) with S283's kernel side, and, for sameness, in the lane (Debian
13) and in Docker images of Debian 11, Ubuntu 24.04 and Alpine 3.23.

## Brief

**Question.** S281's `DEBUG` trap signals lines, not statements; leaves a
list of constructs to fall back on; and can be forged by any process that
appends to its marker file. Two kernel-side ways to signal from bash's own
code would be unforgeable: a patched bash, shipped by pine·trie, that
signals each top-level statement of its `-c` string by a system call; or
uprobes on an unmodified bash's `execute_command_internal`. In
particular:

1. **Coverage.** With the patch, does every top-level statement, two on a
   line included, tag all it prints, its forks', its background jobs' and
   its failed redirections' output, without the fallback list?
2. **Identity.** Can the host name a signal's statement? The patch sends
   its ordinal among the string's top-level statements and its line: do
   they agree with unbash's parse?
3. **Forgery.** If the kernel takes a signal only from the shell and its
   fork-only descendants, can anything the command runs forge one: a
   program that makes the same system call, a nested bash (the patched
   one included), a subshell? Does a program bash `exec`s without forking
   keep its statement's tag?
4. **Sameness.** Does pine·trie's bash, static and built against musl,
   behave like the image's (Debian 13's bash 5.2.37, glibc)? Glob order,
   character classes and `printf` in a UTF-8 locale, `~user`, error
   messages, `$BASH_VERSION`.
5. **Uprobes, compared.** Can a uprobe on an unmodified bash
   (Alpine's 5.3.3, Debian's 5.2.37) read each command node's line and
   type by its exported symbol, and what would it take to find the
   top-level statements?
6. **Cost** of a signal, against S281's trap.

**Kill criterion.** A statement whose output carries another statement's
tag; a signal from a process the command started that the kernel accepts;
or a difference in behaviour between pine·trie's bash and the image's that
a command written for bash would meet and the host cannot rule out.

**Throw away.** The probe (`docs/findings/S298-a-bash-that-signals/`),
unless a plan builds on it: the patch, the guest and the checks. It runs
in a QEMU guest on the lane VM's kernel, as S283 and S281 did, and the
sameness check in the lane.

## Answers

**The patch meets everything but sameness.** Every line went to its
statement, two statements on a line included; every forgery was refused;
the ordinals agree with unbash's parse. A static musl build behaves
differently from a glibc image's bash even with no locale set, which meets
the kill criterion for that build. A static glibc build matches glibc
images' bash from glibc 2.31 to 2.41 in every case but bash's own version
differences, and the musl build matches Alpine's the same way. So the
patch holds only if pine·trie ships a build for the image's C library
**and** at the image's bash version, or else signals from the image's own
bash by uprobes (Q5), which this spike did not build to the end.

### The patch

`bash.patch`, 137 lines against GNU bash 5.2.37, in three places:

- `builtins/evalstring.c`: when `parse_and_execute` runs the `-c` string
  itself (`parse_and_execute_level == 1`, its source `-c`, not a command
  substitution, not a trap), it marks the parsed command's top-level
  statements: the leaves of its chain of `;`, `&` and newline
  connections.
- `execute_cmd.c`: on entry to `execute_command_internal`, a marked node
  clears its mark and calls `prctl(PT_PRCTL, ordinal, line)`, an option no
  kernel implements (`EINVAL`; `errno` is restored). Entry comes before
  the node's redirections and before any fork, so all a statement does
  inherits its tag. The mark is cleared first, so a child forked from the
  statement never signals it again.
- `command.h`: one flag bit, `CMD_PT_TOP`.

**Its line must be read per type.** `struct command`'s own `line` is never
set (`make_command` leaves it as `xmalloc` gave it): the first run's
signals carried 0 or garbage. Each type keeps its line in its own struct
(`Simple->line`, `For->line`, …), and `if`, `while`, `{ }`, `coproc` and
`&&` chains keep none, so `pt_line` takes their first inner command's. A
simple command's line is where its words end: an `eval` whose quoted
string spans lines 25–26 reports 26.

**bash 5.2's old-style C needs `-std=gnu17` under gcc 15** (C23 is the
default), and `-Wno-error=implicit-function-declaration` for its termcap.

### The kernel side

S283's attribution, with signals taken by a kprobe on
`security_task_prctl` (prctl's first act, for every option), and one
rule: **a task may signal if it is the registered shell, from its `exec`
of bash, or a task forked from one that may, until it `exec`s again.**
Every task inherits its parent's tag at birth and keeps it across `exec`.

### Q1–Q3: coverage, identity, forgery

`guest.py`'s command: 64 top-level statements, every kind S281
tried, plus three with a failing redirection on a compound command, two
lines of several statements, a stock and a patched nested bash, and three
forgeries.

| | |
|---|---|
| lines right | 62 of 62, every byte tagged (671 of 671) |
| signals taken | 64, all from the shell, ordinals 1–64 in order |
| signals refused | 6: the nested patched bash's 3 (it `exec`ed) and `forge`'s 3 (run directly, in a subshell, in the background) |
| forgers' output | under their own statements |
| the last statement, `/bin/echo` | `exec`ed by the shell without a fork (written by the shell's pid), and kept its tag |
| unbash | 64 top-level statements; every signal's line inside unbash's statement of the same ordinal (`unbash-statements.ts`) |

So the fallback list S281 needed is gone: compound commands whose
redirections fail, subshells, `&`, `coproc`, `time ( … )`, `eval`,
`.`, functions, statements sharing a line. With the patch's signals
removed (a run that built bash without the patch, by mistake), every line
failed and the forgeries were still refused, so the check can fail.

**A trap's output goes to the statement running when it fires,** not the
one that set it: `trap 'echo S1 trap' EXIT; echo S2; /bin/echo S3` tags
`S1 trap` with statement 3. The patch could tag a trap's actions with the
statement that set the trap, by remembering its ordinal in `trap` and
signalling it before the action. Not built; the plan should decide which
the person expects.

### Q4: sameness

`same.py` and `cross.py`: 48 cases (glob order over names like `B`, `a`,
`á`, `ß`, `_x`; `[[:alpha:]]`; `${#x}`; `${x^^}`; `printf "%'d"` and
`%q`; `$'\u00e9'`; `~root`; error messages; `shopt`; `$MACHTYPE`; …) under
no `LANG`, `C.UTF-8` and `en_US.UTF-8`, each run by the image's bash and
by ours.

| image | its bash | ours | differences, beyond `$BASH_VERSION` and `enable -f` |
|---|---|---|---|
| Debian 13 | 5.2.37, glibc 2.41 | musl | **with no `LANG`:** `[[:alpha:]]`, `[[:upper:]]`, `${#x}`, `${x^^}`, `${x,,}`, `case` classes, `printf %q`, `$'\u…'`; **`en_US.UTF-8`:** glob order, `printf "%'d"`; `$MACHTYPE` |
| Debian 13 | 5.2.37, glibc 2.41 | glibc | none |
| Ubuntu 24.04 | 5.2.21, glibc 2.39 | glibc | none |
| Debian 11 | 5.1.4, glibc 2.31 | glibc | `${x//b/&}` (5.2's `patsub_replacement`), the `shopt` list. `en_US.UTF-8` untested: the mirror 404'd the `locales` package |
| Alpine 3.23 | 5.3.3, musl | musl | the `shopt` list (5.3 adds options), `$MACHTYPE`'s vendor |

- **The C library is the big difference, and musl's shows with no locale
  at all**, the default in most containers: musl reads text as UTF-8
  where glibc's `C` locale reads bytes. A static glibc build loads the
  image's own locale data and agreed with three glibc versions.
- **The bash version is the other.** A 5.2 build differs from a 5.1 image
  in `patsub_replacement`, and from a 5.3 image in `shopt`; each release
  has its list. So a build must match the image's bash version as well,
  or the difference is pine·trie's.
- **`enable -f`** reports `dynamic loading not available` in a static
  build, with exit status 2, not 1. That also closes the one route by
  which a command could load code into the shell and forge a signal. The
  parse sees `enable -f`.
- Static glibc warns that `getpwnam` and friends need the build's
  glibc's NSS at run time; `~root` was the same everywhere, as glibc 2.34
  and later have `files` built in.

### Q5: uprobes, compared

- **Symbols:** Debian's 5.2.37 and Alpine's 5.3.3 both export
  `execute_command_internal`, `parse_and_execute`,
  `parse_and_execute_level` and `global_command` as dynamic symbols (for
  loadable builtins), and `struct command` and `struct connection` have
  the same layout in 5.2 and 5.3.
- **Reading nodes:** a uprobe on Alpine's stock bash, attached by name,
  read 140 nodes on the same command, each with its type (87 simple, 23
  connections, 10 groups, 10 subshells, …). Their `line` was 0 or
  garbage, as in the patch, so a uprobe needs `pt_line`'s per-type reads
  too.
- **Finding the top-level statements, not built:** a uprobe would mark
  them where the patch does, at `parse_command`'s return with
  `parse_and_execute_level` (read at its symbol's address in the shell's
  mapping) equal to 1, walking `global_command`'s chain of connections;
  and take signals only in the registered shell's own task, as a command
  substitution's child parses at level 1 too. Each is a read of bash's
  memory by layout, per bash version, instead of a patch per version.

So uprobes would give the patch's coverage with the image's own bash,
hence perfect sameness, at the cost of reading bash's internals from the
kernel. The patch gives the same coverage with code in bash, at the cost
of a build per C library and bash version.

### One patch for every version

`bash.patch` is a context diff against 5.2.37 and applies to nothing
else: its surrounding lines differ in 5.0, 5.1 and 5.3. What it hooks
does not. Every version from 5.0 (January 2019) to 5.3 (July 2025) has
`execute_command_internal` with the same early return before `QUIT`,
the same `comsub_ignore_return` line where `parse_and_execute` is about
to run a command, no flag at `0x10000`, and the same `struct command`.
The differences are cosmetic: 5.3 is ANSI C, 5.0 spells `PARAMS` as
`__P`, and 5.0 and 5.1 test `read_but_dont_execute` in the early return.

So `apply.py` makes the same edits at anchors instead, each of which
must match exactly once, so a version that moved one fails at build time
rather than at run time. Built by `Containerfile.matrix`, static, the
patched bash compiled for 5.0, 5.1.16, 5.2.37 and 5.3 against both musl
(Alpine 3.23) and glibc (Debian 13): eight builds, all
`-std=gnu17` for the versions before 5.3. Traced with `strace` on one
command (a background subshell, a function, `eval`, a command
substitution, a group whose redirection fails), all eight sent statements
1 to 8 in order, and 5.1 to 5.3 their lines. **5.0 numbers a `-c`
string's lines from 0**, so its lines are one less; the ordinal, which
names the statement, is the same.

### Q6: cost

One `prctl` per top-level statement, not per command: a loop is one
statement. In the lane, with no BPF attached, best of five:

| command | stock bash | patched, static glibc |
|---|---|---|
| 20,000 lines of `x=1` | 0.010 s | 0.011 s |
| a 20,000-step arithmetic loop | 0.025 s | 0.022 s |
| 1,000 runs of `/bin/true` | 0.315 s | 0.295 s |

Under a microsecond a statement, against S281's tens of microseconds per
command. The kprobe on `security_task_prctl` runs only for `prctl` calls.

## Sources

`docs/findings/S298-a-bash-that-signals/`, which a plan would build on:

- `bash.patch`: the patch, as a diff against bash 5.2.37; `apply.py`, the
  same edits at anchors, for 5.0 to 5.3; `Containerfile.matrix` builds
  any version against musl or glibc.
- `attr.bpf.c`, `attr.h`: S283's kernel side, with signals by `prctl`, the
  rule for who may signal, and the uprobe on stock bash's nodes.
- `drive.c`: runs bash as pi does, registering the shell, or attaching the
  uprobe; prints the stream and the events.
- `forge.c`: makes the patched bash's `prctl` from a program the command
  runs.
- `guest.py`: the 64 statements, the trap's command, and the check.
- `unbash-statements.ts`: unbash's top-level statements beside the
  signals.
- `same.py`, `cross.py`: the sameness cases, in the lane and in other
  images; `Containerfile.glibc` builds the patched bash static against
  Debian 13's glibc for them.
- `init`, `Containerfile`, `run.sh`: the guest, as in S283, with the
  patched bash built static against musl, and Alpine's stock bash.
