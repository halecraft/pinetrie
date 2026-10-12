"""Draw every noun's 64 candidates with PixelLab's Pro model.

PIXELLAB_KEY in the environment.

python3 draw.py <prompts.json> <out-dir> [noun ...]

prompts.json (or redo.json) maps each noun to its subject. One `generate-image-v2` job
per noun, 32×32 with a transparent background, which returns 64 images;
they land as <out-dir>/<noun>/00.png … 63.png. A noun whose folder already
holds 64 is skipped, so a run that stops is started again as it was. A
line (noun, seconds, usd, status) is appended to <out-dir>/log.tsv.
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.pixellab.ai/v2/"
TEMPLATE = (
    "{subject}. A single pixel art game icon, the whole subject centred "
    "in the square, bold clear silhouette, bright saturated colours."
)


def call(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        API + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["PIXELLAB_KEY"],
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def submit(body: dict) -> dict:
    """POST, waiting out a 429: a job slot frees a little after the last."""
    for _ in range(60):
        try:
            return call("POST", "generate-image-v2", body)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise RuntimeError(f"{e.code} {e.read()[:300]!r}") from e
            time.sleep(10)
    raise RuntimeError("429 for ten minutes")


def images_of(job: dict) -> list[str]:
    """Every base64 PNG in a finished job's reply, in order."""
    found: list[str] = []

    def walk(x: object) -> None:
        if isinstance(x, dict):
            if x.get("type") == "base64" and isinstance(x.get("base64"), str):
                found.append(x["base64"])
            else:
                for v in x.values():
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(job.get("last_response"))
    return found


def draw(noun: str, subject: str, out: str) -> None:
    folder = os.path.join(out, noun)
    if os.path.isdir(folder) and len(os.listdir(folder)) >= 64:
        return
    t0 = time.time()
    status, usd = "ok", None
    try:
        job = submit(
            {
                "description": TEMPLATE.format(subject=subject),
                "image_size": {"width": 32, "height": 32},
                "no_background": True,
            }
        )
        job_id = job["background_job_id"]
        while True:
            time.sleep(8)
            try:
                job = call("GET", f"background-jobs/{job_id}")
            except urllib.error.HTTPError as e:
                if e.code in (429, 502, 503, 504):
                    continue
                raise
            if job.get("status") not in ("processing", "pending", "queued"):
                break
        usd = json.dumps(job.get("usage"))
        if job.get("status") != "completed":
            raise RuntimeError(f"job {job.get('status')}: {json.dumps(job)[:300]}")
        images = images_of(job)
        if not images:
            raise RuntimeError(f"no images: {json.dumps(job)[:300]}")
        os.makedirs(folder, exist_ok=True)
        for i, b64 in enumerate(images):
            with open(os.path.join(folder, f"{i:02d}.png"), "wb") as f:
                f.write(base64.b64decode(b64.split(",", 1)[-1]))
        status = f"ok {len(images)}"
    except Exception as e:  # noqa: BLE001 — logged, and the next noun goes on
        status = str(e)[:400]
    line = f"{noun}\t{time.time() - t0:.0f}\t{usd}\t{status}"
    with open(os.path.join(out, "log.tsv"), "a") as f:
        f.write(line + "\n")
    print(line, flush=True)


def main() -> None:
    prompts_path, out, *only = sys.argv[1:]
    with open(prompts_path) as f:
        prompts: dict[str, str] = json.load(f)
    os.makedirs(out, exist_ok=True)
    for noun in only or list(prompts):
        draw(noun, prompts[noun], out)


main()
