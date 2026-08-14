#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

launch_with_timeout() {
  local cmd=("$@")

  if command -v timeout >/dev/null 2>&1; then
    exec timeout \
      --signal=TERM \
      --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
      "${SITES_BUILD_TIMEOUT:-3m}" \
      "${cmd[@]}"
  fi

  if command -v gtimeout >/dev/null 2>&1; then
    exec gtimeout \
      --signal=TERM \
      --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
      "${SITES_BUILD_TIMEOUT:-3m}" \
      "${cmd[@]}"
  fi

  echo "GNU timeout not found; running build without timeout guard on this system." >&2
  exec "${cmd[@]}"
}

echo "Running bounded vinext build..."
launch_with_timeout "${vinext}" build

"${script_dir}/validate-artifact.sh"
