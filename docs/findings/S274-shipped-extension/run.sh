#!/usr/bin/env bash
# Runs S274. $1 is a scratch directory. Packs `pnpm run package`'s output
# with the extension added to its manifest, installs the tarball globally
# with npm and with pnpm, each under its own prefix, and runs probe.mjs
# against each install. Results go beside this file.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
work="$1"
export PNPM_HOME="$work/pnpm-home"
npm_root="$work/npm/lib/node_modules/pinetrie"
# $2 = probe-only: rerun the probe against the installs already made.
if [ "${2:-}" != probe-only ]; then
rm -rf "$work"
mkdir -p "$work"

(cd "$repo" && node scripts/package.ts >/dev/null 2>&1)
cp -r "$repo/dist/pinetrie" "$work/pkg"
node -e '
  const fs = require("node:fs")
  const f = process.argv[1]
  const m = JSON.parse(fs.readFileSync(f, "utf8"))
  m.dependencies["@gotgenes/pi-anthropic-auth"] = "3.4.3"
  fs.writeFileSync(f, JSON.stringify(m, null, 2))
' "$work/pkg/package.json"
(cd "$work" && npm pack ./pkg --silent >/dev/null)
tgz="$(ls "$work"/pinetrie-*.tgz)"

npm install -g --prefix "$work/npm" "$tgz" --silent
mkdir -p "$PNPM_HOME"
PATH="$PNPM_HOME:$PATH" pnpm add -g "$tgz" --silent
fi
pnpm_root="$(PATH="$PNPM_HOME:$PATH" pnpm root -g)/pinetrie"

copies() {
  fd -H -I -t f -p -g '**/node_modules/@earendil-works/pi-coding-agent/package.json' "$1" \
    -x node -e 'console.log(require(process.argv[1]).version)' {} | sort | uniq -c
}

for install in npm pnpm; do
  root="${install}_root"
  tree="$work/tree-$install"
  env -i PATH="$PATH" HOME="$tree" \
    XDG_CONFIG_HOME="$tree/.config" XDG_DATA_HOME="$tree/.local/share" \
    PI_CODING_AGENT_DIR="$tree/.config/pinetrie" PI_OFFLINE=1 \
    ROOT="${!root}" TREE="$tree" WORK="$work" INSTALL="$install" \
    node "$here/probe.mjs" >"$here/result-$install.json"
  echo "$install: pi-coding-agent copies (count version)" >"$here/copies-$install.txt"
  dir="$work/npm"
  [ "$install" = pnpm ] && dir="$PNPM_HOME"
  copies "$dir" >>"$here/copies-$install.txt" || true
done
