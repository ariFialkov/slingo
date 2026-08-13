#!/usr/bin/env bash
# Produces dist/ — the uploadable site: only the files the game needs at
# runtime. There is no bundler or transpiler; the sources are already
# browser-ready ES modules, so "building" is regenerating the icons and
# copying the runtime files.
set -euo pipefail

cd "$(dirname "$0")"
OUT=dist

rm -rf "$OUT"
mkdir -p "$OUT"

# Icons are generated (dependency-free PNG encoder), not checked-in artefacts.
if command -v node >/dev/null 2>&1; then
  node tools/gen-icons.js >/dev/null
fi

cp index.html style.css sw.js manifest.json "$OUT"/
cp -R js icons "$OUT"/

echo "Built $OUT/ ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"
