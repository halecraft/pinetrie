# S299 — can a WireGuard mesh be pine·trie's network and its proof of who a peer is?

- **Status:** Answered

For ADR-0202's first direction. Its spikes found that a document with one
writer travels only on links to its writer (S293), that the author of an
intent can be checked only for writers the reader saw connect, and only
against bugs, not adversaries (S296), and that a seat lasts only on a
secure origin, which pine·trie's LAN invite links are not (S297). A mesh
between hosts (Headscale, Netbird or Nebula), with Kyneta's WebSocket
transport over it, might answer all three: every member's peer can dial
the tether, each link has a proven node, and the mesh's names can carry
HTTPS.

**Question.**

1. Over a mesh of three nodes (containers here, Docker at `$DOCKER_HOST`),
   do Kyneta exchanges sync over its addresses as over loopback, and can a
   member reach a tether directly where S293's member could not?
2. Can the receiving end of a connection learn the mesh's identity of the
   node at the other end (its node key, or the name the coordination
   server gave it), and can that be the principal `canConnect` and
   `canWrite` judge, instead of the principal a peer states? What does a
   peer that lies about its principal see?
3. Does the mesh give the host's page an HTTPS name a browser trusts with
   nothing installed on a collaborator's device? With which of the three,
   and at what cost: a domain, a public service, a coordination server
   of our own?
4. What a person does to join: install, sign in, approve. Who runs the
   coordination server, and what happens to the mesh while it is down.
5. A browser that is not on the mesh: what it reaches, and through what.

**Kill criterion.** The mesh is not pine·trie's proof of who a peer is if
the receiving end cannot learn the connecting node's identity, or if a
peer on the mesh can still be taken for another. It is not its network if
joining needs more of a collaborator than an invite link does today.

**Throw away.** The containers and probes. Images built per
`/pinetrie/packages/pi/lane-docker.md`. Packages the repo's lockfile lacks
are installed outside it.

**Answers.**

1. **Kyneta syncs over the mesh as over loopback, and every member
   reaches the tether directly.** Three Tailscale nodes on Headscale
   v0.29.5 (a tether, Ada's, Bea's): each member's exchange connected to
   the tether at its mesh address, wrote its drafts and the thread's log,
   and read the agent's record. The links were direct WireGuard, not
   relayed (`tailscale ping`: `via 172.20.0.3:…`). S293's member behind
   another member's peer never received a document with one writer;
   here no member is behind another, since each dials the tether. The
   same held over Nebula v1.11.2.
2. **The receiving end learns who the connecting node is, and a lie is
   refused, but only with a binding Kyneta does not have.**
   - **Tailscale:** the tether asked its own tailscaled who held the
     connection's source address (`tailscale whois`). It answered the
     node, its node key, and its user: `ada`, or `dan@s299.test` for a
     user Headscale made with an email, which is a pine·trie principal as
     it is. Behind `tailscale serve`, the same identity came in the
     `Tailscale-User-Login` header, WebSocket upgrades included.
   - **Nebula:** a node's certificate fixes its address, its name and
     its groups. So the tether named a peer by its source address, from
     the table of certificates the CA signed.
   - **A spoofed source address is dropped by the mesh.** Bea's node
     took Ada's mesh address as its own and sent from it: no answer, on
     either mesh. From its own address it was answered.
   - **Kyneta's `canConnect` sees only the principal a peer states**,
     with no channel, so nothing ties it to the connection the mesh
     named. The probe tied them by reading the connection's first
     `establish` (`@kyneta/wire`) and closing a connection whose stated
     principal was not the mesh's. With that: Ada was accepted, and Bea's
     node stating Ada was refused, before anything synced, over
     Tailscale, behind `serve`, and over Nebula. Without it, Kyneta as it
     is: the same lie was taken, and Bea's node overwrote Ada's draft and
     wrote in the log as Ada. A container not on the mesh, reaching the
     tether's own address, was refused at the upgrade: the mesh named no
     one.
3. **No mesh gives a browser with nothing installed HTTPS it trusts.**
   - **Headscale gives no certificates.** `tailscale cert` answered
     `500 … does not support getting TLS certs`, and `tailscale serve
     --https` `501 Not Implemented` (run). Headscale lists Funnel and
     Serve as unsupported (`docs/about/features.md`, read).
   - **Tailscale's own service** issues Let's Encrypt certificates for
     its `ts.net` names, whose machine names then appear in the public
     certificate log (its "Enabling HTTPS" page, read). The names resolve
     only on a device on the tailnet, so a browser needs the client
     installed, or Funnel, which puts the page on the public internet.
   - **Nebula** has no names or certificates for browsers (read).
   - **A device on the mesh reaches a secure context with no
     certificate at all** (run). In headless Chromium on a node (the lane,
     joined in userspace mode), the tether's page at its mesh address was
     not a secure context and had no Web Locks. The same page at
     `http://localhost:9000`, forwarded over the mesh to the tether, was a
     secure context with Web Locks, and its WebSocket opened. The tether
     saw the connection as the lane's node (`lane@s299.test`): a
     browser's identity is its device's.
4. **Joining asks more than an invite link.**
   - **With a key:** an admin makes a pre-authorised key for the user
     (`headscale preauthkeys create`), and the person installs the
     client and runs `tailscale up --login-server=… --authkey=…`.
   - **Without one:** the person runs `tailscale up --login-server=…`,
     the node prints a link (`/register/hskey-authreq-…`), and an admin
     approves it (`headscale auth register --auth-id … --user eve`).
     Headscale can register users through an identity provider instead
     (OIDC, read).
   - **Nebula:** the CA's holder signs a certificate for each node and
     hands it over, with no server at all.
   - **Who runs the coordination server** is whoever holds the mesh: it
     registers nodes, so it can register a node as any user. The proof is
     only as good as that server, or Nebula's CA key.
5. **While the coordination server is down, what runs keeps running,
   and nothing new joins** (Headscale over HTTPS):
   - running nodes kept their links: Ada pinged and synced with the
     tether, the tether named Bea from its own copy of the network map,
     and a lie was still refused;
   - a new node with a valid key could not join, and a node that
     restarted could not rejoin: it reported itself logged out, as it
     must fetch the control key first;
   - 40 s after the server came back, all four nodes held one another,
     and the restarted node synced again.

   In a first run with the coordination server on plain HTTP, the two
   nodes that stayed up through the outage were still not back after two
   minutes: each kept dialling port 443 ("forcing port 443 dial due to
   recent noise dial"). That run's output was not kept. Nebula has no
   coordination server; its lighthouse finds peers (read, not run down).
6. **A browser not on the mesh reaches nothing on it.** The tether bound
   to its mesh address, or refusing what the mesh does not name, is out
   of reach from the LAN. Such a browser needs the host to serve it on
   the LAN as now, or Tailscale's Funnel (read).

**Consequences.**

- The kill criterion is not met for proof: the receiving end learns the
  connecting node's identity, and a peer on the mesh cannot be taken for
  another, by its stated principal or by its source address. It is met
  for the network: joining needs a client installed and an admin's key or
  approval, more than an invite link. So a mesh suits peers that run
  pine·trie (hosts, tethers, a person's devices), and browser-only
  collaborators keep the invite link.
- **For ADR-0202**, on direct mesh links:
  - a principal is proven, so `canConnect` and `canWrite` judge a real
    identity, once the connection's identity is bound to its stated
    principal;
  - every member links to the tether, so S293's limit on documents with
    one writer is lifted where members are on the mesh;
  - it proves the link, not each operation: a member can still send
    operations under another seat's Yjs `clientID` over its own proven
    link (S296), so signed intents are still needed for authorship, but
    no longer for knowing who is connected.
- **Kyneta lacks a way for a transport to bind a verified identity to a
  channel**: `canConnect` receives the stated identity only. The probe's
  workaround reads the wire's first message. Worth asking Kyneta's
  authors for a verified identity passed through `handleConnection` to
  `canConnect`.
- **A localhost origin is the way to a secure context on a member's
  device**: pine·trie on the device forwards to its host over the mesh,
  and the page gets lasting seats and Web Locks with no certificate.
  HTTPS for a browser with nothing installed needs a domain and a public
  certificate, or Tailscale's own service, not Headscale.
- **The identity is the device's**: every tab and process on a node
  shares it. Identity headers from `tailscale serve` are only as good as
  the tether listening on loopback alone, since any local process can
  send them.
- **The coordination server is run over HTTPS**, and restarting a node
  waits for it.
- Not measured: Netbird (its README read only: SSO and setup keys
  through a management server), Nebula's lighthouse down, NAT between
  real machines, the Tailscale clients on macOS, iOS and Windows pointed
  at a custom coordination server, and Tailscale's own coordination
  service.

**Method.** In a Linux lane (arm64), with its rootless Docker at
`$DOCKER_HOST`. Images: `headscale/headscale` v0.29.5, and
`tailscale/tailscale` 1.104.1 with Node 22 added (`Containerfile.node`),
each node with `/dev/net/tun` and `NET_ADMIN`, on one Docker network.
`make-ca.sh` made a test CA and a certificate for `headscale`, which
every node trusts through `SSL_CERT_FILE`. `setup.sh` rebuilt the mesh
from nothing: Headscale over HTTPS (`headscale-tls.yaml`, from
`headscale.yaml`), users, keys, and the tether, Ada's and Bea's nodes
(the first runs used `headscale.yaml` over plain HTTP). `probe.ts` is the
tether (in `mesh` mode, binding each connection's stated principal to
the mesh's; in `stated` mode, Kyneta as it is) and a member, run inside
the nodes from the mounted folder (`/probe/probe/probe.ts`, with its
packages installed beside it, `versions.json`). `run-members.sh` ran the
members for `out-mesh.txt` and `out-stated.txt`, `outage.sh` the outage
(`out-outage.txt`), `extras.sh` the outsider, `serve`, spoofed addresses
and certificates (`out-extras.txt`), and `join.sh` a join by link
(`out-join.txt`). `nebula.sh` built the Nebula mesh (`nebula/*.yml`) for
`out-nebula.txt`. For the browser, the lane joined the mesh with
Tailscale's static client in userspace mode (`tailscaled
--tun=userspace-networking --socks5-server`), Headscale published on the
lane's loopback; `forward.ts` forwarded `127.0.0.1:9000` to the tether
through that SOCKS5 proxy, and `browser.ts` drove Playwright's headless
Chromium (`out-browser.txt`). No key or certificate is kept here.
