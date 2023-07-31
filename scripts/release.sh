#!/usr/bin/env bash
set -e

MINOR="$1"

if [ -z "$MINOR" ]; then
  echo "Missing version argument"
  echo "  Usage: ${0} <workerd-minor-version>"
  exit 1
fi

MINIFLARE_VERSION="3.${MINOR}.0"
WORKERD_VERSION="1.${MINOR}.0"

# checkout a new branch
git fetch origin tre:tre
git checkout -b "${USER}/v${MINIFLARE_VERSION}" tre

# update workerd
npm install --workspace miniflare "workerd@${WORKERD_VERSION}"

# bump version and commit and tag release
npm version "$MINIFLARE_VERSION" --force --include-workspace-root --workspace miniflare -m "Bump versions to %s"

git push -u "${USER}/v${MINIFLARE_VERSION}"
git push --tags

# publish to npm
npm run prepublishOnly
npm publish -ws
