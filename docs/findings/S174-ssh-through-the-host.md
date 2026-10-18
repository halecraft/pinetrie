# S174 — A lane can ssh through a relay and a broker on the host: ssh's own config chooses the key and checks the host key, a relay refuses what it should and tells lanes apart, and a revoke ends sessions within 50 ms

- **Status:** Answered
- **Led to:** ADR-0140, ADR-0170, ADR-0178

**Question.** Can a lane ssh anywhere its host can, with keys that never
enter the lane? The design under test:
- the host connects on the lane's behalf (a *broker*, reached by the lane's
  `ProxyCommand`), with the Mac's own names, routes and ssh config;
- the ssh session itself runs in the lane, signing through an agent relay on
  the host, which merges *service identities* (key pairs in
  `~/.config/pinetrie/ssh/`, with an optional ssh `config` beside them) with
  the person's own agent, lists service keys first, holds a lane's first
  personal signature for its owner's approval, and refuses everything but
  listing, signing and session binding;
- a revoke cuts the lane's sessions at once.

Each belief that design rests on is an item below.

**Kill criterion.** Any of these: ssh in a lane cannot authenticate through
a relay that refuses some requests; a refused signature ends the attempt
instead of falling through to the next key; the relay cannot tell one lane's
connection from another's; the host key cannot be checked when the host
makes the connection; a revoke cannot end a session already open.

**Throw away.** The probes, in this spike's folder of sources,
kept because the plan's relay, broker and lane hop follow them: `relay.py`
(an agent relay that logs, holds, refuses and merges), `broker.py` and
`connect.py` (the broker and the lane's `ProxyCommand`), `lane_hop.py` and
`host_mux.py` (the per-lane token), `dnsq.py` (a raw DNS query). They ran in
a lane on the Mac's lane VM, against Debian's OpenSSH 10.0p2 client and
server on `127.0.0.1`, with throwaway ed25519 keys.

**Answers.**

1. **A sign request names its target.** Every connection sent
   `session-bind@openssh.com` (extension, type 27) before anything else,
   with the server's host key and the session id; the sign request that
   followed carried the same session id in its data, with the user. So the
   relay holding a signature knows the host key it is for, which the
   lane's `known_hosts` names. The client also lists identities (type 11)
   on every connection, and signs only with a key the server has already
   accepted: an approval is asked only when a personal key is about to be
   used, never for a key a server would refuse.
2. **ssh waits as long as the agent does; the server does not.** With the
   relay holding the signature 200 s, the client waited it out and logged
   in against an sshd with `LoginGraceTime 0`. Against the default sshd the
   server closed at its `LoginGraceTime`, 120 s, logging "Timeout before
   authentication". So the approval timeout bounds the wait only where the
   server allows longer; a default server ends it at 120 s, whatever the
   setting.
3. **A refused signature falls through.** A relay answering
   `SSH_AGENT_FAILURE` to a sign request: ssh printed "signing failed …
   agent refused operation" and offered the next identity. With only the
   refused key, "Permission denied (publickey)".
4. **Changing the agent is refused cleanly.** A relay passing only types 11,
   13 and 27: `ssh-add -D` ("Failed to remove all identities", which also
   sent the protocol-1 type 9), `ssh-add <key>`, `ssh-add -d` and
   `ssh-add -x` each failed with exit 1, the agent behind kept its 8 keys,
   and ssh through the same relay logged in. Type 27 carries other
   extensions too; the relay should pass `session-bind@openssh.com` alone.
5. **Agent order decides which key is tried first, not the config's.** With
   `IdentitiesOnly yes` and `IdentityFile` naming two public keys,
   personal first, ssh offered them in the order the agent listed them.
   A relay that lists service keys first makes the service identity win,
   whatever the config's order. An `IdentityFile` naming only the `.pub`
   is enough for ssh to pick the agent's key.
6. **Pinning is needed.** With 8 keys in the agent and the authorized one
   last, unpinned ssh was disconnected ("Too many authentication
   failures", sshd's `MaxAuthTries` of 6); pinned with `IdentityFile` and
   `IdentitiesOnly yes`, it signed once and logged in.
7. **The service config goes ahead of the person's by `Include`.**
   - `-F` twice: only the last file was read.
   - One file of two `Include`s, the service config first: for a host in
     both, `User` came from the service's (ssh keeps a setting's first
     value), `HostName` from the person's where the service's set none, and
     `IdentityFile` from both, the service's first.
   - A relative `Include` in a file given with `-F` resolved under
     `~/.ssh/`, not beside the file, and its absence was silent: the
     generated file names absolute paths.
   - A relative `IdentityFile` (`./ci`, `ci`) resolved against ssh's working
     directory: found when run from the folder, `type -1` (not found) from
     another. pine·trie gives a relative path its meaning, the service
     folder, when it rewrites the file.
8. **The host can make the connection and the lane still checks the host
   key.**
   - Through a `ProxyCommand` given `%n` (the name as typed), the broker
     resolved the alias with `ssh -G` against its config and connected.
   - ssh checked the host key under `HostName` and `Port`, as
     `[127.0.0.1]:2200`: a lane config with only the alias failed "Host key
     verification failed"; one carrying `HostName` and `Port`, or
     `HostKeyAlias`, logged in. So the lane's config carries the
     `HostName` and `Port` the Mac resolves, for the person's `known_hosts`
     lines to match.
   - ssh never resolved that `HostName`: `pop.nowhere.invalid` with a
     matching `known_hosts` line logged in.
   - **A revoke ends sessions within 50 ms.** Two sessions running
     `sleep 60`, the second multiplexed over the first's connection
     (`ControlMaster`): the broker closed its one connection, and both
     exited 255 about 50 ms later.
   - **Lanes are told apart by a token, with no change to the launcher.**
     Today a slot's agent socket is shared by every lane of the host:
     `/run/pinetrie/ssh-<i>.sock` in the VM, bridged by the launcher to the
     socket the lease names (`packages/vm/launcher/launcher.swift`,
     `AgentListener`), mounted in each lane granted ssh
     (`packages/docker/plan.ts`, `SSH_AGENT_IN_LANE`). A hop in the lane
     (`lane_hop.py`) listened where `SSH_AUTH_SOCK` points and opened each
     connection to the slot's socket with a line naming its token; the
     host's end (`host_mux.py`) read it, named the lane, and relayed to the
     agent. ssh logged in through both hops; a hop with an unknown token
     got nothing ("Permission denied"). The launcher bridges bytes, so the
     lease names the host's relay instead of `$SSH_AUTH_SOCK`; the broker's
     connections can share the socket, with `connect <alias>` for the line's
     kind. A lane cannot open a vsock socket (S128 item 3), so the slot's
     socket, reached only through what the lane mounts, is its one route.
     A lane's root can read its own token, and no other lane's.
9. **A name only the Mac's ssh config knows is unknown to the lane.** In
   this lane, `pop`, `pop.lan` and `pop.local` failed at both resolvers:
   gvproxy's on the gateway (`192.168.127.1`) answered NXDOMAIN for all
   three, and Docker's (`127.0.0.11`) NXDOMAIN, NXDOMAIN and SERVFAIL. Both
   answered `localhost` and `github.com`. On the Mac, `ssh -G pop` gave
   `hostname 192.168.1.2`, `port 22`, no `ProxyJump` or `ProxyCommand`;
   `dscacheutil` resolved nothing further, and `pop` has no Tailscale
   address. So `pop` is an alias in the person's `~/.ssh/config`, which no
   resolver could answer. Read, not run: gvproxy v0.8.9, the pinned
   release, looks names up with Go's `net.Resolver` and `PreferGo: false`
   (`pkg/services/dns/dns.go`), which on macOS asks the system's resolver;
   no name here tested that. With the broker, it does not matter for ssh:
   the Mac resolves (item 8).
10. **The lane reaches the Mac's LAN directly.** TCP from the lane to
    `192.168.1.2:22` connected in 12 ms and read `pop`'s banner,
    `SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.16`: gvproxy makes a lane's
    connections from the Mac, so the LAN is open to a lane with or
    without the broker, as ADR-0034 says of the network. A lane's own
    route to a Tailscale or VPN address was not measured, there being none
    for `pop`. The broker's connections leave from the Mac's own ssh
    config and routes, so they reach what the Mac does.

11. **An OpenSSH agent checks a session binding's signature.** A
    `session-bind@openssh.com` carrying a real host key, a random session
    id and a random signature, sent straight to `ssh-agent`, was answered
    `SSH_AGENT_FAILURE` (5). The one ssh sent for a real login, relayed to
    the same agent on a connection of its own, was answered success (6).
    So a relay that records a binding only when an OpenSSH agent accepts it
    cannot be told a host key a lane did not reach: a lane cannot sign the
    session id with another server's host key.

**What the default image lacks.** No `ssh` client
(`packages/lanes/image/Containerfile`): the grant `lanes.ssh` forwards an
agent no program in the default image can use.
