"""Draw nouns with PixelLab. PIXELLAB_KEY in the environment.

python3 draw.py <out-dir> <endpoint> <json-overrides> noun [noun ...]

Each noun is one request; the PNG lands as <out-dir>/<noun>.png, and a line
(noun, seconds, usd, status) is appended to <out-dir>/log.tsv. A
`style_image` override naming a file is sent as its base64.
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.pixellab.ai/v2/"
PROMPT = "{noun}, a single game sprite, side view, whole and centred"


def main() -> None:
    out, endpoint, overrides, *nouns = sys.argv[1:]
    os.makedirs(out, exist_ok=True)
    extra = json.loads(overrides)
    for key in ("style_image", "color_image"):
        if isinstance(extra.get(key), str):
            with open(extra[key], "rb") as f:
                extra[key] = {
                    "type": "base64",
                    "base64": base64.b64encode(f.read()).decode(),
                }
    prompt = extra.pop("prompt", PROMPT)
    for noun in nouns:
        body = {
            "description": prompt.format(noun=noun),
            "image_size": {"width": 32, "height": 32},
            "no_background": True,
            **extra,
        }
        req = urllib.request.Request(
            API + endpoint,
            data=json.dumps(body).encode(),
            headers={
                "Authorization": "Bearer " + os.environ["PIXELLAB_KEY"],
                "Content-Type": "application/json",
            },
        )
        t0 = time.time()
        # The free plan runs one job at a time, and its slot frees a few
        # seconds after the previous reply: a 429 then is waited out.
        for _ in range(12):
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    reply = json.load(r)
                status = "ok"
                break
            except urllib.error.HTTPError as e:
                reply = {}
                status = f"{e.code} {e.read()[:300]!r}"
                if e.code != 429:
                    break
                time.sleep(10)
                t0 = time.time()
        secs = time.time() - t0
        usd = json.dumps(reply.get("usage"))
        b64 = reply.get("image", {}).get("base64", "")
        if b64:
            with open(os.path.join(out, noun + ".png"), "wb") as f:
                f.write(base64.b64decode(b64.split(",", 1)[-1]))
        with open(os.path.join(out, "log.tsv"), "a") as f:
            f.write(f"{noun}\t{secs:.1f}\t{usd}\t{status}\n")
        print(noun, f"{secs:.1f}s", usd, status, flush=True)
        if status != "ok" and status.startswith(("401", "402")):
            sys.exit(1)


main()
