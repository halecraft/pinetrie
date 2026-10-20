# pine·trie

A collaborative agentic harness: pi's agent core on Kyneta's CRDT
substrate, where the conversation is a tree, not a transcript. Branch from
any message and run several branches at once, work in the same tree with
other people live, and fold what a branch found back into the trunk. Each
thread's agent works in a container of its own, on a copy of your project,
and what it changes reaches your repo as proposed changes you accept.

## What it needs

- Node 24 or later, and [jj](https://jj-vcs.github.io/jj/).
- On macOS: Apple silicon, Xcode's command line tools (the lane VM's
  launcher is compiled with `swiftc`), and the Docker CLI with buildx. No
  Docker engine: lanes run in a VM pine·trie starts.
- On Linux, arm64 or x86_64: Docker, with pine·trie's lanes directory
  (`$XDG_STATE_HOME/pinetrie/lanes`) on btrfs.

## Install

```sh
npm install -g pinetrie
```

## Use

```sh
pinetrie serve [folder]          # the folder, or the current one, at http://localhost:7391
pinetrie sign-in <provider>      # a subscription in a browser, or an API key
pinetrie sign-in                 # the providers, and which are signed in
pinetrie sign-out <provider>
pinetrie tidy [folder]           # cut a repo's operation log to a window
pinetrie session rename <old> <new>
```

A Claude subscription works once you sign in to `anthropic`: pine·trie
ships the pi extension its requests need, so there is nothing to install.

A start draws a checklist of what it does, each step with what it is
expected to take. The first start, and any after an update that changes an
image, builds the lanes' images for a few minutes; once it says
`listening`, every thread's agent can work.

Settings are `pinetrie.json` files: the machine's, yours
(`~/.config/pinetrie/pinetrie.json`), the project's, and yours for one
project, from the broadest to the most specific. `docs/pinetrie.md`
("Your config") says which may set what.

## Developing pine·trie

From a clone, with pnpm:

```sh
pnpm install --frozen-lockfile
pnpm dev [folder]
```

Start with `docs/pinetrie.md`, and `AGENTS.md` for how the work is done.

## License

MIT
