#!/usr/bin/env python3
# S281, questions 3 and 4: what a command sees or prints differently when the
# trap is installed. Each case runs as `bash -c`, stdin /dev/null, with no
# prelude and with each prelude; any difference in output or exit status is
# printed.
import os, subprocess, tempfile

GUARD = '[[ -n ${FUNCNAME-} || -n ${BASH_SOURCE-} ]] || '
SIGNAL = 'printf "%s\\t%q\\n" "$LINENO" "$BASH_COMMAND" >&9'
# The marker is opened by path at each signal, so no descriptor is left for
# the command to see or close; `$_` is printf's last argument, so the trap
# leaves it as it found it; the group's stderr hides the trap from `set -x`.
MARKS = tempfile.mktemp()
SIGNAL2 = 'printf "%s\\t%q\\t%.0s\\n" "$LINENO" "$BASH_COMMAND" "$_" >>' + MARKS
PRELUDES = {
    'path': f'''unset BASH_ENV S281_MARKS
trap '{{ {SIGNAL2}; }} 2>/dev/null' DEBUG
''',
    'path -T': f'''unset BASH_ENV S281_MARKS
set -T
trap '{{ {GUARD}{SIGNAL2}; }} 2>/dev/null' DEBUG
''',

    'trap': f'''unset BASH_ENV
exec 9>>"$S281_MARKS"
unset S281_MARKS
trap '{SIGNAL}' DEBUG
''',
    'trap -T': f'''unset BASH_ENV
exec 9>>"$S281_MARKS"
unset S281_MARKS
set -T
trap '{GUARD}{SIGNAL}' DEBUG
''',
}

CASES = [
    'false | true; echo "${PIPESTATUS[*]} $?"',
    'false | true\necho "${PIPESTATUS[*]} $?"',
    'echo hi > /dev/null; echo "$_"',
    'echo hi > /dev/null\necho "$_"',
    'false; echo $?',
    'echo $LINENO\necho $LINENO',
    'echo $-',
    '(echo $-)',
    'set -o | grep -E "functrace|errtrace|xtrace"',
    'trap -p',
    'trap',
    'ls /proc/self/fd',
    'set -e; false; echo unreachable',
    'set -e\nexec 9>&-\necho after',
    'exec 9>&-\necho after',
    'set -u; echo ok; f(){ echo in; }; f',
    'shopt -s extdebug; echo x',
    'echo a\nfi',
    'nosuchcmd',
    'echo x > /nonexistent/dir/f',
    '{ echo x; } > /nonexistent/dir/f',
    '( echo x ) > /nonexistent/dir/f',
    'exit 3',
    'f(){ return 4; }; f; echo $?',
    'trap "echo mine" DEBUG; echo a',
    'trap "echo ret" RETURN; f(){ :; }; f; echo done',
    'echo "$BASH_COMMAND"',
    'bash -c "echo nested \\$- \\${BASH_ENV-unset}"',
    'cat; echo "cat: $?"',
    'read x; echo "read: $? [$x]"',
    'echo "${BASH_ENV-unset} ${S281_MARKS-unset}"',
    'caller; echo "caller: $?"',
    'echo ${#BASH_SOURCE[@]} ${#FUNCNAME[@]}',
    'set | wc -l',
    'declare -p | wc -l',
    'env | wc -l',
    'set -x; echo traced; true',
    'set -x\necho traced',
    'BASH_XTRACEFD=2; set -x; echo traced',
    'set -v; echo verbose',
    'x=$(echo cs); echo "$x"',
    'for i in 1 2; do echo $i; done | cat',
    'eval "echo ev1\necho ev2"; echo $LINENO',
    'echo $BASHPID >/dev/null; echo $(( $(ulimit -n) > 0 ))',
    'sleep 0 & wait $!; echo "wait: $?"',
    'set -E; trap "echo err" ERR; false',
    'shopt -s extdebug; f(){ echo f; }; f',
    'echo "$BASH_SUBSHELL"; ( echo "$BASH_SUBSHELL" )',
]

def run(command, prelude):
    env = dict(os.environ)
    env.pop('BASH_ENV', None)
    pre_path = None
    if prelude is not None:
        with tempfile.NamedTemporaryFile('w', delete=False) as pre:
            pre.write(prelude)
        pre_path = pre.name
        env.update(BASH_ENV=pre_path, S281_MARKS=tempfile.mktemp())
    r = subprocess.run(['bash', '-c', command], env=env, stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if pre_path:
        os.unlink(pre_path)
    return r.stdout, r.stderr, r.returncode

for name, prelude in PRELUDES.items():
    print(f'=== {name}')
    same = 0
    for c in CASES:
        base = run(c, None)
        got = run(c, prelude)
        if got == base:
            same += 1
            continue
        print(f'--- {c!r}')
        for label, b, g in zip(('stdout', 'stderr', 'exit'), base, got):
            if b != g:
                print(f'  {label}: {b!r}\n  {" " * len(label)}  -> {g!r}')
    print(f'  {same} of {len(CASES)} the same')
