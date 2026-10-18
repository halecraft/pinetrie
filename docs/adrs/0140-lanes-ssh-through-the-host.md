# ADR-0140 — Lanes ssh through the host: service identities and the owner's own on approval, keys never in a lane, a broker for the host's names

- **Status:** Accepted (Duane, 2026-10-13)
- **Area:** `packages/ssh/TECHNICAL.md`, `packages/lanes/TECHNICAL.md`,
  `packages/docker/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S174
- **Amends:**
  - ADR-0034: the ssh grant is no longer the person's agent forwarded. It is
    identities a host relays: service ones from a folder of the person's, and
    the person's own, which each lane uses only once its owner approves. A
    broker on the host connects names only the host's ssh config knows.
  - ADR-0035: the user config's `lanes.ssh` sets the person's own identity
    (`personal`, `hosts`, `approvalSeconds`), and its `owner` names who
    approves.
- **Amended by:**
  - ADR-0146: `owner` and `lanes.ssh` are settings with declared layers. That
    the user's choice beats the project's is the setting's declared order, and
    a system file may forbid personal ssh. `lanes.ssh` has one shape in every
    layer: a project grants with `lanes.ssh.personal: true`.
  - ADR-0170: narrowed hosts keep the `known_hosts` lines under the names ssh
    checks each allowed host's key under, as the host's `ssh -G` resolves
    them. A personal signature refused because its host key is outside them is
    recorded in the lane's access record and logged, not dropped without a
    word.

**Context.**

- **A lane could not ssh where its host can.** The default image had no
  `ssh`. The lane had none of the person's ssh config: `pop`, an alias for
  `192.168.1.2` in `~/.ssh/config`, no resolver knows. A lane reaches the
  Mac's LAN already, through gvproxy (S174 item 10); what it lacks is the
  config.
- **The one grant handed every lane the whole agent.** `lanes.ssh: true`
  mounted the person's agent in every lane, unasked, and let a lane add,
  remove or lock keys in it. There was no identity of a project's own, and
  nothing showed or took back a lane's use.

**Decision.**

- **`@pinetrie/ssh` is the only code that knows ssh.** It speaks the agent
  protocol, reads ssh config and runs the ssh programs. It declares
  nothing, and only the app declares it; `@pinetrie/lanes` and
  `@pinetrie/docker` know a host socket, mounts, variables and start-up
  commands (`LaneAttached`, `hostSocket`, `laneCommand`).
- **Two kinds of identity.**
  - *Service identities*: every key pair in the folder `ssh/` beside the
    user config, with an optional ssh `config` there naming their hosts,
    for every project's lanes, used unasked. A key others can read, or one
    with a passphrase, is refused at startup.
  - *Your identity*: the person's own agent. Granted by the project
    (`lanes.ssh: true`, accepted work's, narrowed per lane as every grant
    is) or by the person's config (`lanes.ssh.personal: true`), declined by
    the person's config whatever the project says, narrowed to hosts by it
    alone.
- **Keys never enter a lane.** A lane gets public keys, a socket and a
  token. Its hop (`packages/ssh/hop.ts`, on the lane runtime's Node) is
  its `SSH_AUTH_SOCK` and its `ProxyCommand`, and opens each connection to
  the host's socket with the token, which carries the lane under an HMAC.
- **The relay passes typed requests only:** listing, signing, and session
  binding, each re-encoded from its decoded fields. Service keys are listed
  first, so they win (S174 item 5). A session binding is remembered only
  once the host's own `ssh-agent` has checked its signature (S174 item 11).
  Narrowed hosts are enforced at the relay, by the bound host key, not by
  the lane's config.
- **Each lane asks its owner once,** at its first personal signature: the
  relay holds it, and the lane's `pinetrie.access` record waits for the
  owner's answer in the column's header (approve, refuse; later revoke),
  for `approvalSeconds` (120 by default; a default sshd gives up at 120 s
  anyway). The record is the one truth: the command only writes it, and
  the host's wiring follows it, releasing, refusing, or cutting. A revoke
  closes every connection the lane holds through the host and kills its
  `ssh` processes.
- **A broker connects for the lane.** The lane's generated config sends
  every host through it (`ProxyCommand` in its last `Host *`), and the
  broker resolves the name with the host's own ssh config (`ssh -G`) and
  opens the connection from the host. A host whose config runs a program
  for a name is refused it. The lane checks the host key itself.
- **Only the owner answers.** The user config's `owner` names them; the
  host refuses anyone else's answer. Sign-in is unverified (ADR-0037)
  until authentication lands: the gap is accepted.

**Consequences.**

- `ssh pop` in a lane works for an alias only the person's config knows,
  with their identity once they approve that lane, and a deploy key works
  in every lane with no question.
- **Every lane is recreated once,** at its next start: its shape now names
  what it attaches, and the image installs `openssh-client`.
- **A project image** needs `openssh-client` and the line
  `Include /pinetrie-ssh/config` in `/etc/ssh/ssh_config.d/` for the same.
- **Not carried into a lane:** `Match` blocks, and hosts reached through a
  `ProxyCommand`. A wildcard host never matches a hashed `known_hosts`
  line.
- **The person's ssh files are read at the host's start;** a change to them
  takes effect at the next start.
