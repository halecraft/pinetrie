# S189 — Taking a port out of a project's grant stops what a lane sends on it at once, but does not end its open connection: it stalls, the Mac's side goes on reaching the lane, and it resumes, losing nothing, when the port is granted again

- **Status:** Answered
- **Led to:** ADR-0141

Follows S136.

**Question.** A project's `lanes.hostPorts` grants its lanes ports of the
Mac's loopback, through `gvproxy` at `192.168.127.254`. The host writes the
grant into the lane VM's firewall at its start (`planGrant`,
`packages/lanehost/grants.ts`): a chain of the project's, jumped to from
`DOCKER-USER` for its network, above the VM's fence, which rejects the
rest of `192.168.127.0/24` (`packages/vm/image/init`). A planned change has
the host write it again each time accepted work changes the ports, and
says a port taken out is cut at once, open connections included, since
nothing in the fence admits a packet by its connection's state. That is
read from the rules, not run, and the rules match only one direction: the
lane's packets to `192.168.127.254`. The Mac's packets to the lane, through
`gvproxy`'s own TCP stack, are not matched.

With a connection open both ways on each of two granted ports, A and B:
1. B taken out (the grant rewritten with A alone): does B's connection
   stop carrying the lane's lines at once, and the Mac's? Does it end, or
   stall, and how does each side see it?
2. Is A's connection untouched?
3. Is a new connection to B refused, and one to A made?
4. B granted again: does a stalled connection carry lines again?
5. The grant emptied (its chain removed, as `planGrant` does with no
   ports): does A's connection stop as B's did?

**Kill criterion.** The plan's claim fails if, after a port is taken out,
its open connection carries the lane's lines for more than 1 s, or a kept
port's connection misses a line. Then ADR-0141 says what does happen, and
whether the grant must also end the connections (with `conntrack -D`, or
`ss -K` in the lane's network).

**Throw away.** The probe's folder (`s189-port-revoke/` in the shared plans
folder): its scripts and its results. It runs on this Mac's lane VM, with a
network (`s189probe`), a chain (`PT-s189probe`), an image (`s189-fw`) and
containers of its own, all but the image removed when it ends. Its
scripts:
- **`run.sh`:** runs on the Mac. It makes the network, grants A and B,
  and starts a client container per port on it: busybox `nc` to
  `192.168.127.254`, sending a numbered line every 100 ms and keeping
  every line it receives. Then the phases above, each begun with a mark of
  the Mac's time.
- **`server.mjs`:** the Mac's server on `127.0.0.1` at A and B. To each
  connection it writes a line with the Mac's time every 100 ms, and it
  logs every line received, each connection's open, end, close and error,
  and every second the bytes it holds unsent.
- **`grant.sh`:** the grant, in the VM's network namespace from an Alpine
  container with `iptables` (as lanehost's role has): `planGrant`'s rules,
  for the probe's chain, in one `iptables-restore --noflush`.
- **`analyze.mjs`:** for each port and phase, the lane's lines the Mac
  received, the Mac's lines the lane received (by their send time), the
  connection's events, and the most bytes the Mac held unsent.

  It was checked in a lane against `127.0.0.1`, with a Node stand-in for
  `nc`: each phase counted its lines, a client ending early showed its end
  and close, and a second connection was listed as new. `grant.sh`'s
  input, with `iptables` stubbed, was `planGrant`'s for two ports and for
  none.

## How to run it

On the Mac, in pine·trie's repo, with the lane VM running (a pine·trie host
up): `bash .plans/s189-port-revoke/run.sh`. About 40 s. It needs node and
the docker CLI, and pulls `alpine:3.23`. Its output goes to `results.txt`
beside it.

## How it ran

Duane ran it on the Mac (macOS 26.7.1, docker CLI 29.8.1), on 2026-10-13,
on the lane VM a pine·trie host held. The first run measured nothing: the
VM's Docker sees no Mac path but through a slot, so `grant.sh`, bound from
the Mac, was an empty directory there, `sh` ran nothing, and no port was
granted. The second sent the script on stdin, and checked the grant's jump
and both connections before its phases. The full output is `results.txt`
in the probe's folder.

The project's network was `172.20.0.0/16`. Each side sends a line every
100 ms, so a phase of 9.7 s carries about 97 each way.

| phase | A: lane → Mac | A: Mac → lane | B: lane → Mac | B: Mac → lane |
|---|---|---|---|---|
| both granted (3.0 s) | 29 | 30 | 29 | 30 |
| B taken out (9.7 s) | 94 | 96 | 1, at 39 ms | 96 |
| B granted again (5.2 s) | 50 | 51 | 143 | 51 |
| grant emptied (9.5 s) | 1, at 85 ms | 94 | 1, at 86 ms | 29, the last sent at 2.8 s |

No connection ended, closed or failed on either side in any phase, and the
Mac never held a byte unsent.

## Answers

1. **Taking B out stopped the lane's lines on it at once**: one more
   reached the Mac, 39 ms after the grant was rewritten, and none after.
   **The Mac's lines went on reaching the lane**, all 96 of the phase. The
   fence rejects only the lane's packets to `192.168.127.254`; `gvproxy`'s
   packets to the lane pass, and `gvproxy` reads the Mac's side on
   whether or not the lane acknowledges.
2. **The connection did not end.** Neither side saw an end, a close or an
   error in 8 s. The lane's TCP takes a rejected segment as a soft error,
   and retries.
3. **Granted again, B's connection carried on, and lost nothing**: 143 of
   the lane's lines reached the Mac in 5 s, the 95 it had held while
   rejected and 48 new.
4. **A, kept, was untouched** while B was out: 94 lines one way and 96
   the other, every one of the phase.
5. **A new connection to B was refused, and one to A made**, while B was
   out (busybox `nc` exited 1 and 0). With the grant emptied, a new one to
   A was refused too.
6. **Emptying the grant did to both what taking B out did to B**: each
   lane's lines stopped within 86 ms. The Mac's lines went on reaching the
   lane on A to the end; on B they stopped after 2.8 s, a connection that
   had stalled once already. Why they stopped is not measured.

## What this means

- **Kill criterion: not met as written**: the lane's lines stopped within
  39 ms, and the kept port lost none. **But "cut" is the wrong word.** A
  revoked port stops new connections and whatever a lane sends on an open
  one; the open connection stays, half alive, until the lane's TCP gives
  up on its retries (minutes, by Linux's defaults; not measured here), or
  the port is granted again, when it carries on as if nothing happened.
- **What crosses after a revoke** is only the Mac service's side of
  connections already open: responses and streams under way. A lane can
  send it nothing more, so it can ask for nothing new.
- **Ending such connections at once** would take more than the grant:
  rejecting the lane's packets with `tcp-reset` instead of an ICMP error,
  in the fence or the project's chain, would most likely end the lane's
  socket at its next send. Not measured, and the Mac's side would still
  hold `gvproxy`'s connection until it times out.
