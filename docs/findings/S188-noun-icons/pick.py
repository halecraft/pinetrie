"""python3 pick.py noun=NN|noun=redo:NN ...: records each noun's chosen candidate in picks.json."""
import json, os, sys
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "picks.json")
picks = json.load(open(path)) if os.path.exists(path) else {}
for arg in sys.argv[1:]:
    noun, n = arg.split("=")
    picks[noun] = n if ":" in n else int(n)
order = list(json.load(open(os.path.join(os.path.dirname(path), "prompts.json"))))
with open(path, "w") as f:
    json.dump({k: picks[k] for k in order if k in picks}, f, indent=1)
    f.write("\n")
print(len(picks), "picked")
