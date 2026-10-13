# S175 — A nested lane's rootless Docker gives its inner containers no cgroup of their own: by cgroup, an inner lane is its outer lane

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** The observer's plan forwards a nested lane's records to its
inner host by the inner lane's cgroup: a run begins only in a registered
cgroup, and its events carry that cgroup as their lane. That rests on each
inner container being in a cgroup of its own, under its outer lane's. Is it,
under the rootless Docker a lane granted `lanes.nested` runs?

**Kill criterion.** If an inner container shares its outer lane's cgroup,
the kernel cannot tell an inner lane's runs from the outer lane's by
cgroup, and Phase 4's design does not hold.

## Answers

Measured in a pine·trie lane granted `lanes.nested`, 2026-10-13, on its
rootless Docker 29.8.2:

- `docker info`: cgroup driver `none`, cgroup version 2.
- The lane's own process: `/proc/self/cgroup` is `0::/`.
- An inner container (`docker run alpine sleep`): `/proc/<pid>/cgroup` is
  `0::/`, the same cgroup. Its `NSpid` is `621 1`: a pid namespace of its
  own.

So every inner container is in its outer lane's cgroup, and only its pid
namespace sets it apart. The kill criterion fires: a nested lane's records
cannot be told apart by cgroup. A lane's identity in the kernel would have
to be what does separate them, as its first process's pid namespace, which
a process cannot leave and which `docker exec` joins.

**Not answered here:** whether a pid namespace as a lane's identity holds
everything the cgroup did (a run's tag carries it whatever the task does
after, and a host registers it by the lane's first process alike); and how
an inner host's registration is checked to be its own lane's.
