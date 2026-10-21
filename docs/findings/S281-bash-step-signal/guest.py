#!/usr/bin/env python3
# S281's guest run, both ends of it:
#   guest.py prepare <dir>   writes the command and each trap's BASH_ENV file
#   guest.py check <console> reads what the guest printed and checks each line
# A line names its statement ("S<id>"); its bytes must carry a tag whose
# signal's $LINENO falls in that statement's lines.
import re, sys

STATEMENTS = [
    (1, 'echo S1'),
    (2, 'echo S2 | cat'),
    (3, '! echo S3'),
    (4, 'false || echo S4'),
    (5, '( echo S5 )'),
    (6, '{ echo S6; }'),
    (7, 'if true; then echo S7; fi'),
    (8, 'for i in 1 2; do echo S8; done'),
    (9, 'while read -r x; do echo S9; done <<< "a"'),
    (10, 'case x in x) echo S10;; esac'),
    (11, '[[ -n x ]] && echo S11'),
    (12, '(( 1 )) && echo S12'),
    (13, 'f() { echo S14; ( echo S14 ) & wait; }'),
    (14, 'f'),
    (15, 'time echo S15'),
    (16, '{ echo S16; } &'),
    (17, 'wait'),
    (18, 'x=$(echo S18 >&2)'),
    (19, 'exec 3>&1'),
    (20, 'echo S20 >&3'),
    (21, 'cat <<EOF\nS21\nEOF'),
    (22, "eval 'echo S22'"),
    (23, 'coproc { echo S23 >&2; }'),
    (24, 'wait'),
    (25, '( echo S25 ) &'),
    (26, 'wait'),
    (27, 'if true\nthen\n  echo S27\nfi'),
    (28, 'time ( echo S28 )'),
    (29, 'echo S29 & wait'),
    (30, 'x=1 echo S30'),
    (31, '"$(echo echo)" S31'),
    (32, '{ echo S32; } | cat &'),
    (33, 'wait'),
    (34, 'echo S34 > >(cat)'),
    (35, 'wait'),
    (36, 'cat <(echo S36)'),
    (37, '{ echo S37; } > /nonexistent/d/S37'),
    (38, '( echo S38 ) > /nonexistent/d/S38'),
    (39, 'cd /nonexistent/S39'),
    (40, '/nonexistent/S40'),
    (41, 'echo S41 > /nonexistent/d/S41'),
    (42, '( sleep 1; echo S42 late ) &'),
    (43, 'echo S43'),
    (44, '. /tmp/src.sh'),
    (45, "bash -c 'echo S45; ( echo S45 )'"),
    (46, 'echo S46; echo S46'),
    (47, '( ( echo S47 ) )'),
    (48, 'echo S48 | { cat; echo S48; }'),
    (49, 'wait'),
]

TRAP = ('printf "%s\\t%s\\t%q\\t%.0s\\n" "$BASHPID" "$LINENO" "$BASH_COMMAND" "$_" '
        '>>/tmp/marks')
GUARD = '[[ -n ${FUNCNAME-} || -n ${BASH_SOURCE-} ]] || '
PRELUDES = {
    'plain': f"unset BASH_ENV\ntrap '{{ {TRAP}; }} 2>/dev/null' DEBUG\n",
    'functrace': f"unset BASH_ENV\nset -T\ntrap '{{ {GUARD}{TRAP}; }} 2>/dev/null' DEBUG\n",
}

def spans():
    out, line = [], 1
    for sid, text in STATEMENTS:
        k = text.count('\n')
        out.append((sid, line, line + k))
        line += k + 1
    return out

def prepare(d):
    open(f'{d}/cmd.sh', 'w').write('\n'.join(t for _, t in STATEMENTS))
    for name, text in PRELUDES.items():
        open(f'{d}/prelude-{name}.sh', 'w').write(text)

def section(lines, start):
    i = lines.index(start)
    j = next(k for k in range(i + 1, len(lines)) if lines[k].startswith('=== '))
    return lines[i + 1:j]

def check(console):
    lines = open(console, errors='replace').read().replace('\r', '').split('\n')
    names = [l[8:] for l in lines if l.startswith('=== run ')]
    sp = spans()
    for name in names:
        body = section(lines, f'=== run {name}')
        stream = bytes.fromhex(next(l[7:] for l in body if l.startswith('stream ')))
        marks = bytes.fromhex(next(l[6:] for l in body if l.startswith('marks '))).decode()
        evs = [tuple(map(int, l.split()[1:])) for l in body if l.startswith('ev ')]
        # Each task's signals, in its own order.
        by_pid = {}
        for m in marks.splitlines():
            pid, lineno, _ = m.split('\t', 2)
            by_pid.setdefault(int(pid), []).append(int(lineno))
        tags = []
        for tid, k, writer, n, route in evs:
            if route == 4:
                continue
            tags += [(tid, k)] * n
        def statement(tag):
            tid, k = tag
            if tid == 0:
                return None
            lineno = by_pid[tid][k - 1]
            return next(s for s, lo, hi in sp if lo <= lineno <= hi)
        print(f'--- {name}: {len(stream)} bytes, {len(tags)} tagged, '
              f'{sum(len(v) for v in by_pid.values())} signals from {len(by_pid)} tasks')
        pos, wrong, ok, untokened = 0, [], 0, []
        for raw in stream.split(b'\n')[:-1]:
            line_tags = set(tags[pos:pos + len(raw) + 1])
            pos += len(raw) + 1
            text = raw.decode(errors='replace')
            if text.startswith('#'):
                continue
            got = {statement(t) for t in line_tags}
            m = re.search(r'S(\d+)', text)
            if not m:
                untokened.append(f'{text!r} -> {sorted(got, key=str)}')
                continue
            want = int(m[1])
            if got == {want}:
                ok += 1
            else:
                wrong.append(f'S{want}: {text!r} tagged as statement {sorted(got, key=str)}')
        print(f'  right {ok}, wrong {len(wrong)}')
        for w in wrong:
            print('   ', w)
        for u in untokened:
            print('   no token:', u)
        statements_seen = {int(m) for m in re.findall(rb'S(\d+)', stream)}
        missing = [s for s, _ in STATEMENTS if s not in statements_seen
                   and s not in (13, 17, 19, 24, 26, 33, 35, 49)]
        print(f'  statements that printed nothing: {missing}')

if __name__ == '__main__':
    {'prepare': prepare, 'check': check}[sys.argv[1]](sys.argv[2])
