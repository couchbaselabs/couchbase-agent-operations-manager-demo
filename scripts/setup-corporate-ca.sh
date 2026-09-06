#!/usr/bin/env bash
# Exports the root CA(s) this Mac trusts for TLS-inspecting corporate proxies
# (Zscaler, Netskope, Palo Alto GlobalProtect, etc.) so `docker compose build`
# can trust them too. `npm install` in backend/Dockerfile verifies TLS against
# Node's own CA store inside the build container, not macOS's system trust
# store — so a proxy that MITMs registry.npmjs.org with its own cert fails
# verification at build time (SELF_SIGNED_CERT_IN_CHAIN / self-signed
# certificate in certificate chain) unless that cert is injected into the
# image explicitly.
#
# Adapted from https://github.com/erikhinderer/couchbase-optimizer-agent's
# setup-corporate-ca.sh for this project's two Docker build contexts.
#
# Drops the exported cert into backend/certs/ and frontend/certs/ — one per
# Docker build context (frontend's nginx build doesn't currently install
# anything over the network, but it's provisioned too in case that changes).
# Machine-specific; a no-op on machines that don't need it (writes an empty
# placeholder so the Dockerfiles' COPY still finds a file).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIRS=(
  "$REPO_ROOT/backend/certs"
  "$REPO_ROOT/frontend/certs"
)

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script currently only supports macOS (it uses the 'security' CLI to read the keychain)." >&2
  echo "On Linux, ask IT for your org's proxy root CA .pem and copy it manually to:" >&2
  for d in "${DEST_DIRS[@]}"; do echo "  ${d#$REPO_ROOT/}/corporate-ca.crt" >&2; done
  exit 1
fi

TMP_CERT="$(mktemp)"
trap 'rm -f "$TMP_CERT"' EXIT

echo "Exporting certificates from the System keychain..."
security find-certificate -a -p /Library/Keychains/System.keychain > "$TMP_CERT" 2>/dev/null || true

CERT_COUNT=$(grep -c "BEGIN CERTIFICATE" "$TMP_CERT" 2>/dev/null || echo 0)

if [[ "$CERT_COUNT" -eq 0 ]]; then
  echo "No certificates found in the System keychain — nothing to export."
  echo "If your build still fails with a self-signed-certificate error, ask IT for"
  echo "the proxy's root CA and save it as corporate-ca.crt in each of:"
  for d in "${DEST_DIRS[@]}"; do echo "  ${d#$REPO_ROOT/}/"; done
  for d in "${DEST_DIRS[@]}"; do
    mkdir -p "$d"
    : > "$d/corporate-ca.crt"
  done
  exit 0
fi

for d in "${DEST_DIRS[@]}"; do
  mkdir -p "$d"
  cp "$TMP_CERT" "$d/corporate-ca.crt"
done

echo "Exported $CERT_COUNT certificate(s) to:"
for d in "${DEST_DIRS[@]}"; do echo "  ${d#$REPO_ROOT/}/corporate-ca.crt"; done
echo
echo "Note: this only covers TLS verification *inside* the build (npm install)."
echo "If your proxy also intercepts 'docker pull' itself (image pulls failing"
echo "with a similar certificate error), that's a Docker Engine-level trust"
echo "setting, not something a Dockerfile can fix — see the README's"
echo "'Corporate networks / TLS-inspecting proxies' section."
echo
echo "Now run: docker compose build --no-cache && docker compose up"
