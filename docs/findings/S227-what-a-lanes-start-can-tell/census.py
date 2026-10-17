import json, sqlite3, sys, collections
db = sqlite3.connect("file:/tmp/census.db?mode=ro", uri=True)
def records(doc):
    ns = collections.defaultdict(dict)
    rows = db.execute("select seq, payload from kyneta_records where doc_id=? and kind='entry' order by seq", (doc,))
    for seq, payload in rows:
        p = json.loads(payload)
        d = json.loads(p["data"])
        if p["kind"] == "entirety":
            ns = collections.defaultdict(dict, {k: dict(v) for k, v in d["state"].get("records", {}).items()})
            continue
        for batch in d["batches"]:
            for op in batch:
                path = op["path"]
                if len(path) == 1 and path[0].get("field") == "records":
                    ch = op["change"]
                    for k, v in (ch.get("set") or {}).items(): ns[k] = dict(v)
                    for k in (ch.get("delete") or []): ns.pop(k, None)
                if len(path) != 2 or path[0].get("field") != "records": continue
                name = path[1]["entry"]; ch = op["change"]
                if ch.get("type") != "map": continue
                for k, v in (ch.get("set") or {}).items(): ns[name][k] = v
                for k in (ch.get("delete") or []): ns[name].pop(k, None)
    return ns
s = records("pinetrie:session")
lanes = s.get("pinetrie.lane", {})
print("lane records", len(lanes), "own", sum(1 for v in lanes.values() if v.get("history")))
print("files-lost", len(s.get("pinetrie.files-lost", {})))
revs = collections.defaultdict(list)
roots = [r[0] for r in db.execute("select distinct doc_id from kyneta_records where doc_id like 'root:%'")]
for root in roots:
    for k, v in records(root).get("pinetrie.revision", {}).items():
        revs[v["lane"]].append((k, v.get("snapshot"), v.get("point")))
out = {}
for lane, v in lanes.items():
    rs = revs.get(lane, [])
    out[lane] = {"history": v.get("history"), "root": v.get("root"), "createdAt": v.get("createdAt"),
                 "records": len(rs), "snapshots": sorted([r[1] for r in rs if r[1]], reverse=True),
                 "nullSnapshotWithPoint": sum(1 for r in rs if not r[1] and r[2])}
json.dump(out, open("lanes.json", "w"))
print("written", len(out))

for lane in ["t-01a0fd84-143d-74dd-a422-4e122b1ca16b","t-01a14b40-71fd-777c-adc5-abe68c5fac06"]:
    print(lane, "name", s.get("pinetrie.name",{}).get(lane), "thread", s.get("pinetrie.thread",{}).get(lane), "verdict", s.get("pinetrie.verdict",{}).get(lane), "base", s.get("pinetrie.base",{}).get(lane), "proposed", s.get("pinetrie.proposed-changes",{}).get(lane))
print(sorted(s.keys()))
