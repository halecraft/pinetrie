import { describe, expect, test } from "vitest"
import { readShell } from "./read.ts"
import type { ShellRole } from "./spans.ts"

const CORPUS = [
  'rm -rf /tmp/wc2 && mkdir /tmp/wc2 && jj git init --colocate >/dev/null 2>&1 && jj commit -m one 2>&1 | tail -1; echo "status=$?"',
  'for f in *.ts; do echo "$f" | wc -c; done # count',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell source, not a template
  "x=$(git rev-parse HEAD) && echo ${x:0:8} $((1 + 2)) 'single' $'ansi'",
  "if [ -f a ]; then cat a; else echo none; fi",
  "cat <<'EOT' > out.txt\nhello $HOME\nEOT\nwc -l out.txt",
  'echo `date` && echo unterminated "quote',
  "",
]

const text = (spans: readonly { readonly text: string }[]) =>
  spans.map(s => s.text).join("")

describe("readShell", () => {
  test.each(CORPUS)("its runs join to the source: %j", source => {
    const read = readShell(source, 56)
    expect(text(read.source.spans)).toBe(source)
  })

  test("a layout's runs join to the layout, with its own roles", () => {
    const source =
      "mkdir -p /tmp/wc && cd /tmp/wc && git init -q && git commit -m init && ls -la"
    const { laidOut } = readShell(source, 56)
    expect(text(laidOut?.spans ?? [])).toContain("&&\n  cd /tmp/wc &&\n")
    expect(
      laidOut?.spans.filter(s => s.role === "command").map(s => s.text),
    ).toEqual(["mkdir", "cd", "git", "git", "ls"])
  })

  test.each<readonly [string, ShellRole, string]>([
    ['jj commit -m "status=$?" 2>&1', "command", "jj"],
    ['jj commit -m "status=$?" 2>&1', "option", "-m"],
    ['jj commit -m "status=$?" 2>&1', "string", '"status='],
    ['jj commit -m "status=$?" 2>&1', "variable", "$?"],
    ['jj commit -m "status=$?" 2>&1', "redirect", "2>&1"],
    ["a && b", "operator", "&&"],
    ["for f in a; do echo $f; done", "keyword", "do"],
    ["for f in a; do echo $f; done", "keyword", "done"],
    ["ls # x", "comment", "# x"],
    ["x=1 ls", "variable", "x"],
    ["echo $(git rev-parse HEAD)", "command", "git"],
    ["cat <<'EOT'\nhello\nEOT", "string", "hello\n"],
  ])("in %j, %s marks %j", (source, role, marked) => {
    const spans = readShell(source, 56).source.spans
    expect(spans.filter(s => s.role === role).map(s => s.text)).toContain(
      marked,
    )
  })

  test("a word that only looks like a keyword is not one", () => {
    const spans = readShell("echo done-ish fi", 56).source.spans
    expect(spans.filter(s => s.role === "keyword")).toEqual([])
  })

  test("a source that does not parse is one plain run, with no starts or statements", () => {
    expect(readShell('echo "open', 56)).toEqual({
      source: {
        spans: [{ text: 'echo "open', role: "plain" }],
        starts: [],
        statements: [],
      },
      laidOut: undefined,
    })
  })
})
