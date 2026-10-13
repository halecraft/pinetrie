# ADR-0141 — A host adds a slot for what accepted work newly shares, and grants its ports at once; its own slot is still filled once

- **Status:** Accepted (Duane, 2026-10-14)
- **Area:** `packages/vm/TECHNICAL.md`, `packages/docker/TECHNICAL.md`,
  `packages/lanes/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S130, S131, S140, S141, S178, S187, S189
- **Amends:**
  - ADR-0130: a change to what lanes mount or reach no longer means restarting
    the host. What accepted work adds goes in an extra slot of the lane VM,
    and its ports are written again; the host's own slot is still filled once.
  - ADR-0035: on the Mac, a shared directory accepted work adds while the host
    runs reaches lanes at their next start, as on Linux.
  - ADR-0118: what its deferred bullet weighed now holds for what accepted
    work adds. Registering a source while the host runs stays deferred, as do
    your config's own shared directories: the user config is read at startup.

**Context.**

- **On the Mac, a host's directories fill its slot once, at its lease**
  (ADR-0130). A shared directory or mount grant accepted work added later
  made every lane naming it fail to start ("not shared into slot N"), and
  a port it granted was not written, until the host restarted.
- **The host's slot is never free of running containers.** Refilling a
  slot cuts every bind into it (S130), and lanehost's roles bind
  pine·trie's install and the lane runtime through the host's slot for as
  long as the host runs. Waiting for its lanes to stop would hold every
  thread's next run behind the longest one, and still meet the roles.
- **Another slot works beside it.** Filling one leaves the others' binds
  working (S131). A slot holding only a shared directory, beside the
  host's holding the working copy around it read-only, showed each change
  as today's layout does: new files and rewrites at once, renames, appends
  and deletes about 1 s late, the lag of any directory seen through two
  entries (S178, S187). Nothing was refused, appends kept every line.
- **One directory read-write in two slots loses appends and refuses
  creates** (S140, S141). One read-only in one slot and read-write in
  another does not: only one is written, and the read-only entry still
  refuses writes (S187).
- **The VM's firewall takes a grant at any time** (`planGrant`, in one
  `iptables-restore`), and a port taken out stops what lanes send on it
  within 40 ms, though it does not end a connection already open (S189).

**Decision.**

- **Each time accepted work moves, the host shares what its lanes may now
  mount and grants the ports, before the new config is in force**, so no
  lane is made naming a directory no slot holds.
- **When nothing changed, nothing is done**: no lease, no fill, no grant,
  no call to the launcher or lanehost, no log line. A project whose
  accepted work moves on every save (ADR-0142) runs this path often.
- **A directory no slot of the host holds goes in a new slot**, leased by
  the host beside its own, swept of a dead host's containers, and filled
  with those directories alone. Lanes made from then on bind it there.
- **A directory a slot holds read-only, now wanted read-write, goes in the
  new slot read-write.** Lanes made from then on bind the read-write
  entry; a lane made before reads through the read-only one, a rename,
  append or delete up to 1 s late, until its next start. A directory is in
  at most two of a host's slots, one read-only and one read-write.
- **An extra slot is never refilled or added to.** A later widening leases
  another. Each holds one of the VM's slots until the host's next lease: a
  restart, or a new VM, fills one slot with everything, and the extras are
  dropped.
- **No slot, or no answer from the launcher:** the host says once that a
  restart brings the directories, and a lane naming one fails to start
  with the same words. It does not ask again while the same directories
  are what is new.
- **The ports are written when the list changed.** A port taken out stops
  at once what lanes send on it and refuses their new connections; a
  connection already open stalls, the Mac's side goes on reaching the
  lane, and it carries on, losing nothing, if the port comes back. A
  running lane's `PINETRIE_HOST_PORTS` names its old list until its next
  start. On Linux the grant applies to nothing, and the host says so once.
- **The sweep of a slot takes every container with a bind into it,**
  whatever its labels, so a dead host's lanes in an extra slot go too.

**Consequences.**

- Adding `.plans` to `lanes.shared` in accepted work reaches a thread's
  next run with no restart, on the Mac as on Linux.
- A host may hold several of the VM's slots: a busy day of config changes
  can fill the VM's 16 sooner. A restart gives them back.
- A revoked port's open connections stall rather than end; a lane can ask
  nothing more of the service through them.

**Alternatives rejected.**

- **Refilling the host's slot once no container of it runs:** its
  lanehost roles always run, and closing them stalls every disk
  operation.
- **Holding new runs until the running ones end, then refilling:** every
  thread waits for the longest run, and the roles remain.
- **One directory read-write in two slots:** appends lost and creates
  refused (S141).
- **Mounting into running containers:** needs a root agent in the VM,
  which has none on purpose.
- **A label per slot on every container, for the sweep:** labels are in
  the spec hash, so every lane would be made again after each widening.
- **Ending a revoked port's open connections** (rejecting with
  `tcp-reset`): not measured, and the Mac's side would still hold
  `gvproxy`'s connection.
