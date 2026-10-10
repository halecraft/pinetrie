import re,datetime
from collections import Counter
recs=[]
for l in open("docker-calls.tsv"):
    if re.match(r"^\d+\.\d+\t", l): recs.append(l.rstrip("\n"))
    else: recs[-1]+=" ⏎ "+l.rstrip("\n")
rows=[]
for r in recs:
    t,ms,rc,a=r.split("\t",3); rows.append((float(t),float(ms),rc,a))
rows.sort()
t0=rows[0][0]
print("span %.1fs from %s UTC, %d calls"%(rows[-1][0]-t0, datetime.datetime.fromtimestamp(t0, datetime.UTC).strftime("%H:%M:%S"), len(rows)))
def kind(a):
    w=a.split()
    k=w[0]
    if k=="exec":
        if "pinetrie-disks" in a:
            inner=a.split("pinetrie-disks",1)[1]
            m=re.search(r"btrfs -q subvolume (\w+)|subvolume (\w+)|(stat)|(cat)|(test)|(printf)",inner)
            return "exec disks: "+(next(g for g in m.groups() if g) if m else inner.strip()[:30])
        return "exec -i (channel)" if w[1] in("-i",) else "exec "+w[1][:30]
    if k=="run": return "run "+("--rm" if "--rm" in a else "-d")
    if k in("network","image","container","buildx"): return k+" "+w[1]
    return k
groups=[];cur=[rows[0]]
for r in rows[1:]:
    end=max(x[0]+max(x[1],0)/1000 for x in cur)
    if r[0]-end>2: groups.append(cur);cur=[r]
    else: cur.append(r)
groups.append(cur)
for i,g in enumerate(groups):
    s=g[0][0]-t0; e=max(x[0]+max(x[1],0)/1000 for x in g)-t0
    tot=sum(x[1] for x in g if x[1]>0)
    c=Counter(); ms=Counter()
    for x in g: k=kind(x[3]); c[k]+=1; ms[k]+=max(x[1],0)
    print(f"\n# group {i}: t+{s:.1f}..{e:.1f}s  {len(g)} calls, {tot:.0f} ms summed")
    for k,n in sorted(c.items(), key=lambda kv:-ms[kv[0]]): print(f"   {n:3d} x {k:32s} {ms[k]:7.0f} ms  (mean {ms[k]/n:5.1f})")
import sys
if len(sys.argv)>1:
    for x in rows: print(f"{x[0]-t0:7.2f} {x[1]:7.1f} {x[2]} {x[3][:150]}")
