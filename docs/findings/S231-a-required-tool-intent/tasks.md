# S231's tasks

Each `## ` heading is one task, run in a scratch copy of pine·trie. They
mix finding out, running and editing, since an intent is worth most where a
command is hardest to read.

## Explain the digest timing
How does the host decide when to ask a model for an ask's digest while a run is going? Answer in one paragraph.

## Run one test file
Run the unit tests in packages/interface/ask-fold.test.ts and tell me whether any fail.

## Find the readers
Find every place in the code that reads the run-end report record, and list them by file.

## A small rename
Rename the local helper `words` in packages/rules/digest.ts to `wordCount`, then check the package still type-checks.

## A comment from history
Add a one-line comment above `LONG_ASK` in packages/core/asks.ts saying why it is three. Look in the docs and the history; if you can't find why, change nothing and say so.

## Recent history
Summarize what the last five commits changed, in plain words.
