"""git's tree format, hashed from a disk, kept up to date from changed paths. Disposable.

A Tree holds, for each directory, its entries (name -> (mode, id)) and its own id.
`build` hashes a set of files in full; `update` rehashes the given paths and the
directories above them.
"""

import hashlib
import os
import stat

READ = 8 << 20


def blob_id(path: str, algo: str) -> bytes:
    st = os.lstat(path)
    h = hashlib.new(algo)
    if stat.S_ISLNK(st.st_mode):
        data = os.readlink(path).encode()
        h.update(b"blob %d\0" % len(data))
        h.update(data)
        return h.digest()
    h.update(b"blob %d\0" % st.st_size)
    with open(path, "rb", buffering=0) as f:
        while chunk := f.read(READ):
            h.update(chunk)
    return h.digest()


def mode_of(path: str) -> bytes:
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode):
        return b"120000"
    return b"100755" if st.st_mode & 0o111 else b"100644"


def _sort_key(item):
    name, (mode, _) = item
    return name + b"/" if mode == b"40000" else name


def tree_id(entries: dict, algo: str) -> bytes:
    body = b"".join(mode + b" " + name + b"\0" + oid for name, (mode, oid) in sorted(entries.items(), key=_sort_key))
    h = hashlib.new(algo)
    h.update(b"tree %d\0" % len(body))
    h.update(body)
    return h.digest()


class Tree:
    def __init__(self, root: str, algo: str = "sha1"):
        self.root = root
        self.algo = algo
        self.dirs: dict[str, dict] = {"": {}}
        self.ids: dict[str, bytes] = {}

    def _set(self, rel: str, value):
        parent, _, name = rel.rpartition("/")
        parts = parent.split("/") if parent else []
        for i in range(len(parts)):
            d = "/".join(parts[: i + 1])
            if d not in self.dirs:
                self.dirs[d] = {}
                self.dirs["/".join(parts[:i])][parts[i].encode()] = (b"40000", None)
        if value is None:
            self.dirs[parent].pop(name.encode(), None)
        else:
            self.dirs[parent][name.encode()] = value

    def _hash_dirs(self, dirty: set[str]) -> bytes:
        order = sorted(dirty, key=lambda x: (x.count("/") + 1) if x else 0, reverse=True)
        for d in order:
            entries = self.dirs.get(d)
            if entries is None:
                continue
            if not entries and d:
                # git has no empty trees: drop it from its parent.
                del self.dirs[d]
                parent, _, name = d.rpartition("/")
                self.dirs[parent].pop(name.encode(), None)
                continue
            oid = tree_id(entries, self.algo)
            self.ids[d] = oid
            if d:
                parent, _, name = d.rpartition("/")
                self.dirs[parent][name.encode()] = (b"40000", oid)
        return self.ids[""]

    def build(self, paths: list[str]) -> bytes:
        for rel in paths:
            full = os.path.join(self.root, rel)
            self._set(rel, (mode_of(full), blob_id(full, self.algo)))
        return self._hash_dirs(set(self.dirs))

    def update(self, changed: list[str]) -> bytes:
        dirty = set()
        for rel in changed:
            full = os.path.join(self.root, rel)
            if os.path.lexists(full) and not os.path.isdir(full) or os.path.islink(full):
                self._set(rel, (mode_of(full), blob_id(full, self.algo)))
            else:
                self._set(rel, None)
            parts = rel.split("/")[:-1]
            dirty.update("/".join(parts[:i]) for i in range(len(parts) + 1))
        return self._hash_dirs(dirty)
