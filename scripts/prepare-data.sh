#!/bin/bash
# Guard the data files the app ships. See scripts/check-data.mjs for what is asserted and why.
set -Eeuo pipefail
ROOT="${COZE_WORKSPACE_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"
node "${ROOT}/scripts/check-data.mjs"
