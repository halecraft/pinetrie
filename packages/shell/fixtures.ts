// shell/fixtures — one command of every kind of top-level statement
// pine·trie's bash signals, each printing lines that name its ordinal
// (`S<n>`), so every byte of such a line belongs to statement n. The
// observer suite's guest runs it, and `statementSpans`' test checks unbash
// counts the same statements. A nested pine·trie bash (`/bin/bash-pt`) and
// `work forge` signal too, and the guest must refuse them. Lines of the
// command, each a list of statements with what ends each; `{n}` is the
// statement's ordinal, `{next}` the next.

const LINES: readonly (readonly (readonly [string, string])[])[] = [
  [["echo S{n}", ""]],
  [["echo S{n} | cat", ""]],
  [["! echo S{n}", ""]],
  [["false || echo S{n}", ""]],
  [["( echo S{n} )", ""]],
  [["{ echo S{n}; }", ""]],
  [["if true; then echo S{n}; fi", ""]],
  [["for i in 1 2; do echo S{n}; done", ""]],
  [['while read -r x; do echo S{n}; done <<< "a"', ""]],
  [["case x in x) echo S{n};; esac", ""]],
  [["[[ -n x ]] && echo S{n}", ""]],
  [["(( 1 )) && echo S{n}", ""]],
  [["f() { echo S{next}; ( echo S{next} ) & wait; }", ""]],
  [["f", ""]],
  [["time echo S{n}", ""]],
  [["{ echo S{n}; }", " &"]],
  [["wait", ""]],
  [["x=$(echo S{n} >&2)", ""]],
  [["exec 3>&1", ""]],
  [["echo S{n} >&3", ""]],
  [["cat <<EOF\nS{n}\nEOF", ""]],
  [["eval 'echo S{n}'", ""]],
  [["eval 'echo S{n}\necho S{n}'", ""]],
  [["coproc { echo S{n} >&2; }", ""]],
  [["wait", ""]],
  [["( echo S{n} )", " &"]],
  [["wait", ""]],
  [["if true\nthen\n  echo S{n}\nfi", ""]],
  [["time ( echo S{n} )", ""]],
  [
    ["echo S{n}", " & "],
    ["wait", ""],
  ],
  [["x=1 echo S{n}", ""]],
  [['"$(echo echo)" S{n}', ""]],
  [["{ echo S{n}; } | cat", " &"]],
  [["wait", ""]],
  [["echo S{n} > >(cat)", ""]],
  [["wait", ""]],
  [["cat <(echo S{n})", ""]],
  [["{ echo S{n}; } > /nonexistent/d/S{n}", ""]],
  [["( echo S{n} ) > /nonexistent/d/S{n}", ""]],
  [["for i in 1; do echo S{n}; done > /nonexistent/d/S{n}", ""]],
  [["cd /nonexistent/S{n}", ""]],
  [["/nonexistent/S{n}", ""]],
  [["echo S{n} > /nonexistent/d/S{n}", ""]],
  [["( sleep 1; echo S{n} late ) &", ""]],
  [["echo S{n}", ""]],
  [[". /tmp/src.sh S{n}", ""]],
  [["/bin/bash-pt -c 'echo S{n}; ( echo S{n} )'", ""]],
  [["/bin/bash-pt -c 'echo S{n}; ( echo S{n} ); echo S{n}'", ""]],
  [
    ["echo S{n}", "; "],
    ["echo S{n}", ""],
  ],
  [
    ["echo S{n} && echo S{n}", "; "],
    ["echo S{n}", " & "],
    ["wait", ""],
  ],
  [["( ( echo S{n} ) )", ""]],
  [["echo S{n} | { cat; echo S{n}; }", ""]],
  [["/bin/work forge 1 1 S{n}", ""]],
  [["( /bin/work forge 2 1 S{n} )", ""]],
  [["/bin/work forge 3 1 S{n} &", ""]],
  [["wait", ""]],
  [
    ["echo S{n}", "; "],
    ["echo S{n}", "; "],
    ["echo S{n}", ""],
  ],
  [["/bin/echo S{n}", ""]],
]

/**
 * Signals the command's nested shells and forgeries make, each refused: one
 * per `work forge`, and one per statement of each nested `bash-pt -c`.
 */
export const FORGED_SIGNALS = LINES.flat().reduce((sum, [text]) => {
  const nested = /bash-pt -c '([^']*)'/.exec(text)?.[1]
  return (
    sum +
    (text.includes("work forge") ? 1 : 0) +
    (nested === undefined ? 0 : nested.split(";").length)
  )
}, 0)

/** The command, as the guest's bash is given it. */
export function statementsCommand(): string {
  let n = 0
  return LINES.map(parts =>
    parts
      .map(([text, end]) => {
        n++
        return (
          text
            .replaceAll("{n}", String(n))
            .replaceAll("{next}", String(n + 1)) + end
        )
      })
      .join(""),
  ).join("\n")
}

/** Each top-level statement's ordinal and the lines it spans, from 1. */
export function commandStatements(): readonly {
  readonly statement: number
  readonly first: number
  readonly last: number
}[] {
  const out: { statement: number; first: number; last: number }[] = []
  let line = 1
  for (const parts of LINES) {
    for (const [text] of parts) {
      const first = line
      line += text.split("\n").length - 1
      out.push({ statement: out.length + 1, first, last: line })
    }
    line++
  }
  return out
}
