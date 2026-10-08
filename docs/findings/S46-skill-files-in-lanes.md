# S46 — skill files in a lane, under `/mnt/host`

- **Status:** Answered
- **Led to:** ADR-0036

pi lists skills by their host paths, and an expanded skill names its file and
its directory. Neither exists in a lane: your home directory is not mounted
(ADR-0034). The next change mounts each skill's files read-only in every lane
at `/mnt/host` followed by its host path, so one rule turns any host path into
a lane path and no mount can shadow a directory the image needs. Nothing had
measured mounts at deep paths the image lacks, or unusual paths.

**Answers.**

1. **A read-only mount at a deep path the image does not have works.**
   `--mount type=bind,source=$HOME/.local/share/ai/duane,target=/mnt/host$HOME/.local/share/ai/duane,readonly`
   created every missing directory on the way. The skills were readable
   there, e.g. `/mnt/host/Users/duane/.local/share/ai/duane/skills/plan/SKILL.md`.
2. **It sits beside `/mnt/host-working-copy`:** `/mnt` held both `host` and
   `host-working-copy`, each with its own contents.
3. **A source path with a space works,** as one argument.
4. **A source path with a comma cannot be given to `--mount`:**
   `container run` fails with "unknown directive". The same path works with
   `-v <source>:<target>:ro`, whose separator is a colon instead, so `-v`
   cannot take a path with a colon. A path with both can be mounted neither
   way. The same limit applies to every mount pine·trie makes today, your
   working copy's included.
5. **A skill's own script runs from the mount.** `bash .../comments/scripts/register-scan`
   ran in the lane and reported the same hit as on the host. Writes to the
   mount fail: "Read-only file system".

## What this means for the plan

- Skill directories mount read-only at `/mnt/host` followed by their host
  path. Each is mounted with `--mount` unless its path has a comma, then
  with `-v` unless its path has a colon. A path with both is refused, and
  logged. `planRun`'s other mounts should follow the same rule.
- Skills' scripts work in lanes without change.

## Not measured

- A path with non-ASCII characters.
- Many mounts on one container: a few dozen skill packages.
- A symlinked skill directory as the source.

## Method

`sandbox/s46/probe.sh`, from the repo root, outside the sandbox. It used
pine·trie's default lane image (`pinetrie-lane:efb706bfa489`), your `@duane/skills`
package as a source, and temporary directories under `sandbox/s46/` with a
space and a comma in their names. Everything made was removed.
