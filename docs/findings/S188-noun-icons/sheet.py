"""python3 sheet.py <candidates-dir> <out.png>: the picked icon of each noun, in the
order of packages/core/thread-names.ts's NOUNS (prompts.json's order), 16 to a
row of 32×32 tiles: the sheet is 512×512, and the noun at index i is at
column i % 16, row i // 16. A pick written "redo:N" or "redo2:N" in picks.json
is taken from <candidates-dir>-redo or <candidates-dir>-redo2.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import decode, encode

here = os.path.dirname(os.path.abspath(__file__))
cand, out = sys.argv[1:]
order = list(json.load(open(os.path.join(here, "prompts.json"))))
picks = json.load(open(os.path.join(here, "picks.json")))
W = 16 * 32
px = [(0, 0, 0, 0)] * (W * W)
for i, noun in enumerate(order):
    pick = str(picks[noun])
    folder = cand + "-" + pick.split(":")[0] if ":" in pick else cand
    n = int(pick.split(":")[-1])
    w, h, tile = decode(os.path.join(folder, noun, f"{n:02d}.png"))
    assert (w, h) == (32, 32), (noun, w, h)
    ox, oy = (i % 16) * 32, (i // 16) * 32
    for k, p in enumerate(tile):
        px[(oy + k // 32) * W + ox + k % 32] = p if p[3] else (0, 0, 0, 0)
encode(out, W, W, px)
print(out, os.path.getsize(out), "bytes,", len(set(px)), "colours")
