# S260 — What does a clean Mac need before an installed pine·trie runs a lane?

- **Status:** Open

On the Mac, lanes run in the lane VM (`packages/vm`). The host compiles
its two binaries from Swift with `xcrun swiftc` and signs them ad hoc
with the virtualization entitlement (`packages/vm/swift.ts`), and reads
`gvproxy`'s pin from `packages/vm/launcher/gvproxy.json`. The lane image
pins jj to the host's own (`hostJjVersion`, `packages/lanes/image.ts`).
The host watches folders with `@parcel/watcher`, a native module the
repo lists in `ignoredBuiltDependencies`, so pnpm never builds it here:
a prebuilt binary is what loads. None of this has run from an npm
install, or on a Mac set up only for it.

## Brief

**Size:** S · **Depends on:** S257 (the tarball)

**Question.** On a macOS user account with Node 24 and nothing else from
pine·trie's setup, after `npm install -g` of S257's tarball:

1. Does `@parcel/watcher` load from npm's install, on arm64?
2. What is missing before the first lane starts: Xcode's command line
   tools for `swiftc`, jj, anything else? What does the host say for
   each, and when (at start, or at the first lane)?

**Kill criterion.** If the VM needs anything beyond Xcode's command line
tools and jj, the package states it as a prerequisite and the host
checks it at start; if `@parcel/watcher` does not load, the package
needs a different watcher or a build step on install, and that is its
own task.

**Throw away.** The account's install and state directory.
