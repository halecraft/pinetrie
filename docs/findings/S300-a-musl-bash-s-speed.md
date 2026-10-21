# S300 — A static musl bash is up to 2.7 times slower than a glibc image's bash, and as fast as a musl image's; a static glibc bash is as fast as a glibc image's

- **Status:** Answered
- **Led to:** ADR-0204

Measured in a lane (Debian 13, the lane VM's CPU) and inside
`alpine:3.23` on it; best of several runs, as the lane's machine is shared.

## Brief

**Question.** ADR-0204 has pine·trie own one bash, static against musl.
S298 timed only a static glibc build. musl's allocator is known to be
slower on allocation-heavy work, and bash allocates heavily, and the plan
builds `--without-bash-malloc`. How do these compare on work a tool call's
shell does itself (builtins, expansions, loops, functions, command
substitution, globbing), not on the programs it starts:

- Debian 13's bash 5.2.37 (glibc, dynamic): the image's bash;
- pine·trie's bash 5.3 with GNU's patches 001–020 and ours, static, musl,
  `--without-bash-malloc` (musl's allocator);
- the same with bash's own allocator (`--with-bash-malloc`, bash's
  default)?

**Kill criterion.** pine·trie's bash, built the better of the two ways,
more than 1.5 times slower than the image's on any case: a tool call
written for bash would run noticeably slower because pine·trie runs it.

**Throw away.** The timing script and the builds
(`docs/findings/S300-a-musl-bash-s-speed/`), unless a plan builds on them.
Measured in a lane, on the lane VM's CPU, best of several runs, as the
lane's machine is shared.

## Answers

**One static musl bash for every image meets the kill criterion; one
static bash per C library does not.** Against a glibc image's bash, the
musl build is 2.7 times slower at appending to a string and 2.2 times at
globbing. Against a musl image's bash it is as fast or faster, and a
static glibc build is as fast as a glibc image's. Bash's own allocator
does not work on musl at all.

### Against a glibc image's bash (`debian-run.txt`)

Debian 13's bash 5.2.37 against bash 5.3.20 with GNU's patches and
`apply.py`, static (`time.py`, best of 7):

| | glibc | musl | musl with mimalloc |
|---|---|---|---|
| string append (40,000 `+=`) | 1.0× | **2.7×** | **2.5×** |
| glob over 5,000 files | 1.0× | **2.2×** | **1.9×** |
| the other nine cases | 0.8–1.0× | 1.0–1.3× | 0.8–1.1× |

- **mimalloc** (2.2.4, its object file linked first, so musl's allocator
  is never pulled in) fixes the allocation-heavy cases, but not these
  two. Their cost is not the allocator: by elimination, musl's own string
  copying and sorting, which glibc does with tuned routines.
- **The glibc build is as fast as Debian's, or faster**, so the difference
  is the C library, not bash 5.3 against 5.2.

### Against a musl image's bash (`alpine-run.txt`)

Inside `alpine:3.23`, Alpine's bash 5.3.3 against the same builds (best of
3, the long string cut to 5,000 pairs, as 50,000 took a minute a run):

| | musl | musl with mimalloc |
|---|---|---|
| every case | 0.5–1.0× | 0.5–0.9×, but command substitution 1.2× |

### Bash's own allocator

`--with-bash-malloc` against musl builds, but the binary cannot
allocate: `bash: xmalloc: locale.c:90: cannot allocate 18 bytes`. It
grows its heap with `sbrk`, which musl does not support. Alpine builds
its bash without it for the same reason.

### A static glibc bash on each kind of image

Run with `LANG` or `LC_ALL` set:

| image | `LANG=C.UTF-8`: `x=é; echo ${#x} ${x^^}` | `LC_ALL=en_US.UTF-8`, not installed |
|---|---|---|
| Debian 13 | `1 É`, as Debian's bash | the same `setlocale` warning as Debian's bash |
| Alpine 3.23 | `2 é`: no glibc locale data, so bytes, where Alpine's bash reads UTF-8 | a `setlocale` warning Alpine's bash does not print |

So a static glibc bash behaves as a glibc image's bash does, and differs
on a musl image; a musl bash behaves the same whatever the image, which
on a glibc image is not what its own bash does (S298).

### What the decision takes from this

Each property points to the image's C library: glibc's speed and
behaviour on a glibc image, musl's on a musl image. One bash version, two
static builds: against glibc for an image whose programs link glibc,
against musl for one whose programs link musl, with musl's own allocator,
which on a musl image is as fast as the image's own bash and adds nothing
to build. Which one an image takes is a fact `checkImage`'s probe can
read: the ELF interpreter its `/bin/sh` names.

## Sources

`docs/findings/S300-a-musl-bash-s-speed/`:

- `time.py`: the eleven cases, best of `RUNS`, under each bash given.
- `Containerfile`: the musl build, with musl's allocator or bash's own
  (`MALLOC`); `Containerfile.glibc`: the glibc build;
  `Containerfile.mimalloc`: the musl build with mimalloc linked in. Each
  needs S298's `apply.py` beside it.
- `debian-run.txt`, `alpine-run.txt`: the two runs.
