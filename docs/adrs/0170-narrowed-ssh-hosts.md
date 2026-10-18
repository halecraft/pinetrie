# ADR-0170 — Narrowed ssh hosts are matched under the names ssh checks their keys under, and a signature refused for a host outside them is shown to the owner, logged, and explained to the agent

- **Status:** Accepted (Duane, 2026-10-18)
- **Area:** `packages/ssh/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`,
  `packages/rules/TECHNICAL.md`, `packages/interface/TECHNICAL.md`,
  `packages/pi/TECHNICAL.md`, `docs/06-interface.md`
- **Evidence:** S174, S238
- **Amends:**
  - ADR-0140: narrowed hosts keep the `known_hosts` lines under the names ssh
    checks each allowed host's key under, as the host's `ssh -G` resolves
    them. A personal signature refused because its host key is outside them is
    recorded in the lane's access record and logged, not dropped without a
    word.

**Context.**

- **A narrowed alias allowed nothing.** With `lanes.ssh.hosts: ["hql"]`,
  `hql` an alias for `192.168.1.2`, the lane's `known_hosts` was empty.
  The person's `known_hosts` names that server only as `192.168.1.2`,
  since ssh records a key under its `HostName` (S174 item 8, S238), and
  the pattern `hql` matched no line. The relay allows a personal
  signature only for a key one of those kept lines names, so it refused
  every signature, before asking.
- **Nobody was told.** That refusal wrote no record and no log line. The
  lane's ssh printed "agent refused operation". The access row stayed
  hidden, since the lane had neither asked nor used a service identity,
  and the lane's note says that error means its owner has not approved.
  So the agent told its owner to approve a request that did not exist.

**Decision.**

- **An allowed host is matched under the name ssh checks its key under.**
  At start, each concrete pattern of `lanes.ssh.hosts` is resolved with
  the host's `ssh -G` against the same file of `Include`s the broker uses
  (service config first, then the person's), with no `-p`, in the case
  the person wrote it: ssh matches `Host` as typed (S238). Its name is
  its `hostkeyalias`, else its `hostname`, written `[hostname]:port` when
  the port is not 22 (S238). The person's `known_hosts` lines under that
  name, clear or hashed, are kept, as well as those the patterns match
  directly. A wildcard pattern names no one host, so it is matched as it
  is now. An entry of `lanes.ssh.hosts` may be a comma-separated list, as
  an ssh `Host` line's patterns are, and each of its patterns counts.
- **Allowing a name allows its server.** The relay still decides by host
  key, so another alias for the same server (`pop` for `hql`) is allowed
  too: a host key identifies the server, not the name typed.
- **A host with no `ssh`** matches patterns only, as it does now, and says
  so at start.
- **Start-up says when an allowed host has no key.** A pattern that keeps
  no `known_hosts` line is logged, with the name it was checked under,
  since a pattern that allows nothing is otherwise silent.
- **A signature refused for a host outside them is said.** The relay
  tells this refusal apart from its others. The lane's access record keeps
  the last one: the host's name, the host key's fingerprint, and when. The
  name is the one the person's whole `known_hosts` gives that key, else
  the name the broker last connected for the lane. The column's header
  shows it with no buttons, since the answer is the person's config, not
  an approval. The host logs it once each time it changes. A lane with
  only this to show has an access row. A starting host clears it, since
  the allowed hosts are read again then.
- **The agent is told.** A lane's guidelines name the hosts its owner's
  identity is limited to. The lane's note lists each cause of "agent
  refused operation" and tells the agent not to turn off host key
  checking.

**Consequences.**

- `lanes.ssh.hosts: ["hql"]` works as written for an alias whose server's
  key is in the person's `known_hosts` under its address.
- `pinetrie.access` records change shape. A record stored before this
  stops decoding, so each lane's owner is asked again.
- A starting host runs `ssh -G` once for each concrete allowed pattern.

**Alternatives rejected.**

- **Tell the person to list the address too.** That is the workaround, not
  a fix: the person writes the alias, and their ssh config already says
  where it points.
- **Read `HostName` from the config without ssh.** `Match`, tokens,
  `Include`s and first-value-wins make ssh the only reliable reader, and
  the broker already resolves names with `ssh -G`.
- **Allow a signature by the name the broker connected.** The lane chooses
  that name, and its config and its own `known_hosts` are not the host's to
  trust. ADR-0140 enforces narrowed hosts by the bound host key for that
  reason.
- **Ask the owner when a host is outside them.** `lanes.ssh.hosts` is the
  owner's standing answer. An approval button there would invite them to
  override their own limit, one lane at a time.
