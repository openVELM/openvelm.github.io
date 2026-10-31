#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$ROOT_DIR/app"
SRC_DIR="$ROOT_DIR/src"
PUBLIC_DIR="$ROOT_DIR/public"
DOCS_DIR="$ROOT_DIR/docs"
DOCKER_IMAGE="${DOCKER_IMAGE:-node:24-bookworm-slim}"

if [[ ! -f "$APP_DIR/package.json" || ! -f "$APP_DIR/package-lock.json" ]]; then
  echo "Error: ./app must contain package.json and package-lock.json." >&2
  exit 1
fi

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Error: expected the application source directory at ./src." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is required, but the docker command was not found." >&2
  exit 1
fi

mkdir -p "$PUBLIC_DIR" "$DOCS_DIR"
touch "$PUBLIC_DIR/.nojekyll"

# Use the current Node 24 toolchain. Installation and building happen in a
# disposable container workspace; only docs/ is written back to the host.
docker run --rm \
  --volume "$ROOT_DIR:/source:ro" \
  --volume "$DOCS_DIR:/output" \
  --env HOST_UID="$(id -u)" \
  --env HOST_GID="$(id -g)" \
  --env npm_config_registry=https://registry.npmjs.org \
  "$DOCKER_IMAGE" \
  bash -c '
    set -euo pipefail

    mkdir -p /work/src /work/public
    tar -C /source/app --exclude="./node_modules" --exclude="./dist" -cf - . | tar -C /work -xf -
    cp -R /source/src/. /work/src/
    cp -R /source/public/. /work/public/

    cd /work
    node --version
    npm --version
    npm ci --ignore-scripts --no-audit --no-fund --loglevel=error --registry=https://registry.npmjs.org
    npm run build -- --outDir /output --emptyOutDir

    # Guarantee root public/ assets and .nojekyll are in the deployable site.
    cp -R /source/public/. /output/
    chown -R "$HOST_UID:$HOST_GID" /output
  '

printf '\nGitHub Pages build complete: %s\n' "$DOCS_DIR"
