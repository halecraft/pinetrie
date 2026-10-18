# S238 — ssh checks a host's key under its `HostKeyAlias`, else its `HostName` (as `[name]:port` off port 22), and `ssh -G` prints each, so the host can learn the name for an alias

- **Status:** Answered
- **Led to:** ADR-0170

**Question.** Narrowed personal hosts (`lanes.ssh.hosts`) keep the
person's `known_hosts` lines whose names match a pattern. A person writes
an alias (`hql`), but ssh records and checks a host key under another
name (S174 item 8: `HostName` and `Port`). For each alias, can the host
learn the exact name ssh checks the key under, from its own `ssh -G`?
Specifically:
- What does `ssh -G` print for `HostName`, `Port` and `HostKeyAlias`, and
  does it expand a `%h` token in `HostName`?
- Under what name does ssh write and check a key with `HostKeyAlias` set,
  with and without a port other than 22?
- Does a hashed line hash the same name, port included?

**Kill criterion.** If `ssh -G` does not print the values ssh checks a
key under, or ssh checks a key under a name `ssh -G` cannot give, the
host cannot learn an alias's name without parsing ssh config itself, and
a narrowed alias has to be written as its address.

**Throw away.** The probe: a config of five `Host` blocks, and an ssh
login with `ProxyCommand nc 192.168.1.2 22`, an empty
`UserKnownHostsFile`, `StrictHostKeyChecking accept-new` and
`PreferredAuthentications none`, so each run wrote the key's line and
stopped before authenticating. Run on the Mac, OpenSSH 10.3p1, against
`192.168.1.2` (OpenSSH 8.9p1).

**Answers.**

1. **`ssh -G` prints what ssh checks under.** For each block, `ssh -G -F
   cfg <alias>` printed `hostname`, `port`, and `hostkeyalias` only when
   one was set. `HostName %h.example` printed `hostname
   tokened.example`: the token is expanded. With a `ProxyCommand`,
   `checkhostip` was `no` throughout, so only the host's name is
   checked, never its address beside it.
2. **The name ssh writes, and checks, is**:
   - `HostName 192.168.1.2`: `192.168.1.2`.
   - with `Port 2222` too: `[192.168.1.2]:2222`.
   - with `HostKeyAlias hq-box`, on port 22 or 2222: `hq-box`, with no
     port in either case.
   So the name is the alias when one is set, else the host name,
   bracketed with its port when the port is not 22.
3. **A hashed line hashes that same name.** With `HashKnownHosts yes` and
   `Port 2222`, `ssh-keygen -F '[192.168.1.2]:2222'` found the hashed
   line and `ssh-keygen -F 192.168.1.2` did not. So a hashed entry
   matches only the full name, port included.
4. **ssh lowercases what it prints and records, but matches `Host` as
   typed.**
   - `HostName MixedCase.Example` printed `hostname mixedcase.example`.
   - `HostKeyAlias HQ-Box` printed `hostkeyalias hq-box`, and the key was
     recorded as `hq-box`.
   - `ssh -G UPPER` against a config whose block is `Host upper` printed
     `hostname upper`: the block did not apply. Connecting as `UP2` to a
     `Host up2` block recorded the key as `up2`, not under the block's
     `HostName`.
   So a checked name is always lowercase, and a name must be resolved in
   the case the person's config writes it.
5. **The case that prompted this.** On the Mac, `~/.ssh/known_hosts` names
   `hql`'s server only as `192.168.1.2`. With `lanes.ssh.hosts: ["hql"]`,
   the lane's `known_hosts` was empty: no line matched the pattern `hql`,
   so personal identity could sign for no host, and the relay refused
   every signature without asking.
