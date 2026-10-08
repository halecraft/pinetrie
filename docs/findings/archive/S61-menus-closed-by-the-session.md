# S61 — menus closed by the session, not by the person

- **Status:** Answered

**Answers.**
1. **An entry arriving closed every open menu** (measured). With the header's
   `@` menu open and another writer appending to the thread in a following
   column, the menu closed in 6 of 6 rounds. The only events in that time
   were `scroll` events whose target was `.column-body`: `useFollow` setting
   `scrollTop` to keep the column at its end. `Popover` closed on any scroll
   outside its box, caught on `window` in the capture phase. Swallowing those
   scroll events before `Popover`'s listener kept the menu open in 3 of 3
   rounds.
2. **Only a scroll of an element holding the trigger moves the trigger.** No
   popover's trigger sits inside a `.column-body`: they are in the header, the
   tab list, a column's head, its work strip and its composer. A column's own
   follow therefore never needs to close one.
3. **A trigger drawn only while live data lists something took its open box
   with it** (read from the code). The header drew the agent's ✦ while
   `runs.length > 0` and the offers ⇣ while `offers.length > 0`, and a person
   while their presence lasted; unmounting a `Popover` drops its state.
4. **Focus in a row that live data removes goes to `<body>`** (measured, in
   the browser suite's check of the agent's menu). With Escape handled only
   on the trigger and in the box, the menu could then not be closed from the
   keyboard.

## Why it was asked

A person reported that any menu closed itself when an agent added an entry
(principle 6 of `docs/06-interface.md`: every control is a choice the user
made).

## What changed

`Popover` closes on a scroll only when the scrolled element holds its trigger
(1, 2). A trigger from live data is `gone` rather than unmounted: it is not
drawn while closed, and an open box stays until the person closes it; the
header keeps a person who leaves while their menu is open (3). Escape is one
document listener while open, taken from the trigger, the box, or `<body>`
(4). The browser suite checks 1 and 3–4, each with a mutation in
`scripts/mutations/app.ts`.

## How it was measured

A disposable Playwright script against a scripted host: a 1000×500 viewport,
one agent tab with a reply, the `@` menu opened, then `chat` from a second
writer at the column's last entry, with a capture-phase `scroll` listener on
`window` logging each target. The swallowing rounds added
`stopImmediatePropagation` in that listener, registered before `Popover`'s.
