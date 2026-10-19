# S286 — Rules does not split by reader: a record's shape and the host's decisions about it share a module

- **Status:** Answered
- **Led to:** ADR-0201

**Question.** For every export of `@pinetrie/rules` (its `index.ts`,
`./ignores` and `./fixtures`), resolved by the TypeScript checker, which
packages name it, in source and in tests? Each module of rules is then:

- **host only:** named outside rules by the app alone;
- **host and pi:** by the app and `pi`, no reader of the page;
- **shared:** by any of `reads`, `session`, `interface`, `web`.

1. How many modules, lines and exports are in each group?
2. Is the shared group, closed under rules' own value imports (what a
   module loads at run time) and type imports, disjoint from the host's
   modules? Which host-only modules does it reach, and through which
   declarations?
3. Which modules mix: some exports shared, some host only?

**Kill criterion.** If the shared group, closed under rules' own imports,
takes in more than half of rules' lines, a host side split off (a
sub-export or a package) narrows little of what the page's packages load:
drop it, and keep rules whole.

**Throw away.** As S285.

## Answers

1. **By module, most of rules is shared already.** Of 88 modules (19,315
   lines, `index.ts` and `fixtures.ts` aside), 54 have an export that
   `reads`, `session`, `interface` or `web` names: 14,273 lines (74%).
   12 modules (2,633 lines) are named by the app and `pi` only, 17
   (1,988 lines) by the app alone, and 5 (421 lines: `decode`,
   `history`, `markdown`, `pi-message`, `relay-codec`) by no other
   package, only by rules' own modules.
2. **Closed over rules' own imports, the shared side is 85% of rules**:
   71 modules, 16,338 lines over value imports (72 modules and 16,360
   lines with types). It takes in 17 of the 29 host and host-and-pi
   modules, through 19 value imports. `message.ts` alone imports six
   (`behind`, `canvas-pinned`, `land`, `ssh-news`, `stack`, `update`:
   the facts a message can carry); `digest`, `focus`, `relay` and
   `run-end-report` import `request.ts`; `moves` and `notes` import
   `containers.ts`. **The kill criterion holds**: a host side made of
   whole modules leaves the page's packages loading 85% of rules.
3. **What no shared module reaches is 16 modules, 2,955 lines (15%)**:
   `agent-commands`, `card-read`, `copy`, `disk`, `gate`, `ignores`,
   `move-history`, `put-images`, `resolve`, `root`, `round`, `runs`,
   `specs`, `spin-off`, `startup`, `title`.
4. **Nearly every shared module mixes.** Of the 54, 49 also export names
   only the app (or the app and `pi`) names. By export: 192 are named
   by a page package, 45 by `pi` and perhaps the app, 288 by the app
   alone, and 154 by no other package's source (134 by no other
   package's tests either). The mix is the record module ADR-0180
   chose: a stored shape's type, its spec and decoder, which every reader
   needs, beside the rules by which the host changes it, which only the
   host calls. Splitting by reader would split each of those modules in
   two, against the closure the module has now: what a record says and
   how it changes are edited together.
5. **134 of rules' index exports are imported by no other package**, by a
   syntactic count of `import { … } from "@pinetrie/rules"` across the
   repo, tests included, which agrees with the census. `index.ts` says
   it lists "every name another package imports" and only those; no
   check holds it to that. `@pinetrie/interface`'s index says the same,
   and 99 of its 689 names are imported by no other package.

## How it was measured

S285's `census.ts`, run on `rules` (its entries `index.ts`, `./ignores`
and `./fixtures`), at `ab304649cc02`. `analyze.ts` (in
`docs/findings/S286-rules-census-by-reader/`) groups each module by the
union of its exports' source users outside rules, closes the shared group
over rules' own imports, and lists the imports that cross; `analysis.txt`
is its output. A module named by both the app and a page package is
shared. The syntactic count in item 5 reads every `import { … }` and
`export { … }` from `"@pinetrie/rules"` or `"@pinetrie/interface"` in
`packages`, `apps`, `scripts` and `workspace.test.ts`, outside the
package itself.
