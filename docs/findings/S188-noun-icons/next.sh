# bash next.sh [k]: the k-th (from 0) group of four drawn nouns not yet picked, as one grid.
C=/workspace/.plans/noun-icons/candidates; G=/workspace/.plans/noun-icons/grids
cd "$(dirname "$0")"
todo=$(GROUP="${1:-0}" CAND="$C" python3 - <<'P'
import json, os
C = os.environ["CAND"]
p = json.load(open("prompts.json"))
k = json.load(open("picks.json")) if os.path.exists("picks.json") else {}
d = [n for n in p if n not in k and os.path.isdir(f"{C}/{n}") and len(os.listdir(f"{C}/{n}")) >= 64]
o = 4 * int(os.environ["GROUP"])
print(" ".join(d[o : o + 4]))
P
)
[ -z "$todo" ] && { echo none; exit; }
out=$G/$(echo $todo | tr ' ' '-').png
node grid.mjs "$out" $(for n in $todo; do echo $C/$n; done) && echo "$out"
