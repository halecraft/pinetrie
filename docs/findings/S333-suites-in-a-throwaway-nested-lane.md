# S333 — Can a run started on the Mac run the end-to-end suites' lane-only scenarios in a throwaway nested lane?

- **Status:** Open

**Question.** Some scenarios and checks can run only inside a pine·trie
lane, on its rootless Docker (the checks `e2e:lanes` makes there and skips
on the Mac's rootful VM, and the reverse), and `e2e:observer` needs
`qemu-system-aarch64`, which neither the Mac nor the lane image has. S332
showed a run on the Mac can make a plain lane and run unit tests in it.
For the suites:

1. Does a throwaway lane with `nested: true`, made by a script as S332's
   probe makes one, run `pnpm run e2e:lanes` from a copy of the checkout,
   and which checks pass, skip or fail there that the Mac's run did not?
2. What does it take: the inner Docker's first lane image build (about 3
   minutes from cold, S232), and the run?
3. Can such a lane run the browser suite (its Chromium) and the observer
   suite (with `qemu` installed in the lane at run time)?

**Kill criterion.** A scenario that passes in a thread's nested lane and
fails in the throwaway one, or a lane that cannot get `qemu`.

**Throw away.** The lane, its disk, its inner Docker and the throwaway
project.
