#!/usr/bin/env python3
# S300: times bash's own work (builtins, expansions, loops, functions,
# command substitution, globbing, reads) under each bash given, best of RUNS,
# in a scratch directory of files for the globs.
#   time.py <name>=<bash> …
import os, subprocess, sys, tempfile, time

RUNS = 3
CASES = {
    'arithmetic loop': 'for ((i=0;i<300000;i++)); do x=$((x+i*2)); done',
    'string append': 's=; for ((i=0;i<40000;i++)); do s+="item$i,"; done; echo ${#s} >/dev/null',
    'array append and walk': 'a=(); for ((i=0;i<100000;i++)); do a+=("$i"); done; for v in "${a[@]}"; do :; done',
    'associative array': 'declare -A m; for ((i=0;i<60000;i++)); do m[k$i]=$i; done; for k in "${!m[@]}"; do :; done',
    'expansions on a long string': 'x=$(printf "ab%.0s" {1..5000}); for ((i=0;i<40;i++)); do y=${x//a/c}; z=${x^^}; w=${x:100:5000}; done',
    'function calls': 'f(){ local a=$1; echo $((a+1)) >/dev/null; }; for ((i=0;i<60000;i++)); do f $i; done',
    'printf -v': 'for ((i=0;i<100000;i++)); do printf -v s "%05d:%s" $i abc; done',
    'read a file line by line': 'while IFS=: read -r a b c; do :; done < lines.txt',
    'command substitution': 'for ((i=0;i<1500;i++)); do x=$(echo $i); done',
    'glob over 5,000 files': 'for ((i=0;i<20;i++)); do f=(f/*); done',
    'case patterns': 'for ((i=0;i<150000;i++)); do case "w$i" in w1*) ;; w2*) ;; *9) ;; *) ;; esac; done',
}

def main():
    shells = [a.split('=', 1) for a in sys.argv[1:]]
    with tempfile.TemporaryDirectory() as d:
        os.mkdir(f'{d}/f')
        for i in range(5000):
            open(f'{d}/f/file{i}.txt', 'w').close()
        with open(f'{d}/lines.txt', 'w') as fh:
            for i in range(100000):
                fh.write(f'{i}:abc:def{i}\n')
        print(f"{'case':30}" + ''.join(f'{n:>14}' for n, _ in shells))
        for name, cmd in CASES.items():
            best = []
            for _, sh in shells:
                b = None
                for _ in range(RUNS):
                    t = time.perf_counter()
                    subprocess.run([sh, '-c', cmd], cwd=d, stdin=subprocess.DEVNULL, check=True)
                    e = time.perf_counter() - t
                    b = e if b is None else min(b, e)
                best.append(b)
            base = best[0]
            print(f'{name:30}' + ''.join(f'{b:9.3f}s {b / base:3.1f}x' for b in best))

main()
