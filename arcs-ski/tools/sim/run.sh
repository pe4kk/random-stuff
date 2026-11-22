#!/usr/bin/env bash
# usage : tools/sim/run.sh [cruise|fast]  (depuis arcs-ski/)
set -e
OUT=${TMPDIR:-/tmp}/arcs-sim.cjs
npx esbuild tools/sim/sim.ts --bundle --platform=node --format=cjs --outfile="$OUT" --log-level=warning
node "$OUT" "$@"
