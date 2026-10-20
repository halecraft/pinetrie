#!/usr/bin/env python3
# S281, questions 1 and 2: does every kind of top-level statement signal
# before its first process or output, and can the signal be mapped to it?
#
# Each statement's first act prints "S<id> <n>", where n is how many signals
# had been written when it ran (counted in a child, which the trap does not
# follow). The n-th signal must name the statement: its $LINENO falls in the
# statement's lines. A child started by `&` or `( )` counts too, so a signal
# that came after the fork shows as the previous statement's.
import os, re, subprocess, sys, tempfile

PRELUDE = r'''unset BASH_ENV
exec 9>>"$S281_MARKS"
unset S281_MARKS
trap 'printf "%s\t%q\n" "$LINENO" "$BASH_COMMAND" >&9' DEBUG
'''

def n(i):  # what a statement prints first: its id and the signals so far
    return f'"S{i} $(wc -l < "$M")"'

# One top-level statement each, in order. Some span lines.
STATEMENTS = [
    f'echo {n(1)}',
    f'echo {n(2)} | cat',
    f'! echo {n(3)}',
    f'false || echo {n(4)}',
    f'( echo {n(5)} )',
    f'{{ echo {n(6)}; }}',
    f'if true; then echo {n(7)}; fi',
    f'for i in 1 2; do echo {n(8)}; done',
    f'while read -r x; do echo {n(9)}; done <<< "a"',
    f'case x in x) echo {n(10)};; esac',
    f'[[ -n x ]] && echo {n(11)}',
    f'(( 1 )) && echo {n(12)}',
    f'f() {{ echo {n(14)}; }}',  # 13 defines; 14 calls
    'f',
    f'time echo {n(15)}',
    f'{{ echo {n(16)}; }} &',
    'wait',
    f'x=$(echo {n(18)} >&2)',
    'exec 3>&1',
    f'echo {n(20)} >&3',
    f'cat <<EOF\nS21 $(wc -l < "$M")\nEOF',
    f"eval 'echo {n(22)}'",
    f'coproc {{ echo {n(23)} >&2; }}',
    'wait',
    f'( echo {n(25)} ) &',
    'wait',
    f'if true\nthen\n  echo {n(27)}\nfi',
    f'time ( echo {n(28)} )',
    f'echo {n(29)} & wait',
    f'x=1 echo {n(30)}',
    f'"$(echo echo)" {n(31)}',
    f'{{ echo {n(32)}; }} | cat &',
    'wait',
    f'echo {n(34)} > >(cat)',
    'wait',
    f'cat <(echo {n(36)})',
]
# The ids above, with the statement each belongs to (13 is f's definition).
IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
       21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]

def run(command, marks):
    open(marks, 'w').close()
    with tempfile.NamedTemporaryFile('w', delete=False) as pre:
        pre.write(PRELUDE)
    env = dict(os.environ, BASH_ENV=pre.name, S281_MARKS=marks, M=marks)
    r = subprocess.run(['bash', '-c', command], env=env, stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    os.unlink(pre.name)
    return r.stdout, [l.split('\t', 1) for l in open(marks).read().splitlines()]

def lines_of(statements, sep):
    """Each statement's first and last line, as bash numbers -c's lines."""
    spans, line = [], 1
    for s in statements:
        k = s.count('\n')
        spans.append((line, line + k))
        line += k + (1 if sep == '\n' else 0)
    return spans

def joined(statements, sep):
    # A statement ending in `&` is already terminated: `&;` would not parse.
    out = ''
    for i, s in enumerate(statements):
        out += s
        if i < len(statements) - 1:
            out += ' ' if (sep != '\n' and s.endswith('&')) else sep
    return out

def check(sep):
    keep = [i for i, s in enumerate(STATEMENTS) if sep == '\n' or '\n' not in s]
    statements = [STATEMENTS[i] for i in keep]
    ids = [IDS[i] for i in keep]
    command = joined(statements, sep)
    marks = tempfile.mktemp()
    out, ms = run(command, marks)
    spans = lines_of(statements, sep)
    print(f'--- statements joined by {sep!r}: {len(ms)} signals')
    bad = 0
    for m in re.finditer(r'S(\d+) (\d+)', out):
        sid, count = int(m[1]), int(m[2])
        stmt = ids.index(sid)
        line = int(ms[count - 1][0]) if count >= 1 else None
        lo, hi = spans[stmt]
        ok = line is not None and lo <= line <= hi
        # Sharing a line, a line names several statements: say which signal it was.
        cmd = ms[count - 1][1] if count >= 1 else '-'
        if not ok or sep != '\n':
            print(f'  S{sid}: signal #{count} line {line} {cmd[:60]}' + ('' if ok else '   <-- WRONG'))
        bad += not ok
    found = {int(x) for x in re.findall(r'S(\d+) ', out)}
    missing = [i for i in ids if i not in found and i not in (13, 17, 19, 24, 26, 33, 35)]
    print(f'  wrong: {bad}; statements that printed nothing: {missing}')
    return ms

if __name__ == '__main__':
    check('\n')
    ms = check('; ')
    if '-v' in sys.argv:
        for l, c in ms: print(' ', l, c)
