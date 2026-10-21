import json,re,collections,bisect
def decls(path):
    out=[]
    for i,l in enumerate(open(path),1):
        m=re.match(r'\s*(?:export )?(?:async )?function\*? (\w+)|\s*(?:export )?const (\w+)\s*=\s*(?:async|\(|\w+ =>|<)|\s{2,6}(?:async )?(\w+)\s*\([^)]*\)\s*\{|\s+const (\w+) = async', l)
        if m: out.append((i, next(g for g in m.groups() if g)))
    return out
cache={}
def fn(file,line):
    if file not in cache: cache[file]=decls(file)
    d=cache[file]; i=bisect.bisect_right([x[0] for x in d],line)-1
    return d[i][1] if i>=0 else '?'
T='packages/jj/repo.test.ts'
src=open(T).read().split('\n')
tests=[]
for i,l in enumerate(src,1):
    if re.match(r'\s*test\(',l):
        j=i; t=''
        while '"' not in t and j<i+3: t+=src[j-1]; j+=1
        m=re.search(r'"([^"]+)"',t); tests.append((i,m.group(1) if m else '?'))
tstarts=[t[0] for t in tests]
agrees_lo=next(i for i,l in enumerate(src,1) if 'const agrees = async' in l)
agrees_hi=agrees_lo+50
TEST_FILES=(T,'packages/jj/fixtures.ts')
PLUMB=('packages/lanes/run.ts','packages/jj/run.ts')
per_test=collections.defaultdict(lambda: collections.Counter())
ops=collections.Counter(); opsites=collections.defaultdict(set); agree=0; total=0
for line in open('stacks.jsonl'):
    r=json.loads(line); total+=1
    fr=[(f.split('@')[1].rsplit(':',1)) for f in r['frames']]
    fr=[(a,int(b)) for a,b in fr]
    tfr=[x for x in fr if x[0]==T]
    if not tfr: continue
    outer=tfr[-1][1]; ti=bisect.bisect_right(tstarts,outer)-1
    test=tests[ti][1] if ti>=0 else 'setup'
    inag=any(x[0]==T and agrees_lo<=x[1]<=agrees_hi for x in fr)
    k=next(i for i,x in enumerate(fr) if x[0] in TEST_FILES)
    prod=[x for x in fr[:k] if x[0] not in PLUMB]
    if prod: op=fn(*prod[-1]); where=prod[-1][0].replace('packages/','')
    else:
        op='(test code) '+fn(*fr[k]) if fr[k][0]!=T else '(test\'s own command)'; where=''
    if fr[k][0]=='packages/jj/fixtures.ts' and not prod: op='fixture '+fn(*fr[k])
    key=f'{op}'
    ops[key]+=1; opsites[key].add((test,fr[k]))
    per_test[test]['agrees' if inag else 'other']+=1
    if inag: agree+=1
print('processes',total,'in agrees()',agree)
print('\n== by operation the test code called: processes, distinct call sites x tests, per call')
for k,n in ops.most_common(40):
    c=len(opsites[k]); print(f'{n:5d} {c:4d} {n/c:5.1f}  {k}')
json.dump({t:dict(c) for t,c in per_test.items()},open('/tmp/per_test.json','w'))
print('\n== innermost test-file frame names')
c=collections.Counter()
for line in open('stacks.jsonl'):
    r=json.loads(line)
    fr=[(a,int(b)) for a,b in (f.split('@')[1].rsplit(':',1) for f in r['frames'])]
    k=next((i for i,x in enumerate(fr) if x[0] in TEST_FILES),None)
    if k is None: continue
    c[(fn(*fr[k]),fr[k][1])]+=1
for (n,l),v in c.most_common(15): print(v,n,l)
