import { parse } from "unbash"
import { describe, expect, test } from "vitest"
import { sameProgram, shellLayout } from "./layout.ts"

const WIDTH = 56
const laidOut = (source: string) =>
  shellLayout(source, parse(source), WIDTH)?.text

/** Agents' one-line commands, and the shapes a chain breaks around. */
const CASES: readonly (readonly [string, string])[] = [
  [
    "mkdir -p /tmp/wc && cd /tmp/wc && (git init -q 2>/dev/null; git -c user.email=a@b -c user.name=a commit -q --allow-empty -m init) && ls -la /tmp/wc && git log --oneline | head -3",
    `mkdir -p /tmp/wc &&
  cd /tmp/wc &&
  (
    git init -q 2>/dev/null
    git -c user.email=a@b -c user.name=a commit -q --allow-empty -m init
  ) &&
  ls -la /tmp/wc &&
  git log --oneline | head -3`,
  ],
  [
    'rm -rf /tmp/wc2 && mkdir /tmp/wc2 && chmod 755 /tmp/wc2 && cd /tmp/wc2 && jj git init --colocate >/dev/null 2>&1 && echo hi > a.txt && jj commit -m one 2>&1 | tail -1; echo "status=$?"',
    `rm -rf /tmp/wc2 &&
  mkdir /tmp/wc2 &&
  chmod 755 /tmp/wc2 &&
  cd /tmp/wc2 &&
  jj git init --colocate >/dev/null 2>&1 &&
  echo hi > a.txt &&
  jj commit -m one 2>&1 | tail -1
echo "status=$?"`,
  ],
  [
    'for env in "" "-e A=1 -e B=2"; do echo "== $env"; docker run --rm $env img git status >/dev/null 2>&1; echo "exit $?"; done',
    `for env in "" "-e A=1 -e B=2"; do
  echo "== $env"
  docker run --rm $env img git status >/dev/null 2>&1
  echo "exit $?"
done`,
  ],
  [
    "[[ -f /a/really/long/path/name/here && -d /another/long/path/name ]] && echo yes || echo no",
    `[[ -f /a/really/long/path/name/here && -d /another/long/path/name ]] &&
  echo yes ||
  echo no`,
  ],
  [
    `echo "a && b, a long string that keeps going and going on" && git commit -m 'x || y' # trailing && comment`,
    `echo "a && b, a long string that keeps going and going on" &&
  git commit -m 'x || y' # trailing && comment`,
  ],
  [
    'x=$(cd /some/long/path && git rev-parse HEAD 2>/dev/null) && echo "$x" && echo done with it all',
    `x=$(cd /some/long/path && git rev-parse HEAD 2>/dev/null) &&
  echo "$x" &&
  echo done with it all`,
  ],
  [
    'if [ -z "$X" ]; then echo unset and that is a long message; elif [ "$X" = 1 ]; then echo one; else echo set; fi',
    `if [ -z "$X" ]; then
  echo unset and that is a long message
elif [ "$X" = 1 ]; then
  echo one
else
  echo set
fi`,
  ],
  [
    "! grep -q TODO packages/shell/layout.ts packages/shell/spans.ts | cat && time pnpm --filter @pinetrie/app run e2e | tee /tmp/e2e.log",
    `! grep -q TODO packages/shell/layout.ts packages/shell/spans.ts |
  cat &&
  time pnpm --filter @pinetrie/app run e2e |
    tee /tmp/e2e.log`,
  ],
  [
    'while read -r line; do echo "$line" | cut -d: -f1; done < /etc/passwd | sort | uniq -c | sort -rn | head',
    `while read -r line; do echo "$line" | cut -d: -f1; done < /etc/passwd |
  sort |
  uniq -c |
  sort -rn |
  head`,
  ],
]

describe("shellLayout", () => {
  test.each(CASES)("%s", (source, expected) => {
    expect(laidOut(source)).toBe(expected)
  })

  test.each([
    ["a command that fits", "cd /workspace && rg -n foo packages | head -20"],
    [
      "a command with lines of its own",
      "cat > /tmp/x.ts <<'EOT'\nconst a = 1 && 2 && 3 && 4 && 5 && 6 && 7 && 8\nEOT\nnode /tmp/x.ts",
    ],
    [
      "a command that does not parse",
      'echo unterminated "quote && more and more words to pass the width',
    ],
  ])("none for %s", (_, source) => {
    expect(laidOut(source)).toBeUndefined()
  })

  test("a layout is the same program, with only its whitespace and separators changed", () => {
    for (const [source] of CASES) {
      const out = laidOut(source) ?? ""
      expect(sameProgram(source, parse(source), out, parse(out))).toBe(true)
      expect(out.replace(/[\s;]/g, "")).toBe(source.replace(/[\s;]/g, ""))
    }
  })
})

describe("sameProgram", () => {
  const same = (source: string, text: string) =>
    sameProgram(source, parse(source), text, parse(text))

  test("a line break where the shell takes one is the same program", () => {
    expect(same("a && b; c", "a &&\n  b\nc")).toBe(true)
  })
  test("a line break that splits a command is not", () => {
    expect(same("echo a b", "echo a\nb")).toBe(false)
  })
  test("a comment dropped is not, though the printer drops comments too", () => {
    expect(same("a && b # why", "a &&\n  b")).toBe(false)
  })
})
