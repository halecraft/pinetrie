# S147 — Most of a disk operation's 28 ms is the docker CLI and runc starting processes; one held `docker exec -i` makes it 3 ms; a turn's snapshot is off the critical path, and a fork's is not

- **Status:** Answered
- **Led to:** ADR-0129, ADR-0131, ADR-0135

**Question.** Each disk operation is one `docker exec` in `pinetrie-disks`,
and every runtime call spawns the docker CLI (`packages/docker/cli.ts`).
Should the VM's helpers be served over one held `docker exec -i`, as a
lane's channel is, or should the runtime call Docker's API instead of the
CLI?
1. What does one call cost on the Mac, and where does the time go: in the
   CLI, the bridge to the VM, runc, or the work?
2. How many docker calls does the host make in a turn, a fork and a branch,
   and how many of them hold up what someone is waiting for?

**Kill criterion.** A held channel saving less than 5 ms per call, or the
calls a turn makes summing to under 1% of the turn.

**Throw away.** Two probes, kept as the record of what ran:
- `docs/findings/S147-helper-calls/rtt.mjs` times calls against
  the running `pinetrie-disks`. Its output is `rtt.txt`.
- `docs/findings/S147-helper-calls/shim/docker` is a `docker`
  first on the host's PATH. It logged each call the host made to
  `docker-calls.tsv`. `calls.py` groups that log by gaps longer than 2 s.

## Answers

Measured on the Mac (Darwin 25.6, arm64) against the lane VM's Docker,
through the launcher's `docker.sock`.

1. **One call.**

   | | CLI `docker exec` (today) | API exec | held `exec -i` |
   |---|---|---|---|
   | `true` | 26.0 ms | 14.0 ms | 0.22 ms echoing a line, 0.44 ms forking `true` |
   | a snapshot and its delete | 28.5 ms | 15.6 ms | 3.3 ms |

   - **The docker CLI costs about 11 to 13 ms a call.** `docker inspect`
     took 11.1 ms, and the same API request 0.21 ms.
   - **runc costs about 13 ms**, starting a process in the container:
     API exec, less the bridge.
   - **The bridge from the Mac to dockerd costs 0.2 ms**: an API `_ping`
     through the launcher and vsock.
   - **btrfs's work is about 3 ms.**

   A lane's rootless Docker, with a local socket, gave the same shape:
   23.6, 14.3 and 0.18 ms.
2. **A session**, run with the host's own lanes: the host's start, one
   thread restarted, a new thread from the base with a few turns, and a
   branch from one of its messages. That was 93 calls in 124 s, summing
   to 3.8 s.
   - **A turn makes one call, its snapshot: 35 ms** (28 of them). It runs
     on the lane's queue and is not awaited
     (`apps/pinetrie/host/work/turns.ts`): the next model request starts
     at once, and only the next tool call waits for it. With the model's
     reply taking seconds, it holds up nothing.
   - **A fork from the base took 280 ms of calls, one after another, before
     the lane's channel opened:** `stat` of the base (30 ms), `rm -f` (14),
     a delete (29), the snapshot into the lane (35), the nested disk (30),
     `docker run -d` (106). Then three `inspect`s of the same container in
     a row (41). A branch took 310 ms the same way.
   - **A lane restarted after idling** made two `inspect`s and a `start`
     (80 to 88 ms). A stop took 140 ms.
   - **The host's start** took about 750 ms of calls, made once:
     `buildx version` (167 ms), a throwaway `run --rm` for `git --version`
     (209 ms), and the firewall's `run --rm` (127 ms).
   - Of the 3.8 s, 1.4 s was 41 execs in `pinetrie-disks` and 0.25 s was 18
     `inspect`s.

**What this means.** The kill criterion holds for a turn: its one call is
off the critical path. It fails for a fork or a branch, which waits on its
calls before its first tool can run.
- **Calling Docker's API instead of the CLI** saves about 11 ms on every
  call, `inspect`, `rm`, `start` and `run` included. It needs no new
  process and no protocol. A fork would go from 280 ms to about 200 ms.
- **Serving `pinetrie-disks` over a held channel** takes a disk operation
  from 28.5 to about 3 ms. Together with the API, a fork would be about
  120 ms, most of it `docker run -d`, which neither change touches.
- **Three `inspect`s in a row after a fork's `run`**, and two before a
  `start`, each read the same container. That is 27 to 41 ms that no
  change to the transport is needed for.
- A served `diff`, as a turn's second call, would be off the critical path
  as the snapshot is, unless the turn's record waits for it.
