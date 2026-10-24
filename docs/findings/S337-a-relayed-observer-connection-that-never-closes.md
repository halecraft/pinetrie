# S337 — Where is a relayed observer connection's close lost, so its `docker exec` outlives the host inside the lane?

- **Status:** Open (in part answered: a host's close never closes its observer
  connection; the outer relay's close is lost somewhere this spike has not
  reproduced)
- **Led to:** ADR-0212

**Why.** A host inside a lane reaches the machine's observer through its
lane's helper, relayed by the host outside: each connection the inner host
opens on the helper's socket is a connection of its own to the observer,
a `docker exec -i` the outer host runs (`serveRelay` and `relayObserver`,
`packages/pi/observer.ts`; the lane's helper, `packages/pi/lane-helper.ts`;
the relay, `packages/lanehost/observer-client.ts`). On 2026-10-24 eight
such connections, from `e2e:lanes`' hosts in limber-glade, stayed open for
over an hour; when the suite's process was killed its eight inner clients
exited, and the eight `observer-connect.ts` processes in the observer, and
their `docker exec` on the Mac, did not (S334). The observer server
disconnects on a client's `end`, and `observer-connect.ts` exits on its
socket's close, so the outer host never ended those channels' stdin.

The close should travel: the inner socket closes; the helper's server
sends `{ connection, closed: true }` over the host's `observerRelay` call;
the host's `closeRelay` closes that connection's relay, ending its
`docker exec`'s stdin. The helper keeps one relay at a time
(`relayReply`), and a connection opened under a relay call that has since
ended would report its close to a call no one hears.

**Question.**

1. In a unit test with the helper's and the host's halves joined by a
   stand-in channel: does closing an inner connection close its relay's
   channel? Then with the relay call ended and opened again between the
   connection's open and its close?
2. In the lanes suite, one host inside a lane opened and closed (its own
   `close`, then its process killed): how many `observer-connect.ts`
   processes does the observer hold before, during and after?
3. Which link loses the close, and does anything else hold a relayed
   connection open: a call in flight, the inner host's close never closing
   its observer channel?

**Kill criterion.** Every close reaches the host's `closeRelay` in both the
unit test and the suite: then the leak is in the inner host's own close or
the harness's, and the spike says which.

**Throw away.** The probe; the unit test is kept if it proves the fix
(a plan's test, not this spike's).

## Answers so far

Run on 2026-10-24 on the Mac, and read from source.

1. **The relay's two halves close every connection, in four cases.** A
   throwaway probe beside `apps/pinetrie/host/work/relay.test.ts` joined
   the role's server (a stand-in loader, `@pinetrie/lanehost/fixtures`),
   the outer host's client, `serveRelay` and `relayObserver`, each
   connection a real `observer-connect.ts`, and counted the outer relays
   opened and closed and the role's `observer-connect` processes:

   | case | relays opened → closed | outer processes |
   |---|---|---|
   | the inner client closed (`reset`) | 1 → 1 | 2 → 1 |
   | the inner client killed (`SIGKILL`) | 1 → 1 | 2 → 1 |
   | eight inner clients killed at once | 8 → 8 | 9 → 1 |
   | a second relay call opened, then the inner killed | 1 → 1 | 2 → 1 |

   The existing unit test (`packages/pi/observer.test.ts`) passes too.
2. **A half-close crosses the launcher's Docker socket.** `printf hello |
   docker exec -i <a lanehost container> cat` against the person's lane VM
   printed `hello` and exited at once: an outer channel's close (its
   `docker exec`'s stdin ended) reaches the process in the observer.
3. **A host's close never closes its observer connection** (read from
   source). The observer client is reset only when the VM restarts
   (`vmRestarted`, `packages/docker/runtime.ts`); a found runtime's close
   does nothing for a host on Docker (`dockerFound`,
   `apps/pinetrie/host/work/runtime.ts`) and ends only the lease on the
   Mac. A host that is its own process loses its connection at exit, its
   `observer-connect` child seeing its stdin end; a host closed within a
   process that goes on (`e2e:lanes` starts and closes many) leaves it
   open until that process ends. The incident's eight inner clients, alive
   for over 30 minutes as scenarios came and went, are that; inside a
   lane, each holds a relayed connection, and a process, in the machine's
   observer.
4. **Not reproduced: the outer relays outliving their inner clients.** When
   the suite's process was killed its inner clients exited, and the eight
   outer relays did not close (S334). What the probe lacks is the lane's
   channel to a real helper process (`lane-env.ts`, `lane-helper.ts`)
   between the halves; that needs a host inside a real lane, with the
   observer's processes counted before and after (question 2).
