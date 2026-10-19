# `@pinetrie/ssh`: technical notes

A lane's ssh through its host (ADR-0140): the settings, the files every lane is given,
the agent protocol, and what the relay does with each request. It declares
nothing (`workspace.test.ts`), as `@pinetrie/channel` does, since a lane's
hop runs it from pine·trie's install on the lane runtime's Node, by
`@pinetrie/install`'s command for it. Only the
app declares it: `@pinetrie/lanes` and `@pinetrie/docker` know a host
socket, mounts, variables and start-up commands, never ssh. It is the only
code that speaks the agent protocol or reads ssh config. A lane is an
opaque string here; the app brands it.

The evidence is S174 (`docs/findings/`): every rule below that says how
OpenSSH behaves was measured there, against OpenSSH 10.0p2.

## Where things are

| module | holds |
|---|---|
| `settings.ts` | `lanes.ssh` as the host's config settled it, decided (`personalSsh`); host patterns as written, case kept (`parseHostPatterns`); and what the host adds (`personalOnHost`) |
| `patterns.ts` | ssh's host patterns, a list's comma lists split once (`hostPatternList`), matched as OpenSSH's `match_pattern_list` (`isHostAllowed`) |
| `names.ts` | what a lane hands the host, branded once checked: `SshName`, `SshPort`, `LaneToken` |
| `hop-line.ts` | the first line of a hop's connection, decoded only through a token that checks |
| `config.ts` | ssh config text: lines, `Host` blocks, `Include`s put in place |
| `lane-files.ts` | what a lane gets at `/pinetrie-ssh`: its config, `known_hosts` and public keys (`planLaneSsh`), the host keys personal identity may sign for, and the allowed hosts that kept no line; a host as `known_hosts` names it (`knownHostsName`) |
| `keys.ts` | whether a key pair in the service folder can be a service identity |
| `wire.ts` | SSH's wire format, which the agent protocol, key blobs and `openssh-key-v1` keys share: one reader, one string encoder |
| `agent.ts` | the agent protocol: framing, the requests the relay knows, their encoders |
| `relay-step.ts` | one request's step on one lane's agent connection (`relayStep`), and the sessions bound on it |
| `resolve.ts` | the file of `Include`s `ssh -G` reads (`CombinedConfig`), its answer (`parseResolved`), what the broker does with a name (`brokerTarget`), and the name ssh checks a host's key under (`checkedHostName`) |
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
  it. Your files alone narrow it (`hosts`). Refused `hosts` turn it off
  rather than widening it to every host.
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
  newest name for the lane, else the key's fingerprint. The app answers at
  once, and the relay holds nothing: a key not yet allowed is refused,
  the request waits in the lane's record for its owner, however long, and
  an allowance wakes the lane to try again (ADR-0178).
- **Narrowed personal hosts are enforced by host key, not by config.** A
  personal sign is refused unless its session (the first string of a
  login's data) was bound to a key from the person's kept `known_hosts`
  lines. A binding is remembered (`withBinding`) only after an OpenSSH
  agent accepted its signature (S174 item 11), so a lane cannot bind an
  allowed host's key to a session it opened elsewhere.
- **An allowed name keeps the lines under the name ssh checks its key
  under** (ADR-0170, S238). The host resolves each name of
  `lanes.ssh.hosts` with `ssh -G` against the combined config, with no
  `-p` (it would override the config's `Port`), in the case the person
  wrote it: ssh matches `Host` as typed. The checked name is the
  `HostKeyAlias`, else the host name as `[name]:port` off port 22, and a
  line is kept when an entry equals it, clear or hashed, as well as when a
  pattern matches it as written. A wildcard is never resolved. Allowing a
  name allows its server: another alias with the same host key signs too.
- **A signature refused for a host outside the allowed ones is said,
  never asked** (ADR-0170). The relay tells it apart (`outside`) from its
  other refusals and the app records it: `lanes.ssh.hosts` is the owner's
  answer already. It is named by the host's own `known_hosts`, which names
  keys the lane is not given, else by the broker's newest name for the
  lane.
- **Nothing resolves a name before the combined config is written:** only
  `writeCombinedConfig` makes a `CombinedConfig`, which `resolveArgv`
  takes.
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
- **The app is asked one question,** `mayUsePersonal(lane, host)`, which it
  answers at once (ADR-0178), and told two things: `used` (a service
  identity signed, the broker connected a name) and `outside` (a personal
  signature refused for a host not allowed). Answers and records are the
  app's: the package never sees a thread.
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
  whatever is left of its input: a take-back's cut, or the remote's close.
  Its socket allows half-open, and ssh never half-closes a session, so
  waiting for its input to end would leave it running after a cut.

## Gotchas

- **A default sshd ends a login at 120 s** (`LoginGraceTime`), whatever an
  agent holds (S174 item 2): why no personal signature waits for its owner
  (ADR-0178).
- **ssh reads only the last `-F`;** a file of absolute `Include`s combines
  two. A relative `Include` resolves under `~/.ssh/`, and one not found is
  skipped without a word.
- **An `Include` inside a block** is read in that block, and ssh returns to
  the block after it: `inlineIncludes` writes the block's header again
  after an included text that opens blocks of its own.
- **ssh checks a host's key under its `HostKeyAlias` or `HostName`, never
  the alias typed** (S174 item 8, S238): a person's `known_hosts` names
  `hql`'s server as `192.168.1.2`. A hashed entry matches only the whole
  name, `[name]:port` included, so a wildcard never matches one.
- **ssh lowercases what it prints and records, but matches `Host` as
  typed** (S238): `ssh -G HQL` does not read a `Host hql` block.
- **An entry of `lanes.ssh.hosts` may be a comma-separated list,** as a
  `Host` line's patterns are: split it before matching or hashing
  (`hostPatternList`).
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
