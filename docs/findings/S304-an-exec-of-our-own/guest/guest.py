#!/usr/bin/env python3
# S298's guest run, both ends of it:
#   guest.py prepare <dir>   writes the command (cmd.sh) and what each
#                            statement is (statements.tsv)
#   guest.py check <console> checks what the guest printed
# Each top-level statement prints lines naming its ordinal ("S<n>"); every
# byte of such a line must carry the tag of statement n.
import re, sys

# Lines of the command; each a list of (statement, what ends it). {n} is the
# statement's ordinal, {next} the next one's.
LINES = [
    [('echo S{n}', '')],
    [('echo S{n} | cat', '')],
    [('! echo S{n}', '')],
    [('false || echo S{n}', '')],
    [('( echo S{n} )', '')],
    [('{ echo S{n}; }', '')],
    [('if true; then echo S{n}; fi', '')],
    [('for i in 1 2; do echo S{n}; done', '')],
    [('while read -r x; do echo S{n}; done <<< "a"', '')],
    [('case x in x) echo S{n};; esac', '')],
    [('[[ -n x ]] && echo S{n}', '')],
    [('(( 1 )) && echo S{n}', '')],
    [('f() { echo S{next}; ( echo S{next} ) & wait; }', '')],
    [('f', '')],
    [('time echo S{n}', '')],
    [('{ echo S{n}; }', ' &')],
    [('wait', '')],
    [('x=$(echo S{n} >&2)', '')],
    [('exec 3>&1', '')],
    [('echo S{n} >&3', '')],
    [('cat <<EOF\nS{n}\nEOF', '')],
    [("eval 'echo S{n}'", '')],
    [("eval 'echo S{n}\necho S{n}'", '')],
    [('coproc { echo S{n} >&2; }', '')],
    [('wait', '')],
    [('( echo S{n} )', ' &')],
    [('wait', '')],
    [('if true\nthen\n  echo S{n}\nfi', '')],
    [('time ( echo S{n} )', '')],
    [('echo S{n}', ' & '), ('wait', '')],
    [('x=1 echo S{n}', '')],
    [('"$(echo echo)" S{n}', '')],
    [('{ echo S{n}; } | cat', ' &')],
    [('wait', '')],
    [('echo S{n} > >(cat)', '')],
    [('wait', '')],
    [('cat <(echo S{n})', '')],
    [('{ echo S{n}; } > /nonexistent/d/S{n}', '')],
    [('( echo S{n} ) > /nonexistent/d/S{n}', '')],
    [('for i in 1; do echo S{n}; done > /nonexistent/d/S{n}', '')],
    [('cd /nonexistent/S{n}', '')],
    [('/nonexistent/S{n}', '')],
    [('echo S{n} > /nonexistent/d/S{n}', '')],
    [('( sleep 1; echo S{n} late ) &', '')],
    [('echo S{n}', '')],
    [('. /tmp/src.sh S{n}', '')],
    [("/bin/bash -c 'echo S{n}; ( echo S{n} )'", '')],
    [("/bin/bash-pt -c 'echo S{n}; ( echo S{n} ); echo S{n}'", '')],
    [('echo S{n}', '; '), ('echo S{n}', '')],
    [('echo S{n} && echo S{n}', '; '), ('echo S{n}', ' & '), ('wait', '')],
    [('( ( echo S{n} ) )', '')],
    [('echo S{n} | { cat; echo S{n}; }', '')],
    [('/bin/forge 1 1 S{n}', '')],
    [('( /bin/forge 2 1 S{n} )', '')],
    [('/bin/forge 3 1 S{n} &', '')],
    [('wait', '')],
    [('echo S{n}', '; '), ('echo S{n}', '; '), ('echo S{n}', '')],
    [('/bin/echo S{n}', '')],
]

def statements():
    """(ordinal, text, line it starts on) for each top-level statement."""
    out, n, line = [], 0, 1
    for parts in LINES:
        for text, _ in parts:
            n += 1
            out.append((n, text, line))
        line += sum(t.count('\n') for t, _ in parts) + 1
    return out

def command():
    out, n = [], 0
    for parts in LINES:
        s = ''
        for text, end in parts:
            n += 1
            s += text.replace('{n}', str(n)).replace('{next}', str(n + 1)) + end
        out.append(s)
    return '\n'.join(out)

# A trap's output, run after the last statement, as its own command.
TRAP_COMMAND = "trap 'echo S1 trap' EXIT\necho S2\n/bin/echo S3"

def prepare(d):
    open(f'{d}/cmd.sh', 'w').write(command())
    open(f'{d}/cmd-trap.sh', 'w').write(TRAP_COMMAND)
    with open(f'{d}/statements.tsv', 'w') as f:
        for n, text, line in statements():
            f.write(f'{n}\t{line}\t{text!r}\n')

def section(lines, start):
    i = lines.index(start)
    j = next(k for k in range(i + 1, len(lines)) if lines[k].startswith('=== '))
    return lines[i + 1:j]

def check(console):
    """Each pipe on its own: every line's bytes must carry its statement's tag."""
    lines = open(console, errors='replace').read().replace('\r', '').split('\n')
    for name in [l[8:] for l in lines if l.startswith('=== run ')]:
        body = section(lines, f'=== run {name}')
        if not any(l.startswith('stdout ') for l in body):
            print(f'--- {name}: no output\n  ' + '\n  '.join(body[:10]))
            continue
        streams = {fd: bytes.fromhex(next(l[7:] for l in body if l.startswith(label + ' ')))
                   for fd, label in ((1, 'stdout'), (2, 'stderr'))}
        evs = [tuple(map(int, l.split()[1:])) for l in body if l.startswith('ev ')]
        signals = [e for e in evs if e[4] == 5]
        refused = [e for e in evs if e[4] == 6]
        fds = sorted({e[5] for e in evs if e[4] in (1, 2, 3, 4)})
        print(f'--- {name}: stdout {len(streams[1])} bytes, stderr {len(streams[2])} bytes; '
              f'signals taken {len(signals)}, refused {len(refused)}; output events on descriptors {fds}')
        print(f'  orphan or lost events: {[e for e in evs if e[4] in (3, 4)]}')
        total_ok, total_wrong = 0, []
        for fd, stream in streams.items():
            tags = []
            for stmt, line, w, n, route, efd in evs:
                if route in (1, 2, 3) and efd == fd:
                    tags += [stmt] * n
            pos, ok, wrong, untokened = 0, 0, [], 0
            for raw in stream.split(b'\n')[:-1]:
                got = set(tags[pos:pos + len(raw) + 1])
                pos += len(raw) + 1
                m = re.search(rb'S(\d+)', raw)
                if not m:
                    untokened += 1
                    continue
                if got == {int(m[1])}:
                    ok += 1
                else:
                    wrong.append(f'{raw[:70]!r} tagged {sorted(got)}')
            print(f'  fd {fd}: bytes tagged {len(tags)} of {len(stream)}; lines right {ok}, '
                  f'wrong {len(wrong)}, without a token {untokened}')
            for w in wrong:
                print('     ', w)
            total_ok += ok
            total_wrong += wrong
        print(f'  all: lines right {total_ok}, wrong {len(total_wrong)}')

if __name__ == '__main__':
    {'prepare': prepare, 'check': check}[sys.argv[1]](sys.argv[2])
