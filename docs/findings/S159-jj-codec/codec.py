#!/usr/bin/env python3
"""Probe D: jj as a codec for the state's source class. Disposable.

    python3 codec.py <step> ...   # steps: snapshot, novcs, large, direct, contradiction, roundtrip

- snapshot: in each corpus repo (with its derived files present), does jj's
  snapshot give the tree B names the source class with, and how long does it take?
- novcs: a folder with no VCS (S158's scenario). jj before and after an exclude
  file generated from the class map; a kept output that is ignored; a local file.
- large: new files over jj's 1 MiB default, by snapshot and by explicit track; and
  what a 1 GB blob costs through jj and through git.
- direct: the codec writes the commit's objects itself (loose objects, zlib) and jj
  imports the commit, against a jj snapshot and commit of the same turn.
- contradiction: a commit that tracks a path the ignore rules exclude.
- roundtrip: state -> jj commit -> fresh checkout -> state, with an executable,
  a symlink, an empty directory and a 2 MiB file.
Every command runs under a time limit. Writes results-<step>.json.
"""

import hashlib
import json
import os
import random
import shutil
import subprocess
import sys
import time
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "S156-state-identity"))
from gittree import Tree, tree_id  # noqa: E402

PROBES = Path("/workspace/sandbox/probes")
CORPUS = PROBES / "corpus"
WORK = PROBES / "d"
ENV = {**os.environ, "JJ_USER": "probe", "JJ_EMAIL": "probe@example.com", "HOME": str(PROBES / "home"), "JJ_CONFIG": str(PROBES / "empty-jj.toml")}
LIMIT = 300


def run(argv, cwd, check=True, **kw):
    r = subprocess.run(argv, cwd=cwd, env=ENV, capture_output=True, text=True, timeout=LIMIT, stdin=subprocess.DEVNULL, **kw)
    if check and r.returncode:
        raise RuntimeError(f"{argv}: {r.stderr[-500:]}")
    return r


def timed(argv, cwd, **kw):
    t = time.perf_counter()
    r = run(argv, cwd, **kw)
    return r, round((time.perf_counter() - t) * 1000, 1)


def jj_tree(repo, rev="@"):
    cid = run(["jj", "log", "-r", rev, "--no-graph", "--ignore-working-copy", "-T", "commit_id"], repo).stdout.strip()
    return run(["git", "rev-parse", f"{cid}^{{tree}}"], repo).stdout.strip()


def jj_files(repo, rev="@"):
    return set(run(["jj", "file", "list", "-r", rev, "--ignore-working-copy"], repo).stdout.split("\n")) - {""}


def state_name(repo: Path, paths) -> str:
    return Tree(str(repo), "sha1").build(sorted(paths)).hex()


def git_tracked(repo):
    return [p for p in run(["git", "ls-files", "-z"], repo).stdout.split("\0") if p]


def fresh_jj(repo: Path):
    shutil.rmtree(repo / ".jj", ignore_errors=True)
    run(["jj", "git", "init", "--colocate"] if (repo / ".git").exists() else ["jj", "git", "init"], repo)


results = {}


def snapshot():
    out = {}
    for name in ("pinetrie", "ripgrep", "flask", "linux"):
        repo = CORPUS / name
        fresh_jj(repo)
        r, first = timed(["jj", "util", "snapshot"], repo)
        _, again = timed(["jj", "util", "snapshot"], repo)
        source = git_tracked(repo)
        t = time.perf_counter()
        want = state_name(repo, source)
        name_ms = round((time.perf_counter() - t) * 1000, 1)
        got = jj_tree(repo)
        extra = sorted(jj_files(repo) - set(source))
        missing = sorted(set(source) - jj_files(repo))
        out[name] = {
            "files": len(source),
            "firstSnapshotMs": first,
            "snapshotAgainMs": again,
            "stateNameMs": name_ms,
            "jjTreeEqualsStateName": got == want,
            "inJjNotSource": extra[:10],
            "inSourceNotJj": missing[:10],
        }
        print(name, out[name], flush=True)
        shutil.rmtree(repo / ".jj")
    results["snapshot"] = out


NOVCS_DERIVED = ["node_modules", "site", "site2", "dist", ".cache", "out"]


def novcs():
    src = PROBES / "c2"
    repo = WORK / "novcs"
    shutil.rmtree(repo, ignore_errors=True)
    shutil.copytree(src, repo, symlinks=True)
    (repo / ".env").write_text("SECRET=1\n")
    (repo / "dist" / "keep.txt").write_text("kept output\n")
    files = []
    for d, _, fs in os.walk(repo):
        files += [os.path.relpath(os.path.join(d, f), repo) for f in fs]
    files = [f for f in files if not f.startswith((".git/", ".jj/"))]
    derived = {f for f in files if f.split("/")[0] in NOVCS_DERIVED} - {"dist/keep.txt"}
    local = {".env"}
    source = sorted(set(files) - derived - local)
    want = state_name(repo, source)
    out = {"files": len(files), "source": len(source)}

    run(["jj", "git", "init"], repo)
    run(["jj", "util", "snapshot"], repo)
    out["plainJj"] = {"equalsStateName": jj_tree(repo) == want, "tracked": len(jj_files(repo))}
    shutil.rmtree(repo / ".jj")
    shutil.rmtree(repo / ".git", ignore_errors=True)

    # The codec: an exclude file generated from the class map before jj ever
    # snapshots, and the kept output inside an excluded directory tracked by name.
    run(["jj", "git", "init", "--colocate"], repo)
    exclude = run(["git", "rev-parse", "--git-path", "info/exclude"], repo).stdout.strip()
    Path(repo / exclude).parent.mkdir(parents=True, exist_ok=True)
    Path(repo / exclude).write_text("".join(f"/{d}/\n" for d in NOVCS_DERIVED) + "/.env\n")
    run(["jj", "util", "snapshot"], repo)
    before_keep = jj_tree(repo) == want
    r = run(["jj", "file", "track", "--include-ignored", "dist/keep.txt"], repo, check=False)
    run(["jj", "util", "snapshot"], repo)
    got = jj_files(repo)
    out["codecJj"] = {
        "equalsStateNameBeforeTrackingKept": before_keep,
        "trackKeptExit": r.returncode,
        "trackKeptStderr": r.stderr.strip()[-200:],
        "equalsStateName": jj_tree(repo) == want,
        "envTracked": ".env" in got,
        "keptTracked": "dist/keep.txt" in got,
        "derivedTracked": sorted(got & derived)[:5],
    }
    # A kept file keeps being tracked when it changes; an excluded one never is.
    (repo / "dist" / "keep.txt").write_text("kept output, edited\n")
    (repo / "site" / "new.html").write_text("derived\n")
    run(["jj", "util", "snapshot"], repo)
    got = jj_files(repo)
    out["afterEdits"] = {"keptStillTracked": "dist/keep.txt" in got, "newDerivedTracked": "site/new.html" in got}
    # A path tracked before it was excluded stays tracked (lucky-falcon's case).
    (repo / "scratch.txt").write_text("tracked first\n")
    run(["jj", "util", "snapshot"], repo)
    Path(repo / exclude).write_text(Path(repo / exclude).read_text() + "/scratch.txt\n")
    (repo / "scratch.txt").write_text("tracked first, then excluded\n")
    run(["jj", "util", "snapshot"], repo)
    out["trackedThenExcludedStaysTracked"] = "scratch.txt" in jj_files(repo)
    print("novcs", out, flush=True)
    results["novcs"] = out


def large():
    repo = WORK / "large"
    shutil.rmtree(repo, ignore_errors=True)
    repo.mkdir(parents=True)
    run(["jj", "git", "init", "--colocate"], repo)
    (repo / "small.txt").write_text("x\n")
    (repo / "two-mib.bin").write_bytes(random.Random(1).randbytes(2 << 20))
    r = run(["jj", "util", "snapshot"], repo, check=False)
    st = run(["jj", "st"], repo, check=False)
    out = {"newTwoMiBTrackedBySnapshot": "two-mib.bin" in jj_files(repo), "snapshotWarning": (r.stderr + st.stderr).strip()[-300:]}
    r = run(["jj", "file", "track", "two-mib.bin"], repo, check=False)
    out["explicitTrack"] = {"exit": r.returncode, "stderr": r.stderr.strip()[-300:], "tracked": "two-mib.bin" in jj_files(repo)}
    r = run(["jj", "file", "track", "--config", "snapshot.max-new-file-size=0", "two-mib.bin"], repo, check=False)
    out["explicitTrackLimit0"] = {"exit": r.returncode, "stderr": r.stderr.strip()[-300:], "tracked": "two-mib.bin" in jj_files(repo)}
    # Once tracked, does an edit that grows it past the limit stay tracked?
    (repo / "small.txt").write_bytes(random.Random(2).randbytes(3 << 20))
    run(["jj", "util", "snapshot"], repo, check=False)
    out["trackedFileGrowsPastLimitStaysTracked"] = "small.txt" in jj_files(repo)
    # 1 GB, written as a blob: by jj's snapshot (limit raised) and by git.
    subprocess.run([str(PROBES / "cdc"), "gen", str(repo / "one-gb.bin"), str(1 << 30), "5"], check=True, timeout=LIMIT)
    _, ms = timed(["jj", "util", "snapshot", "--config", "snapshot.max-new-file-size=2GiB"], repo, check=False)
    out["oneGbBySnapshotMs"] = ms
    out["oneGbTracked"] = "one-gb.bin" in jj_files(repo)
    _, ms = timed(["git", "hash-object", "-w", "one-gb.bin"], repo)
    out["oneGbByGitHashObjectMs"] = ms
    _, ms = timed(["git", "hash-object", "one-gb.bin"], repo)
    out["oneGbHashOnlyMs"] = ms
    du = run(["du", "-sm", ".git/objects"], repo).stdout.split()[0]
    out["gitObjectsMBAfter"] = int(du)
    print("large", out, flush=True)
    results["large"] = out
    shutil.rmtree(repo)


def write_object(git_dir: Path, kind: bytes, body: bytes) -> bytes:
    data = kind + b" %d\0" % len(body) + body
    oid = hashlib.sha1(data).digest()
    h = oid.hex()
    p = git_dir / "objects" / h[:2] / h[2:]
    if not p.exists():
        p.parent.mkdir(exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_bytes(zlib.compress(data, 1))
        os.replace(tmp, p)
    return oid


def direct():
    """The codec writes a turn's commit: the changed blobs, the trees above them, a
    commit, a ref; jj imports it. Against `jj commit` of the same turn."""
    out = {}
    for name in ("pinetrie", "linux"):
        repo = CORPUS / name
        run(["git", "checkout", "-q", "--", "."], repo)
        run(["git", "clean", "-qfd", "-e", "node_modules"], repo)
        fresh_jj(repo)
        run(["jj", "util", "snapshot"], repo)
        git_dir = repo / ".git"
        paths = git_tracked(repo)
        tree = Tree(str(repo), "sha1")
        tree.build(paths)
        rnd = random.Random(3)
        edited = rnd.sample([p for p in paths if not os.path.islink(repo / p)], 5)
        for p in edited:
            with open(repo / p, "a") as f:
                f.write("\n// a turn\n")
        new = ["probe-new/a.txt", "probe-new/b/c.txt"]
        for p in new:
            (repo / p).parent.mkdir(parents=True, exist_ok=True)
            (repo / p).write_text("new\n")
        changed = edited + new
        # Codec: update the name, then write only what is new.
        t = time.perf_counter()
        root_id = tree.update(changed)
        for p in changed:
            write_object(git_dir, b"blob", (repo / p).read_bytes())
        dirty = {"/".join(p.split("/")[:i]) for p in changed for i in range(p.count("/") + 1)}
        for d in sorted(dirty, key=lambda x: -x.count("/") - (1 if x else 0)):
            entries = tree.dirs[d]
            body = b"".join(m + b" " + n + b"\0" + oid for n, (m, oid) in sorted(entries.items(), key=lambda i: i[0] + b"/" if i[1][0] == b"40000" else i[0]))
            assert write_object(git_dir, b"tree", body) == tree_id(entries, "sha1")
        parent = run(["git", "rev-parse", "HEAD"], repo).stdout.strip()
        ts = int(time.time())
        commit = write_object(git_dir, b"commit", f"tree {root_id.hex()}\nparent {parent}\nauthor probe <probe@example.com> {ts} +0000\ncommitter probe <probe@example.com> {ts} +0000\n\na turn, written by the codec\n".encode())
        write_ms = round((time.perf_counter() - t) * 1000, 1)
        run(["git", "update-ref", "refs/heads/codec-turn", commit.hex()], repo)
        _, import_ms = timed(["jj", "git", "import", "--ignore-working-copy"], repo)
        jj_sees = jj_tree(repo, "codec-turn") == root_id.hex()
        ops = run(["jj", "op", "log", "--ignore-working-copy", "--no-graph", "-n", "1", "-T", "description"], repo).stdout.strip()
        # The same turn by jj: snapshot and commit.
        _, jj_ms = timed(["jj", "commit", "-m", "a turn, by jj"], repo)
        same = jj_tree(repo, "@-") == root_id.hex()
        out[name] = {
            "changedPaths": len(changed),
            "codecWriteMs": write_ms,
            "jjGitImportMs": import_ms,
            "jjSeesCodecCommitWithStateName": jj_sees,
            "lastOperation": ops,
            "jjCommitMs": jj_ms,
            "jjCommitTreeEqualsStateName": same,
        }
        print(name, out[name], flush=True)
        run(["git", "update-ref", "-d", "refs/heads/codec-turn"], repo)
        run(["git", "checkout", "-q", "--", "."], repo)
        run(["git", "clean", "-qfd", "-e", "node_modules"], repo)
        shutil.rmtree(repo / ".jj")
    results["direct"] = out


def contradiction():
    repo = WORK / "contra"
    shutil.rmtree(repo, ignore_errors=True)
    repo.mkdir(parents=True)
    run(["git", "init", "-q"], repo)
    (repo / ".env").write_text("SECRET=1\n")
    (repo / ".gitignore").write_text(".env\n")
    run(["git", "add", "-f", ".env", ".gitignore"], repo)
    run(["git", "-c", "user.name=p", "-c", "user.email=p@e", "commit", "-qm", "tracks an ignored .env"], repo)
    run(["jj", "git", "init", "--colocate"], repo)
    (repo / ".env").write_text("SECRET=2\n")
    st = run(["jj", "st"], repo).stdout
    out = {"jjStillTracksIgnoredEnv": ".env" in jj_files(repo), "editShownAsChange": "M .env" in st}
    print("contradiction", out, flush=True)
    results["contradiction"] = out
    shutil.rmtree(repo)


def roundtrip():
    repo = WORK / "rt"
    shutil.rmtree(repo, ignore_errors=True)
    repo.mkdir(parents=True)
    (repo / "bin").mkdir()
    (repo / "bin" / "run.sh").write_text("#!/bin/sh\necho hi\n")
    os.chmod(repo / "bin" / "run.sh", 0o755)
    (repo / "notes.md").write_text("notes\n")
    os.symlink("notes.md", repo / "link.md")
    (repo / "empty").mkdir()
    (repo / "two-mib.bin").write_bytes(random.Random(4).randbytes(2 << 20))
    (repo / "odd mode.txt").write_text("0600\n")
    os.chmod(repo / "odd mode.txt", 0o600)
    source = ["bin/run.sh", "notes.md", "link.md", "two-mib.bin", "odd mode.txt"]
    want = state_name(repo, source)
    run(["jj", "git", "init", "--colocate", "--config", "snapshot.max-new-file-size=0"], repo)
    run(["jj", "commit", "-m", "state", "--config", "snapshot.max-new-file-size=0"], repo)
    got = jj_tree(repo, "@-")
    back = WORK / "rt-back"
    shutil.rmtree(back, ignore_errors=True)
    run(["jj", "workspace", "add", "--name", "back", "-r", "@-", str(back)], repo)
    files = [os.path.relpath(os.path.join(d, f), back) for d, ds, fs in os.walk(back) for f in fs + [x for x in ds if os.path.islink(os.path.join(d, x))]]
    files = [f for f in files if not f.startswith(".jj")]
    again = state_name(back, files)
    out = {
        "commitTreeEqualsStateName": got == want,
        "checkoutRenamesTheSameState": again == want,
        "emptyDirKept": (back / "empty").exists(),
        "execKept": os.access(back / "bin" / "run.sh", os.X_OK),
        "symlinkKept": os.path.islink(back / "link.md"),
        "oddModeComesBackAs": oct(os.stat(back / "odd mode.txt").st_mode & 0o777),
    }
    print("roundtrip", out, flush=True)
    results["roundtrip"] = out
    shutil.rmtree(repo)
    shutil.rmtree(back)


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    for step in sys.argv[1:]:
        globals()[step]()
        (HERE / f"results-{step}.json").write_text(json.dumps(results[step], indent=1) + "\n")
