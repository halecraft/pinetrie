#!/usr/bin/env python3
# S298, Q4 across images: same.py's cases, run inside another image by its
# own bash and by one of pine·trie's static builds, under each locale the
# image can have. Prints each difference.
#   cross.py <image> <our bash> [<setup command>]
# The image gets the cases, our bash and a runner by a small build; only
# /bin/sh is needed in it.
import io, os, subprocess, sys, tarfile, tempfile

sys.path.insert(0, os.path.dirname(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location('same', os.path.join(os.path.dirname(__file__), 'same.py'))
src = open(spec.origin).read()
CASES = eval(src[src.index('CASES = ') + 8:src.index(']\n', src.index('CASES = ')) + 1])
NAMES = eval(src[src.index('NAMES = ') + 8:src.index('\n', src.index('NAMES = '))])

image, ours = sys.argv[1], sys.argv[2]
setup = sys.argv[3] if len(sys.argv) > 3 else 'true'
RUNNER = r'''#!/bin/sh
mkdir -p /out /files && cd /files
for n in $(cat /names); do : > "$n"; done
for loc in none C.UTF-8 en_US.UTF-8; do
  for f in /cases/*; do
    for b in image ours; do
      if [ $b = image ]; then sh=$(command -v bash); else sh=/ours; fi
      o=/out/$loc.$b.$(basename $f)
      if [ $loc = none ]; then env -u LANG "$sh" -c "$(cat $f)" > $o.out 2> $o.err < /dev/null
      else LANG=$loc "$sh" -c "$(cat $f)" > $o.out 2> $o.err < /dev/null; fi
      echo $? > $o.rc
      sed -i "s#$sh#BASH#g" $o.out $o.err 2>/dev/null
    done
  done
done
tar -C /out -cf - .
'''
with tempfile.TemporaryDirectory() as d:
    os.makedirs(f'{d}/cases')
    for i, c in enumerate(CASES):
        open(f'{d}/cases/{i:02d}', 'w').write(c)
    open(f'{d}/names', 'w').write('\n'.join(NAMES))
    open(f'{d}/run.sh', 'w').write(RUNNER)
    subprocess.run(['cp', ours, f'{d}/ours'], check=True)
    open(f'{d}/Containerfile', 'w').write(f'''FROM {image}
RUN {setup}
COPY cases /cases
COPY names run.sh ours /
''')
    subprocess.run(['docker', 'build', '-q', '-t', 's285-cross', '-f', f'{d}/Containerfile', d], check=True, stdout=subprocess.DEVNULL)
    tar = subprocess.run(['docker', 'run', '--rm', 's285-cross', 'sh', '/run.sh'],
                         capture_output=True, check=True).stdout
files = {}
with tarfile.open(fileobj=io.BytesIO(tar)) as t:
    for m in t.getmembers():
        if m.isfile():
            files[m.name.lstrip('./')] = t.extractfile(m).read()
version = files.get('none.image.23.out', b'?').decode().strip()
print(f'=== {image}: its bash {version}')
for loc in ('none', 'C.UTF-8', 'en_US.UTF-8'):
    same, diffs = 0, []
    for i, c in enumerate(CASES):
        a = [files.get(f'{loc}.image.{i:02d}.{k}') for k in ('out', 'err', 'rc')]
        b = [files.get(f'{loc}.ours.{i:02d}.{k}') for k in ('out', 'err', 'rc')]
        if a == b:
            same += 1
        else:
            diffs.append(f'  {c!r}\n    image {a}\n    ours  {b}')
    print(f'--- LANG={loc}: {same} of {len(CASES)} the same')
    for x in diffs:
        print(x)
