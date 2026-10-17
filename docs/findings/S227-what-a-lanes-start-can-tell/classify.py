# Each lane of census.py's lanes.json placed by what a start can see: its
# disk (disks.txt: `ls lanes` in the project's disks directory, after a
# count line), its revision records, and which of their snapshots exist
# (snaps.txt: `ls snapshots`).
import json, collections
d = json.load(open("lanes.json"))
disks = set(l.strip() for l in open("disks.txt").read().split("\n")[1:] if l.strip())
snaps = set(l.strip() for l in open("snaps.txt") if l.strip())
c = collections.Counter(); ex = collections.defaultdict(list)
for lane, v in d.items():
    have = [s for s in v["snapshots"] if s in snaps]
    key = ("disk" if lane in disks else "no-disk",
           "records" if v["records"] else "no-records",
           "snap-kept" if have else ("snaps-all-gone" if v["snapshots"] else "never-snap"))
    c[key] += 1; ex[key].append(lane)
for k, n in sorted(c.items()): print(k, n, ex[k][:3] if n < 5 else "")
print("disks without a lane record", len(disks - set(d)))
