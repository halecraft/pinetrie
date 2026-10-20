# ADR-0193 — Each host operation reads its facts once, calls one plan and carries it out; a package exports the plan, not its parts; a card command's change is its plan's by construction

- **Status:** Accepted (Duane, 2026-10-20)
- **Area:** `docs/01-architecture.md`, `packages/rules/TECHNICAL.md`,
  `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S279
- **Amended by:**
  - ADR-0199: a refusal's words are not the shell's; the plan returns its
    reason, and the owner of its reader words it.

**Context.** pine·trie's shell gathers, plans and executes, command by
command, but S279 found it often strings several pure functions together
around a plan. Before its pilot, 68 of 475 host operations did: a plan,
then helpers over its result (a move's emptied canvases, a paste's
drains); a record built in the shell (`setRecord` in 21 host files);
facts derived from what was read (`indexAsks` before `planBranchOut`; the
folder adapter's four-step reading of a lane's states, written four
times). Each such helper is a package export for one caller, the host
imports about 400 names from rules, and the part of each decision that
sits in the shell is proven only by a host or browser suite.

Nothing stopped the shell editing what a plan decided either. It could
add a step to a plan's steps, carry steps it built itself, or leave a
move's history out: the shell's `carry` took the gesture as an optional
last argument, and five mutations existed only to catch it left out.

The pilot planned six card commands whole: the shell's package values
went from 48 to 28, rules' index lost 15 names, and twelve unit mutations
in rules now prove what six host unit mutations proved through the shell;
three of the four suite mutations on its lines are caught by unit tests
too (S279).

**Decision.**

- **A package exports an operation's plan, not its parts.** For each
  operation the host carries out, the deciding package exports one plan,
  its facts' type and its result's type. A planner or helper the plan
  builds on is exported from its module, for its siblings and tests, and
  not from the index. A name stays in the index when another package
  decides with it on its own: a page's view, a session's prediction.
  Since a package's manifest exports only its index, a planner left out of
  it is out of the host's reach.
- **The shell combines nothing.** It reads the facts, calls the plan and
  carries out the result. It calls a second plan only across a phase: I/O
  the first plan's result asks for (a history's stack, a revert, a jj
  step) before the next decision. Whether to write, and what, is the
  plan's. Whether to refuse is the plan's (a `why`); the refusal's code and
  words are the shell's, in one function per plan.
- **Facts are values.** A plan's facts are read before it runs. One that
  reads while it runs is a function only where no value can stand in:
  minting ids for what the plan makes. A plan cannot read anyway: the
  deciding packages declare no document, no read and no Kyneta.
- **Where a family has one way to carry its plans out, it takes only what
  a plan made.** The plan's lists carry a brand only the deciding module
  stamps, as the gate's pass (`Cleared`, `packages/rules/gate.ts`) is a
  value only the gate makes; the brand is on the lists, since a spread
  keeps an object's brand and a new list loses it. A types test proves
  the shell cannot build a plan or edit one. A phase whose second decision
  must follow the first across I/O takes a value only the first made.
- **A `plan…` function lives in the host** when it decides what only the
  host knows of: routes, the invocation, the store, the start, shutdown,
  the upkeep of roots. It lives in a package when it decides about that
  package's shape.

**Consequences.**

- Card commands are planned in `packages/rules/card-commands.ts`, each
  returning a `CardPlan`, and carried out by one function in the shell;
  a change a card command writes is exactly a plan's steps, and a history
  left out does not compile.
- A decision moved out of the shell is proven by its plan's unit test;
  the host's tests of a command prove the carrying.
- Rules' index shrinks as each family moves, and grows by one plan, its
  facts and its result per operation.
- The facts a plan takes are wider than any one helper's arguments: a
  command reads, once, everything its plan may need.

**Alternatives rejected.**

- **Prune the indexes and leave the shell.** The indexes would shrink,
  but the shell would keep deciding between plans, proven only by suites,
  and import the same helpers.
- **Move every host `plan…` into packages.** 32 of 37 decide what only the
  host knows of (S279); moved, each adds an export and frees none.
- **Change each planner in place** to return the command's whole result.
  The planners' step-level results are what a session's prediction and
  their own tests use; a command layer wraps them, so each family's result
  is one type.
- **A brand on the plan object.** A spread keeps it, so the shell could
  still add a step.
- **A check that the shell calls one plan.** Over names it would judge
  names, not decisions, and phases call two; the brand, the index and the
  plans' unit tests hold what matters.
