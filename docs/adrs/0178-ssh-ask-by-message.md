# ADR-0178 — A lane's request for its owner's ssh is a message, not a wait: the signature is refused at once, the agent is told, the request stays until its owner answers, and an approval wakes the lane

- **Status:** Accepted (Duane, 2026-10-18)
- **Area:** `packages/ssh/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`,
  `packages/rules/TECHNICAL.md`, `packages/interface/TECHNICAL.md`,
  `packages/pi/TECHNICAL.md`, `docs/06-interface.md`
- **Evidence:** S174, S103, S71
- **Amends:**
  - ADR-0140: a lane's first personal signature is refused at once, not held.
    Its request waits in the lane's access record for as long as the owner
    takes, with no `approvalSeconds`, and an approval wakes the lane to try
    again.
  - ADR-0128: an owner's answer to a lane's ssh request wakes that lane, as an
    answer to an agent's ask wakes the asker. A refusal wakes nobody.

**Context.**

- **A person's decision was tied to ssh's signing window.** The relay held
  a lane's first personal signature until its owner answered, for
  `approvalSeconds` (120 by default). A default sshd ends a login at 120 s
  whatever the relay does (S174 item 2), so an approval only counted if
  the owner saw the request within two minutes.
- **The request was easy to miss, and gone soon.** It showed as a small
  line in the column's header, and in the inbox only while it waited. An
  owner looking at another column, or away, came back to "no answer" and
  a failed command.
- **The agent could not tell what happened.** It saw ssh hang, then fail.
  It guessed that a request was open, and asked its owner to look for a
  prompt that had already expired.

**Decision.**

- **A personal signature not yet approved is refused at once,** and its
  request written. The relay holds nothing: ssh shrugs off a refused
  signature and tries its next key, then reports "Permission denied"
  (S174 item 3). The lane's access record says `waiting`, with no
  deadline. `lanes.ssh.approvalSeconds` and the `unanswered` state go,
  and so do the held signatures, their timers, and an approval's
  releasing them.
- **A request stays until its owner answers.** It is in the owner's inbox
  until approved or refused, on every device, and the column's header
  marks it as needing them. A host that starts keeps it: nothing was held
  that a restart could lose.
- **The agent is told at once, in its run.** As it writes a request, the
  host steers a fact into the lane, once per request: its owner has been
  asked to let it use their ssh for that host; ssh is refused until they
  answer; it should not retry, but finish what it can and end its turn
  saying it waits for that approval. pi places a steer after the tool
  results of the turn in flight (S103 item 4, S71 item 4), so the agent
  reads the failed `ssh` call first, then why it failed.
- **Answers reach the lane the way an answer to an ask does** (ADR-0128):
  - **An approval wakes the lane.** An idle lane runs, its prompt a
    carry-on by the owner whose reason is the approval: it says the owner
    approved its ssh for that host and that it may try again. A running
    one has the same message steered in. Approval stays until revoked, as
    before, so the retry signs at once. The wake is the owner's own
    action, so it runs as their carry-on does: their budget, and their
    inbox when it ends.
  - **A refusal wakes nobody.** It is appended to the thread as a fact,
    or steered into a running lane, so the agent does not ask again.
  - **A revoke** cuts the lane's sessions, as before, and is told the same
    way as a refusal.
- **What a lane is told is host messages** in the thread's history, each
  naming its host: a request, a refusal and a revoke as facts, never a
  run's prompt, and an approval as the carry-on that wakes it. They store
  the code's values, as every host message does.

**Consequences.**

- An owner can answer hours later, from any device, and the lane carries
  on by itself. Being away costs a wait, not a failure.
- When the owner is watching, the first `ssh` fails rather than waiting a
  moment for a click, and an approval costs one more run of the lane.
- `lanes.ssh.approvalSeconds` is no longer a setting. A file that still
  sets it gets the refusal any unknown setting gets.
- `pinetrie.access` records change shape again: `unanswered` is gone. A
  record stored before this stops decoding, so its lane asks again.
- The relay no longer waits on the app. Its question to the app becomes
  whether a lane is approved, answered at once from the record.

**Alternatives rejected.**

- **Show the request where the owner is looking: a card at the foot of the
  column, a louder header row.** It helps an owner who is watching, but a
  request still expires in two minutes for one who is not, and the agent
  still cannot tell what happened. The run's end now says it waits for
  approval, which the inbox raises as needing you.
- **A longer `approvalSeconds`.** sshd's `LoginGraceTime` (120 s by
  default) ends the login first, so a longer wait buys nothing.
- **Approval with no wake, for the owner to resume.** An owner who approves
  from the inbox, away from the column, would have to find the thread and
  resume it, which brings back the delay this removes. The wake follows
  only the owner's own action.
- **Hold briefly when the owner is present.** Presence is guessed and
  decays (`docs/06-interface.md`, Settled while planning), and the agent
  would again see two kinds of behaviour for one request.
