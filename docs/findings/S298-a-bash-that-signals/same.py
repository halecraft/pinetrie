#!/usr/bin/env python3
# S298, Q4: does pine·trie's bash (static, musl, patched) behave like the
# image's (here Debian 13's, glibc)? Each case runs as `bash -c` under each
# locale, in a directory of files whose names test glob order; any
# difference in output or exit status is printed.
#   same.py <image bash> <our bash>
import os, subprocess, sys, tempfile

IMAGE, OURS = sys.argv[1], sys.argv[2]
LOCALES = [None, 'C.UTF-8', 'en_US.UTF-8']
NAMES = ['a', 'B', 'b', 'Á', 'á', 'é', 'e', 'Z', '_x', '.hidden', '10', '9', 'ß', 'ä', 'z']

CASES = [
    'echo *',
    'echo [a-z]*',
    'printf "%s\\n" * | head -20 | tr "\\n" " "',
    'ls | tr "\\n" " "',
    'for f in [[:alpha:]]*; do printf "%s " "$f"; done',
    'for f in [[:upper:]]*; do printf "%s " "$f"; done',
    '[[ é == [[:alpha:]] ]] && echo alpha || echo not',
    '[[ É == [[:upper:]] ]] && echo upper || echo not',
    'x=éa; echo ${#x}',
    'x=élan; echo ${x^^} ${x^}',
    'x=ÉLAN; echo ${x,,}',
    'printf "%\'d\\n" 1234567',
    'printf "%5.2f\\n" 3.14159',
    'printf "%q\\n" "a b é"',
    'echo $"hello"',
    'x=abc; echo ${x//b/&}',
    'echo ~root',
    'echo ~nosuchuser',
    'cd /nonexistent',
    'nosuchcmd',
    'echo a\nfi',
    'set -o | md5sum',
    'shopt | md5sum',
    'echo $BASH_VERSION ${BASH_VERSINFO[*]}',
    'echo $MACHTYPE $HOSTTYPE $OSTYPE',
    'enable -f /nonexistent.so x',
    'enable | wc -l',
    'ulimit -n',
    'echo $((2**63)) $((7/2)) $((-7%3))',
    'printf "%s\\n" {a..e} {1..3}',
    'read -r x <<< "  sp  "; echo "[$x]"',
    'IFS=, read -ra a <<< "1,2,,3"; echo ${#a[@]}',
    'case é in [[:alpha:]]) echo yes;; *) echo no;; esac',
    'echo é | tr a-z A-Z',
    'compgen -c ls | head -3 | sort | tr "\\n" " "',
    'type -a echo printf | tr "\\n" " "',
    'echo $RANDOM >/dev/null; RANDOM=1; echo $RANDOM $RANDOM',
    'echo $SRANDOM >/dev/null && echo has-srandom',
    'sleep 0.01 && echo slept',
    'time -p true 2>&1 | head -1 | cut -c1-4',
    'echo $(( $(date +%s) > 0 ))',
    'command -v bash',
    'kill -l | head -2',
    'trap -l | head -1',
    'getconf ARG_MAX >/dev/null && echo ok',
    'printf "%b" "\\u00e9\\n"',
    'echo $\'\\u00e9\'',
    'x=$(printf "\\xff"); echo ${#x}',
]

def run(bash, case, loc, d):
    env = {'PATH': os.environ['PATH'], 'HOME': '/root'}
    if loc:
        env['LANG'] = loc
    r = subprocess.run([bash, '-c', case], cwd=d, env=env, stdin=subprocess.DEVNULL,
                       capture_output=True)
    # Messages name the shell's path as $0: compare them as one.
    return (r.stdout.replace(bash.encode(), b'BASH'), r.stderr.replace(bash.encode(), b'BASH'),
            r.returncode)

with tempfile.TemporaryDirectory() as d:
    for n in NAMES:
        open(os.path.join(d, n), 'w').close()
    for loc in LOCALES:
        same = 0
        print(f'=== LANG={loc}')
        for c in CASES:
            a, b = run(IMAGE, c, loc, d), run(OURS, c, loc, d)
            if a == b:
                same += 1
                continue
            print(f'--- {c!r}')
            for label, x, y in zip(('stdout', 'stderr', 'exit'), a, b):
                if x != y:
                    print(f'  {label}: image {x!r}\n  {" " * len(label)}  ours  {y!r}')
        print(f'  {same} of {len(CASES)} the same')
