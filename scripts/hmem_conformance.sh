#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node node_modules/tsx/dist/cli.mjs scripts/hmem_conformance.ts
