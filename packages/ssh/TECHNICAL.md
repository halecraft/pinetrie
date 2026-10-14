# `@pinetrie/ssh`: technical notes

A lane's ssh through its host (ADR-0140): the settings, the files every lane is given,
the agent protocol, and what the relay does with each request. It declares
nothing (`workspace.test.ts`), as `@pinetrie/channel` does, since a lane's
hop runs it from pine·trie's install on the lane runtime's Node. Only the
app declares it: `@pinetrie/lanes` and `@pinetrie/docker` know a host
socket, mounts, variables and start-up commands, never ssh. It is the only
code that speaks the agent protocol or reads ssh config. A lane is an
opaque string here; the app brands it.

The evidence is S174 (`docs/findings/`): every rule below that says how
OpenSSH behaves was measured there, against OpenSSH 10.0p2.

## Where things are

| module | holds |
|---|---|
| `settings.ts` | `lanes.ssh` as the host's config settled it, decided (`sshSettings`); host patterns as written (`parseHostPatterns`); and what the host adds (`settingsOnHost`) |
| `patterns.ts` | ssh's host patterns (`isHostAllowed`), as OpenSSH's `match_pattern_list` |
| `names.ts` | what a lane hands the host, branded once checked: `SshName`, `SshPort`, `LaneToken` |
| `hop-line.ts` | the first line of a hop's connection, decoded only through a token that checks |
| `config.ts` | ssh config text: lines, `Host` blocks, `Include`s put in place |
| `lane-files.ts` | what a lane gets at `/pinetrie-ssh`: its config, `known_hosts` and public keys (`planLaneSsh`), and the host keys personal identity may sign for |
| `keys.ts` | whether a key pair in the service folder can be a service identity |
| `wire.ts` | SSH's wire format, which the agent protocol, key blobs and `openssh-key-v1` keys share: one reader, one string encoder |
| `agent.ts` | the agent protocol: framing, the requests the relay knows, their encoders |
| `relay-step.ts` | one request's step on one lane's agent connection (`relayStep`), and the sessions bound on it |
| `resolve.ts` | what the broker does with a name, from `ssh -G`'s answer (`brokerTarget`) |
| `splice.ts` | two streams joined both ways with half-close, and a connection's first line |
| `programs.ts` | the OpenSSH programs the host runs: a runner that never throws, and `startServiceAgent` |
| `host.ts` | the host's socket (`startSshHost`): the relay and the broker, and `cut` |
| `hop.ts` | run in a lane: `serve`, its `SSH_AUTH_SOCK`, and `connect`, its `ProxyCommand` |

## Rules

- **Personal identity:** `lanes.ssh.personal`, one shape in every layer.
  The host's table settles it (ADR-0146): the project grants it, and your
  own file or your file for the project grants or declines it, after the
  project's, so your choice wins; a system file's `false` forbids it. This
  package takes the settled value and who decided it (`PersonalChoice`): a
  person's grant reaches every lane, a project's only the lanes that keep
  it. Your files alone narrow it (`hosts`) or set the wait
  (`approvalSeconds`, 10 to 600, else 120 and a refusal). Refused `hosts`
  turn it off rather than widening it to every host.
- **A token carries its lane:** `<lane, base64url>.<HMAC-SHA256, hex>`. The
  host keeps no table of tokens: `tokenLane` reads the lane back and
  compares the MAC in constant time. A lane is only ever known through a
  token that checked (`decodeHopLine`).
- **A name reaches `ssh -G` only as an `SshName`:** no leading `-`, which ssh
  would read as an option, and nothing a shell would read.
- **Only typed requests reach an agent.** `decodeAgentRequest` knows
  listing, signing and `session-bind@openssh.com`; everything else, adding,
  removing and locking keys and every other extension, is `other`, and
  `relayStep` refuses it. What goes on to an agent is re-encoded from the
  decoded fields (`encodeSign`, `encodeBind`), never the bytes a lane sent.
- **A service key wins.** It signs with no question, even when the person's
  agent holds the same key, and the relay lists service keys first: ssh
  offers agent keys in the agent's order, whatever its config's order
  (S174 item 5).
- **A personal key asks** the app's policy, naming the host the session was
  bound to: as the lane's `known_hosts` names its key, else the broker's
  newest name for the lane, else the key's fingerprint.
- **Narrowed personal hosts are enforced by host key, not by config.** A
  personal sign is refused unless its session (the first string of a
  login's data) was bound to a key from the person's kept `known_hosts`
  lines. A binding is remembered (`withBinding`) only after an OpenSSH
  agent accepted its signature (S174 item 11), so a lane cannot bind an
  allowed host's key to a session it opened elsewhere.
- **A lane's config is written from typed lines.** Only `CARRIED` keywords
  reach it, so a person's `ProxyCommand`, `LocalCommand` or `Match` never
  runs or decides in a lane. Service blocks come first: ssh keeps a
  setting's first value, so the service's wins and `IdentityFile`s add up,
  the service's first.
- **Blocks are copied, not resolved.** A pattern (`*.prod`) or a token
  (`HostName %h.corp`) must reach the lane's own ssh: only a concrete name
  can be resolved with `ssh -G`. Every personal block is carried even when
  hosts are narrowed: its patterns cannot be told apart from the hosts they
  serve, and `Host *` defaults serve the allowed ones too.
- **An `IdentityFile` becomes its public key's copy** under `keys/`, and its
  block says `IdentitiesOnly yes`: an agent holding many keys would use up
  sshd's `MaxAuthTries` (S174 item 6). A relative service path is in the
  service folder and must stay there; a relative personal path, which ssh
  resolves where it runs, and a per-connection token (`%h`) are dropped,
  and said.
- **The broker's `ProxyCommand` is in the last `Host *` alone,** so a
  block's `ProxyJump`, which comes first, still wins, as it does on the
  host. With no broker (no `ssh` on the host) there is none, and lanes
  connect directly.
- **A service key is refused before anything runs:** group or others may
  read it (ssh refuses it too), it has a passphrase (`openssh-key-v1`'s
  cipher is not `none`; a PEM key says `ENCRYPTED`), or no `.pub` is beside
  it.

## The host's socket (`host.ts`)

- **One socket for every lane of a host,** mode 0777: the token admits a
  connection, and a nested lane's rootless Docker mounts the socket as
  another user. Its first line is read (at most `HOP_LINE_LIMIT` bytes)
  and checked; anything else is closed.
- **The app is asked one question,** `mayUsePersonal(lane, host)`, and told
  one thing, `used` (a service identity signed, the broker connected a
  name). Approvals, records and timeouts are the app's: the package never
  sees a thread.
- **An agent connection is relayed one request at a time,** as the protocol
  is, each lane connection with its own connections to the service agent
  and the person's. Every request that needs them lists both agents
  afresh, so a key added to an agent is seen at once.
- **The relay ends its side when the lane ends its,** after the replies to
  what came before: the socket allows half-open, and a hop's connection
  would otherwise stay half-closed for good.
- **The service agent is the host's own `ssh-agent`** (`startServiceAgent`),
  started even with no service keys: it checks every session binding. A
  binding it refuses is answered `SSH_AGENT_FAILURE`, which ssh shrugs off.
  An accepted one is passed to the person's agent too, which applies its
  own destination constraints.
- **The broker answers before any of the connection's bytes:** `ok`, or
  `refused <why>` (`proxycommand`, `unresolved`, `unreachable`,
  `no-broker`), which the hop says on stderr and exits 255, as ssh does,
  rather than leave ssh a closed connection to puzzle over.
- **`cut(lane)` destroys every connection the lane holds,** agent and
  broker alike: a session ends within milliseconds (S174 item 8).
- **The hop's `serve` removes a socket left at its path first:** a
  container's `/run` outlives its stop. So a socket file proves no hop
  listens: wait until `ssh-add -l` stops exiting 2 ("cannot connect").
- **The hop's `connect` ends with the host's end of its connection,**
  whatever is left of its input: a revoke's cut, or the remote's close.
  Its socket allows half-open, and ssh never half-closes a session, so
  waiting for its input to end would leave it running after a cut.

## Gotchas

- **A default sshd ends a login at 120 s** (`LoginGraceTime`): a personal
  signature held longer than that fails at the server, whatever the wait.
- **ssh reads only the last `-F`;** a file of absolute `Include`s combines
  two. A relative `Include` resolves under `~/.ssh/`, and one not found is
  skipped without a word.
- **An `Include` inside a block** is read in that block, and ssh returns to
  the block after it: `inlineIncludes` writes the block's header again
  after an included text that opens blocks of its own.
- **A wildcard never matches a hashed `known_hosts` line:** only a concrete
  name can be hashed and compared. A host on another port is hashed as
  `[name]:port`, which a bare name does not match either.
- **`@cert-authority` lines** name a CA, not a host's key: narrowed, a host
  that presents a certificate is not among the keys personal identity may
  sign for.

## Tests

One test file beside each module. `host.test.ts` runs the host's socket,
the broker and both halves of the hop with real unix sockets and fake
agents written in the test, no ssh programs. `testdata/openssh-login.txt` is a real
login's agent messages, captured from OpenSSH 10.0p2: a binding, a list
and a sign, which decode and re-encode to the same bytes. Mutations are
`scripts/mutations/ssh.ts`.
