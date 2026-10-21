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
    lines = open(console, errors='replace').read().replace('\r', '').split('\n')
    stmts = {n: line for n, _, line in statements()}
    for name in [l[8:] for l in lines if l.startswith('=== run ')]:
        body = section(lines, f'=== run {name}')
        if not any(l.startswith('stream ') for l in body):
            print(f'--- {name}: no output\n  ' + '\n  '.join(body[:10]))
            continue
        stream = bytes.fromhex(next(l[7:] for l in body if l.startswith('stream ')))
        evs = [tuple(map(int, l.split()[1:])) for l in body if l.startswith('ev ')]
        exit_ = next(l for l in body if l.startswith('exit '))
        print(f'--- {name}: {len(stream)} bytes, {exit_}')
        if name.startswith('uprobe'):
            nodes = [e for e in evs if e[4] == 7]
            types = {}
            for t, line, w, flags, _ in nodes:
                types[t] = types.get(t, 0) + 1
            print(f'  {len(nodes)} nodes read; by type {dict(sorted(types.items()))}')
            print(f'  first 12 (type, line): {[(t, l) for t, l, *_ in nodes[:12]]}')
            continue
        signals = [(e[0], e[1], e[2]) for e in evs if e[4] == 5]
        refused = [(e[0], e[1], e[2]) for e in evs if e[4] == 6]
        print(f'  signals taken {len(signals)}, refused {len(refused)}: {refused}')
        writers = {w for _, _, w in signals}
        print(f'  signalling tasks {len(writers)}')
        bad_lines = [(o, l, stmts.get(o)) for o, l, _ in signals if stmts.get(o) != l]
        print(f'  signals whose line is not their statement\'s: {bad_lines}')
        order = [o for o, _, _ in signals]
        print(f'  ordinals in order: {order == sorted(order) and order == list(range(1, len(order) + 1))}, last {order[-1] if order else None}')
        tags, by = [], []
        for stmt, line, w, n, route in evs:
            if route in (1, 2, 3):
                tags += [stmt] * n
                by += [w] * n
        shell = signals[0][2] if signals else None
        last = stream.rstrip(b'\n').rsplit(b'\n', 1)[-1]
        at = len(stream.rstrip(b'\n')) - len(last)
        print(f'  last line {last!r} written by {sorted(set(by[at:at + len(last)]))}, the shell is {shell}')
        pos, ok, wrong, untokened = 0, 0, [], []
        for raw in stream.split(b'\n')[:-1]:
            got = set(tags[pos:pos + len(raw) + 1])
            pos += len(raw) + 1
            text = raw.decode(errors='replace')
            if text.startswith('#'):
                continue
            m = re.search(r'S(\d+)', text)
            if not m:
                untokened.append(f'{text!r} -> {sorted(got)}')
                continue
            if got == {int(m[1])}:
                ok += 1
            else:
                wrong.append(f'{text!r} tagged {sorted(got)}')
        print(f'  lines right {ok}, wrong {len(wrong)}; bytes tagged {len(tags)} of {len(stream)}')
        for w in wrong:
            print('   ', w)
        for u in untokened:
            print('    no token:', u)
        seen = {int(x) for x in re.findall(rb'S(\d+)', stream)}
        quiet = [n for n, text, _ in statements() if n not in seen] if name.endswith('main') else []
        print(f'  statements that printed nothing: {quiet}')

if __name__ == '__main__':
    {'prepare': prepare, 'check': check}[sys.argv[1]](sys.argv[2])
