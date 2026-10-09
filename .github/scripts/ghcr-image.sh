#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_CHANNEL:?RELEASE_CHANNEL is required}"
: "${RELEASE_TAG:?RELEASE_TAG is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

namespace='hsyhhssyy'
package_name='industrial-planner-beta'
visibility='public'
case "$RELEASE_CHANNEL" in
  alpha)
    package_name='industrial-planner-alpha-private'
    visibility='private'
    ;;
  pre|beta|stable) ;;
  *)
    echo "Unsupported container release channel: $RELEASE_CHANNEL" >&2
    exit 1
    ;;
esac

image="ghcr.io/${namespace}/${package_name}:${RELEASE_TAG}"
{
  echo "namespace=$namespace"
  echo "package_name=$package_name"
  echo "visibility=$visibility"
  echo "image=$image"
  echo 'tags<<EOF'
  echo "$image"
  if [ "$RELEASE_CHANNEL" = 'stable' ]; then
    echo "ghcr.io/${namespace}/${package_name}:latest"
  fi
  echo 'EOF'
} >> "$GITHUB_OUTPUT"
