# S237 — A root dockerd started with `--config-file` applies `builder.gc` as the rootless one does

- **Status:** Answered
- **Led to:** ADR-0169

**Question.** ADR-0169 caps the lane VM's dockerd's build cache with the
same `builder.gc` setting S234 measured in a nested lane's rootless
daemon. The VM's dockerd is root, started by the VM's `init` with flags,
and its root file system is read-only, so its setting would come from a
file the image carries, named by `--config-file`. Does a root dockerd of
the VM's Docker version read `builder.gc` from such a file, and apply it
to BuildKit's policy as the rootless daemon did?

**Kill criterion.** If the root daemon ignores the setting from
`--config-file`, or applies it otherwise, the VM's cap needs another
mechanism.

**Throw away.** The probe's container and its image.

## Answers

Measured 2026-10-18 in the Mac's lane VM, whose Docker is 29.5.2: Docker's
`docker:29.5.2-dind` image run privileged, its root dockerd started with
`--config-file` naming a file holding only `builder.gc` (`enabled`,
`defaultReservedSpace` 256MB, `defaultMaxUsedSpace` 512MB,
`defaultMinFreeSpace` 1GB).

- `docker buildx inspect --bootstrap` in it showed the policy S234's
  rootless daemon showed for the same values: rule 0 for local sources,
  cache mounts and git checkouts with its own limits (48 h, 488.3 MiB);
  rules 1 to 3 with reserved 256 MiB, max used 512 MiB and min free
  1 GiB, rule 1 keeping 1440 h and rule 3 `All`.
- The daemon needs no other key in the file: a `daemon.json` holding
  `builder` alone is accepted.

Not measured here: a trim by the root daemon. The policy is BuildKit's in
both, and S234 measured how BuildKit applies it.
