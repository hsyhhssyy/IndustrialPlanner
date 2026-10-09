#!/usr/bin/env bash
set -euo pipefail

namespace="${1:?GHCR namespace is required}"
package_name="${2:?GHCR package name is required}"
expected_visibility="${3:?Expected visibility is required}"
allow_missing="${4:-false}"
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

case "$expected_visibility" in
  public|private) ;;
  *) echo "Unsupported package visibility: $expected_visibility" >&2; exit 1 ;;
esac

response_file="$(mktemp "$RUNNER_TEMP/ghcr-package.XXXXXX")"
trap 'rm -f "$response_file"' EXIT
http_status="$(curl --silent --show-error --retry 3 --connect-timeout 15 --max-time 60 \
  --output "$response_file" --write-out '%{http_code}' \
  --header 'Accept: application/vnd.github+json' \
  --header "Authorization: Bearer $GH_TOKEN" \
  "${GITHUB_API_URL:-https://api.github.com}/users/${namespace}/packages/container/${package_name}")"

if [ "$http_status" = '404' ] && [ "$allow_missing" = 'true' ]; then
  # GHCR 首次推送默认创建私有包；推送后仍须验证目标可见性。
  echo 'GHCR package is not yet accessible; visibility will be checked again after publishing.'
  exit 0
fi
if [ "$http_status" != '200' ]; then
  echo "Cannot verify GHCR package visibility (HTTP $http_status). Check the workflow's packages permission and the package's Manage Actions access." >&2
  exit 1
fi

actual_visibility="$(jq -er '.visibility | select(type == "string")' "$response_file")"
if [ "$actual_visibility" != "$expected_visibility" ]; then
  echo "GHCR package $namespace/$package_name must be $expected_visibility; current visibility: $actual_visibility." >&2
  if [ "$expected_visibility" = 'public' ]; then
    echo "Open https://github.com/users/$namespace/packages/container/$package_name/settings and select Change visibility → Public, then rerun the release workflow." >&2
  else
    echo 'Alpha publishing is blocked: never publish confidential images into a public package.' >&2
  fi
  exit 1
fi
