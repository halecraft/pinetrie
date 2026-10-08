# S138 — A bash call can be laid out and highlighted from unbash's AST, in 24 KB

- **Status:** Answered
- **Led to:** ADR-0114

Serves a discussion of how a tool row reads (`ToolRow`,
`packages/web/message.tsx`).

**Question.** Can the browser lay out an agent's one-line shell command so a
reader can follow it, and highlight it, at a cost a column can carry? Does a
message carry more than one call often enough that a call's tool name cannot
move out of its row?

**Kill criterion.** No formatter that breaks a long `&&` chain without risk
of showing a command other than the one that ran.

**Throw away.** The probes in `/tmp/probe` (sh-syntax, @wasm-fmt/shfmt,
unbash, @aliou/sh, web-tree-sitter, shiki, highlight.js, esbuild).

## Answers

1. **Several calls in one message are real.** pi runs one assistant
   message's calls in parallel by default (`toolExecution ?? "parallel"`,
   `pi-agent-core` `dist/agent.js`), and `ToolRow` draws one row a call.
   No session logs reach a lane, so how often is not measured. The agent in
   this spike's own thread batched 2 calls in 4 of about 30 messages, every
   time for independent reads.
2. **shfmt (`sh-syntax` 0.7.0, mvdan/sh as wasm) does half the layout.** It
   puts each `;`-separated statement on its own line and expands loops,
   `if`, subshells and heredocs. It never breaks an `&&`/`||` chain, which
   is the usual LLM one-liner. It adds a space after a redirect (`2> /dev/null`)
   unless `spaceRedirects: false`. The AST it returns is lossy (a `Cmd` is
   only positions, no node types), so it cannot find the `&&`s.
3. **A break after each top-level `&&`/`||` is safe when checked.** A scanner
   that skips quotes, `$(…)`, `(…)`, `[[…]]` and comments finds them; shfmt
   then indents the continuations. The check: `print(x, { minify: true })`
   of the original and of the rewrite must be equal, since minify drops
   line breaks and comments; a rewrite that changed the program (a heredoc
   body, a comment) fails it and the shfmt-only layout is shown. An
   unparseable command throws, and is shown raw. The screenshot's commands
   became:

   ```sh
   rm -rf /tmp/wc2 &&
     mkdir /tmp/wc2 &&
     chmod 755 /tmp/wc2 &&
     cd /tmp/wc2 &&
     jj git init --colocate >/dev/null 2>&1 &&
     echo hi >a.txt &&
     jj commit -m one 2>&1 | tail -1
   echo "status=$?"
   ```

   Long argument lists (a `docker run` of 120 characters) stay one line,
   left to `pre-wrap`. About 1.4 ms a call warm in Node.
4. **Costs, gzipped:** sh-syntax's wasm 264 KB (its browser entry fetches
   it); web-tree-sitter with tree-sitter-bash 259 KB (a full tree, but
   formatting on it is a printer to write); shiki core with the JavaScript
   regex engine, the `shellscript` grammar and one theme 62 KB. All three
   could load lazily, on the first bash row a column opens.
5. **shiki highlights what a reader needs; highlight.js does not.** shiki
   marks every command name (`entity.name.command`, `jj` included), options,
   redirects, pipes and `$?`. highlight.js marks only built-ins it knows by
   name (`rm`, `cd`, `tail`), so `jj` and `git` read as arguments.
6. **unbash replaces both, at 24 KB.** `unbash` 5.0.0 (pure TypeScript, no
   dependencies, ISC) parses to a typed AST with source offsets on every
   node, down to quoted parts and `$` expansions; its printer gives
   shfmt's output on the commands above, but drops comments and line
   breaks. A layout of our own on its AST, about 40 lines, lays out only
   the structure (statements, `&&`/`||` chains, pipelines, subshells,
   loops, `if`) of a node wider than the column and copies every leaf
   from the source, so no word is rewritten. Its check is free:
   `print(parse(src)) === print(parse(laidOut))`, as the printer ignores
   line breaks. It lays out only one-line commands: a multi-line one was
   laid out by the agent, and a heredoc needs its lines. It breaks
   the chain after the subshell in the first screenshot command, which the
   shfmt pass missed, and takes 0.05 ms a call. The same AST marks command
   names, quoted parts, expansions and redirects, so it can drive the
   highlighting and shiki is not needed. Parser and printer bundle to 24 KB
   gzipped (esbuild, minified). `@aliou/sh` is 10 KB but parser-only and
   marked WIP (0.3.4). `@wasm-fmt/shfmt`, a smaller shfmt build, is still
   173 KB.
