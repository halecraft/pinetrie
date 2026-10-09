import json,sys,re,collections
for f in sys.argv[1:]:
    c=collections.Counter(); ex={}
    for l in open(f):
        r=json.loads(l)
        tips=r['tips']; ctx=r['ctxLane']
        src='scribe' if 'scribe.ts' in r['stack'] else ('pi-harness' if 'pi-agent-core' in r['stack'] else 'other')
        tipcls = 'no-tip' if not tips else ('1-tip' if len(set(tips))==1 else f'{len(set(tips))}-tips')
        ctxcls = 'ctx=none' if ctx is None else ('ctx=tip' if tips and ctx==tips[0] and len(set(tips))==1 else 'ctx!=tip')
        k=(src,tipcls,ctxcls); c[k]+=1; ex.setdefault(k,r)
    print('==',f)
    for k,n in c.most_common():
        e=ex[k]; print(n,k,e['kinds'][:4], e['tips'][:2], (e['ctxLane'] or ''), '\n     ', re.sub(r'file://\S*/(packages|apps|node_modules)/','',e['stack'])[:300])
