#!/usr/bin/env bash
# Runs the probe's variants. $1 is a directory holding node_modules with
# pi 0.87.1 and @gotgenes/pi-anthropic-auth 3.4.2; results go beside this file.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$1"
cp "$here/probe.mjs" "$here/trace.mjs" "$work/"
cd "$work"
fixtures="$(cd "$here/../../../packages/pi/fixtures" && pwd)"
# $2: a directory where `npm install --legacy-peer-deps @gotgenes/pi-anthropic-auth
# pi-subagents` ran, with no pi beside them.
installed="${2:-}"
for variant in today ours ours-env ours-untrusted ours-packages ours-installed; do
  if [ "$variant" = ours-installed ] && [ -z "$installed" ]; then continue; fi
  root="$work/tree-$variant"
  extra=()
  if [ "$variant" != today ] && [ "$variant" != ours ]; then
    extra=(PI_CODING_AGENT_DIR="$root/home/.config/pinetrie")
  fi
  env -i PATH="$PATH" HOME="$root/home" \
    XDG_CONFIG_HOME="$root/home/.config" XDG_DATA_HOME="$root/home/.local/share" \
    PI_OFFLINE=1 TRACE_ROOT="$root" TRACE_OUT="$here/trace-$variant.json" \
    VARIANT="$variant" FIXTURES="$fixtures" INSTALLED="$installed" "${extra[@]}" \
    node --import ./trace.mjs probe.mjs >"$here/result-$variant.json"
done
