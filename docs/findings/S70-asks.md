# S70 — what a stopped run leaves, and the facts ADR-0056's asks rest on

Measured in a lane (Linux, Node 24, jj 0.44.0, pi 0.87.1), for
`PLAN-2026-10-02-asks`. The run probes drove a real host, `startHost` with a
`ScriptedModel` and tools in a throwaway project, as `apps/pineta/e2e/e2e.ts`
section 5 does; they were disposable scripts beside the suites and are kept
under `sandbox/s70-asks/`.

**Answers.**

1. **What each ending leaves as the run's last entries** (measured):

   | case | last entries, oldest first |
   |---|---|
   | Stop while text streams | assistant, `stopReason: "aborted"`, `errorMessage: "Request was aborted"`, the partial text |
   | Stop while a tool call streams | the same: the partial text, and no tool call yet |
   | Stop during a running command | assistant `toolUse` with its call, then its tool result, `isError: true`, "Command aborted". Nothing after: **pi does not ask the model again after a cancelled call** |
   | Stop before the first response | assistant, `aborted`, `errorMessage: "Request was aborted"`, **content empty** (no parts) |
   | Model error | assistant, `stopReason: "error"`, its `errorMessage`, one empty text part |
   | Host restart during a command | the call's result, `isError: true`, "[Tool execution was interrupted. …]", **then the run resumes** and goes on to its answer |
   | Host restart while text streams | the partial text as an assistant message with `stopReason: "error"` and "Assistant request was interrupted. …", **then the run resumes** and goes on to its answer |

   So **the last assistant message can be empty** (a stop before the first
   response, and a model error), and **a restart does not end a run**: pi
   resumes it from the same prompt, and it ends as any other run does. In
   every case measured, an `aborted` ending came from Stop. ADR-0056's
   "interrupted", an abort with no stop record, is then only a stop made
   before stops were recorded, so it is one outcome with stopped: stopped,
   by someone or by no one recorded.

2. **A value can be written while a lane runs** (measured). `setMark`, one
   `Session.setValue`, succeeded with the lane's run active. A stop record
   can be written before the abort.

3. **Reading a span of commits in your repo** (measured on a scratch repo).
   - `jj diff --from A --to B -T <template>` renders each file as a
     `TreeDiffEntry`: `path`, `display_diff_path` and `status` are there, and
     `json()` quotes them. **It has no line counts**: `lines_added` and
     `stat()` do not exist on a `TreeDiffEntry`. `REVISION_READ`'s counts come
     from `self.diff().stat()`, which is a commit's own diff, so a range
     cannot use it.
   - `jj diff --from A --to B --git` prints one `diff --git` section per
     file, in the same order as the template's entries. Its headers are not
     quoted (`diff --git a/d/c c.txt b/d/c c.txt`), so a path is taken from the
     template and the counts from the section in the same place.
   - A commit is readable by id after it is abandoned, so a lane's
     revisions stay readable after a take or a split. A lane's history is in
     your repo as `tip@pineta-<lane>` (`packages/lanes/TECHNICAL.md`, "Moving
     commits").

4. **A turn's changed paths, with git** (measured on a scratch colocated
   repo). `git diff --name-only -z A B` lists paths from the repository's
   root, unquoted, from any directory. Without `-z`, git quotes a path with
   non-ASCII characters (`"d/c \303\251.txt"`).

5. **Presence reaches the host** (measured). The host's presence document
   (`RunningHost.presence`) answered `readReading` with a client's
   `setReading` within the wait: `[["w-uma@s70b.test", "some-entry"]]`. The
   digests can read who is reading a thread there.

6. **An empty aborted or failed message draws today as an empty message**
   (from source). `renderableMessage` keeps an assistant message with no
   text and no calls, and `projectSpine` makes it a node with text `""`.
