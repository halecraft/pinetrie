#!/usr/bin/env bash
# Wire the local Kyneta workspace and the local pi install into node_modules.
#
# Why symlinks and not `link:`  — `link:` is a pnpm/yarn protocol; npm rejects it
# with EUNSUPPORTEDPROTOCOL. Node resolves through realpath, so each symlinked
# package picks up its own workspace deps and `workspace:^` never has to resolve.
#
# `npm install` DELETES these symlinks. Re-run this script after every install.
#
# Nothing here writes to ~/halecraft/kyneta or ~/.pi — only symlinks INTO ./node_modules.
set -euo pipefail

KY="${PINETA_KYNETA_ROOT:-$HOME/halecraft/kyneta}"
PI="${PINETA_PI_ROOT:-$HOME/.local/share/fnm/node-versions/v24.19.0/installation/lib/node_modules/@halecraft/pi/node_modules/@earendil-works/pi-coding-agent}"

cd "$(dirname "$0")"
mkdir -p node_modules/@kyneta node_modules/@earendil-works

link() { # link <target> <name-under-node_modules>
  local target="$1" name="$2"
  [ -d "$target" ] || { echo "MISSING: $target" >&2; exit 1; }
  rm -rf "node_modules/$name"
  ln -sfn "$target" "node_modules/$name"
}

# --- Kyneta (packages/* and packages/exchange/transports/*) -----------------
link "$KY/packages/schema"                        "@kyneta/schema"
link "$KY/packages/schema/backends/loro"          "@kyneta/loro-schema"
link "$KY/packages/exchange"                      "@kyneta/exchange"
link "$KY/packages/machine"                       "@kyneta/machine"
link "$KY/packages/changefeed"                    "@kyneta/changefeed"
link "$KY/packages/random"                        "@kyneta/random"
link "$KY/packages/transport"                     "@kyneta/transport"
link "$KY/packages/exchange/wire"                 "@kyneta/wire"
link "$KY/packages/exchange/transports/websocket" "@kyneta/websocket-transport"

# --- pi (read-only; the ONLY deep coupling, confined to storage/) -----------
link "$PI"                                        "@earendil-works/pi-coding-agent"
link "$PI/node_modules/@earendil-works/pi-agent-core" "@earendil-works/pi-agent-core"
link "$PI/node_modules/@earendil-works/pi-ai"     "@earendil-works/pi-ai"

echo "relink: ok"
